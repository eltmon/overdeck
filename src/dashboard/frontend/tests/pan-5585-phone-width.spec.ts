/**
 * PAN-5585 — the phone-width conversation page, proved end to end on a real
 * WebKit iPhone viewport: the Agents rail opens as an overlay instead of
 * squeezing the timeline, nothing in the top bar, conversation header or
 * composer passes the right edge at 360 px, the three top-bar menus stay
 * inside the viewport, and the app root follows the visual viewport
 * (`--app-height`).
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and a
 * fake `HOME`, never the operator's live dashboard on :3011) seeded with the
 * shared workflow fixture (`scripts/dev/seed-workflow-fixture.ts`), plus two
 * subagent transcripts written directly under the parent session's
 * `subagents/` directory so the Agents rail has rows to show.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 * Not in CI's `test:playwright` list (D-11): it seeds git repositories and
 * writes transcript fixtures by hand.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { devices, expect, test, type Page } from '@playwright/test';
import { claudeProjectDir, claudeProjectsRoot } from '../../../lib/runtimes/storage/claude-code.js';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const SCREENSHOTS = path.join(REPO_ROOT, 'docs/screenshots/pan-5585');

test.use({ ...devices['iPhone 15 Pro'] });
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

interface TranscriptRecord {
  type: 'user' | 'assistant';
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  cwd: string;
  message: { id?: string; role: 'user' | 'assistant'; content: unknown };
}

interface SubagentDef {
  agentId: string;
  agentType: string;
  description: string;
  toolUseId: string;
  spawnDepth: number;
}

const SUBAGENTS: SubagentDef[] = [
  { agentId: 'pan5585a', agentType: 'Explore', description: 'Trace the phone layout', toolUseId: 'toolu_pan5585_a', spawnDepth: 1 },
  { agentId: 'pan5585b', agentType: 'general-purpose', description: 'Trace the phone layout', toolUseId: 'toolu_pan5585_b', spawnDepth: 1 },
];

let dashboard: IsolatedDashboard;
let tmp: string;
let conversationId: number;
let conversationCwd: string;
let claudeSessionId: string;

/** The seeded session is not alive; mark fixture-1 alive so the rail, tabs and composer render. */
async function patchLiveSession(page: Page): Promise<void> {
  const patch = (row: unknown): unknown =>
    row && typeof row === 'object' && (row as { name?: string }).name === 'fixture-1' ? { ...row, sessionAlive: true } : row;
  await page.route(/\/api\/conversations(\/fixture-1)?(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json().catch(() => null);
    if (body === null) return route.fulfill({ response });
    const json = Array.isArray(body) ? body.map(patch) : patch(body);
    return route.fulfill({ response, json });
  });
}

async function openConversation(page: Page, theme: 'light' | 'dark' = 'dark'): Promise<void> {
  await page.addInitScript(
    ({ theme }) => {
      localStorage.setItem('overdeck.ui.theme', theme);
      localStorage.removeItem('overdeck.ui.agentsRailCollapsed');
    },
    { theme },
  );
  await page.goto(`${dashboard.baseUrl}/conv/${conversationId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-component="first-load-screen"]')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('conversation-pane-row')).toBeVisible({ timeout: 30_000 });
}

async function closeDock(page: Page): Promise<void> {
  const dock = page.getByTestId('work-dock');
  if (await dock.isVisible()) await dock.getByRole('button', { name: 'Hide panel' }).click();
  await expect(dock).toHaveCount(0);
}

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pan-5585-phone-'));
  const overdeckHome = path.join(tmp, 'overdeck');
  const fakeHome = path.join(tmp, 'home');
  mkdirSync(overdeckHome, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  await execFileAsync(
    'node',
    ['--import', 'tsx', 'scripts/dev/seed-workflow-fixture.ts', '--root', path.join(tmp, 'fixture'), '--home', fakeHome],
    { cwd: REPO_ROOT, env: { ...process.env, OVERDECK_HOME: overdeckHome, HOME: fakeHome } },
  );
  dashboard = await startIsolatedDashboard({ home: overdeckHome, env: { HOME: fakeHome } });

  const response = await fetch(`${dashboard.baseUrl}/api/conversations/fixture-1`);
  const conv = (await response.json()) as { id: number; cwd: string; claudeSessionId: string };
  conversationId = conv.id;
  conversationCwd = conv.cwd;
  claudeSessionId = conv.claudeSessionId;

  const projectDir = claudeProjectDir(conversationCwd, claudeProjectsRoot(fakeHome));
  const parentTranscript = await readFile(join(projectDir, `${claudeSessionId}.jsonl`), 'utf8');
  const lines = parentTranscript.trim().split('\n');
  const firstUserRecord = JSON.parse(lines[0]!) as TranscriptRecord;
  const lastAssistantRecord = JSON.parse(lines[lines.length - 1]!) as TranscriptRecord;

  const subagentsDir = join(projectDir, claudeSessionId, 'subagents');
  await mkdir(subagentsDir, { recursive: true });

  for (const sub of SUBAGENTS) {
    const userUuid = `${sub.agentId}-user`;
    const assistantUuid = `${sub.agentId}-assistant`;
    const userRecord: TranscriptRecord = {
      ...firstUserRecord,
      uuid: userUuid,
      parentUuid: null,
      sessionId: sub.agentId,
    };
    const assistantRecord: TranscriptRecord = {
      ...lastAssistantRecord,
      uuid: assistantUuid,
      parentUuid: userUuid,
      sessionId: sub.agentId,
      message: {
        ...lastAssistantRecord.message,
        content: [{ type: 'text', text: 'Phone layout subagent reply' }],
      },
    };
    await writeFile(
      join(subagentsDir, `agent-${sub.agentId}.jsonl`),
      `${JSON.stringify(userRecord)}\n${JSON.stringify(assistantRecord)}\n`,
    );
    await writeFile(
      join(subagentsDir, `agent-${sub.agentId}.meta.json`),
      JSON.stringify({
        agentType: sub.agentType,
        description: sub.description,
        toolUseId: sub.toolUseId,
        spawnDepth: sub.spawnDepth,
      }),
    );
  }

  mkdirSync(SCREENSHOTS, { recursive: true });
});

test.afterAll(async () => {
  await dashboard?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('rail opens over the timeline at 393 and 360 px', async ({ page }) => {
  await patchLiveSession(page);
  for (const width of [393, 360]) {
    await page.setViewportSize({ width, height: 780 });
    await openConversation(page);
    await closeDock(page);

    const strip = page.getByRole('button', { name: 'Show agents rail' });
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await strip.click();
    const rail = page.getByRole('complementary', { name: 'Conversation agents' });
    await expect(rail).toHaveAttribute('data-mode', 'overlay');

    const widths = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="conversation-pane-row"]');
      const body = row?.firstElementChild ?? null;
      return {
        row: row ? row.getBoundingClientRect().width : 0,
        body: body ? body.getBoundingClientRect().width : 0,
      };
    });
    expect(widths.row).toBeGreaterThan(0);
    expect(widths.body).toBeGreaterThanOrEqual(widths.row - 31);

    await page.screenshot({ path: path.join(SCREENSHOTS, `rail-overlay-${width}.png`) });
  }
});

test('tapping a rail row closes the overlay and shows the subagent', async ({ page }) => {
  await patchLiveSession(page);
  await page.setViewportSize({ width: 393, height: 780 });
  await openConversation(page);
  await closeDock(page);

  const strip = page.getByRole('button', { name: 'Show agents rail' });
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await strip.click();
  await page.getByRole('button', { name: /Explore/ }).click();

  await expect(page.getByRole('complementary', { name: 'Conversation agents' })).toHaveCount(0);
  await expect(page).toHaveURL(/subagent=pan5585a/);
  await expect(page.getByText('Phone layout subagent reply')).toBeVisible({ timeout: 30_000 });
});

test('nothing in the top bar, header or composer passes the right edge at 360 px', async ({ page }) => {
  await patchLiveSession(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await openConversation(page);
  await closeDock(page);

  await expect(page.getByRole('tab', { name: 'Conversation', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toBeVisible();

  const offenders = await page.evaluate(() => {
    const selectors = ['[data-testid="topbar"]', '[data-machine-state]', '[class*="composerToolbar"]'];
    const out: string[] = [];
    for (const selector of selectors) {
      const root = document.querySelector(selector);
      if (!root) continue;
      const all = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.right > window.innerWidth + 0.5) {
          out.push(`${el.tagName}.${(el as HTMLElement).className}`);
        }
      }
    }
    return out;
  });
  expect(offenders, `elements overflowing the 360px viewport: ${offenders.join(', ')}`).toEqual([]);

  async function assertSurfaceInViewport(trigger: string, surfaceSelector: string): Promise<void> {
    await page.getByTestId(trigger).click();
    const surface = page.locator(surfaceSelector).first();
    await expect(surface).toBeVisible({ timeout: 10_000 });
    const rect = await surface.evaluate((el) => el.getBoundingClientRect());
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(innerWidth);
    await page.keyboard.press('Escape');
  }

  await assertSurfaceInViewport('agents-menu-trigger', '[data-testid="agents-menu"]');
  await assertSurfaceInViewport('flywheel-needs-you-indicator', '[aria-label="Needs you"]');
  await assertSurfaceInViewport('system-health-pill', '#system-health-popover');

  await page.screenshot({ path: path.join(SCREENSHOTS, 'topbar-360.png') });
});

test('the root follows the visual viewport', async ({ page }) => {
  await patchLiveSession(page);
  await page.setViewportSize({ width: 393, height: 780 });
  await openConversation(page);

  const result = await page.evaluate(() => ({
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
    rootHeight: document.getElementById('root')?.getBoundingClientRect().height ?? 0,
    innerHeight: window.innerHeight,
  }));
  expect(result.appHeight).toBe(`${result.innerHeight}px`);
  expect(result.rootHeight).toBe(result.innerHeight);
});
