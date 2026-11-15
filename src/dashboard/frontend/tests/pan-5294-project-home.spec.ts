/**
 * The rebuilt project Home (PAN-5294, WI-11; NFR-4, parent AC-G), in a real
 * browser against a real server, plus the four PR screenshots.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and a
 * fake `HOME`, never the operator's live dashboard on :3011) seeded with the
 * shared workflow fixture (`scripts/dev/seed-workflow-fixture.ts`): project
 * `workflow-fixture` ("Workflow fixture", prefix WFX), a repo with two pushed
 * commits and one local commit carrying an `Overdeck-Conversation:` trailer,
 * and the conversation "Fixture conversation" (fixture-1).
 *
 * The issue list and conversation creation are routed to fixed answers (a
 * real POST would launch an agent); `fixture-1` is marked working so the
 * Agents working fact and the project switcher have something to agree on.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 * Not in CI's `test:playwright` list: it seeds git repositories.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const SCREENSHOTS = path.join(REPO_ROOT, 'docs/screenshots/pan-5294');
const PROJECT_NAME = 'Workflow fixture';
/** Decks route by the project's display name, as the project switcher does. */
const DECK = encodeURIComponent(PROJECT_NAME);

test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1920, height: 1000 } });

let dashboard: IsolatedDashboard;
let tmp: string;
let repoPath: string;

/**
 * The process env without the caller's Overdeck agent identity: a work agent's
 * git shim would otherwise stamp `Overdeck-Agent` trailers on the fixture's
 * commits and attribute them to that agent's issue.
 */
function fixtureEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OVERDECK_')));
  return { ...env, ...extra };
}

function feature(issueId: string, title: string, stateLabel: string, working: boolean) {
  const startedAt = new Date(Date.now() - 40 * 60_000).toISOString();
  return {
    issueId,
    title,
    projectName: PROJECT_NAME,
    branch: `feature/${issueId.toLowerCase()}`,
    status: 'open',
    stateLabel,
    agentStatus: working ? 'running' : null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    sessions: working
      ? [{ type: 'work', presence: 'active', status: 'running', model: 'claude-sonnet-5', sessionId: `agent-${issueId.toLowerCase()}`, startedAt }]
      : [],
    taskTotals: working ? { total: 7, closed: 3, inProgress: 1, lastUpdated: startedAt } : null,
    resourceSources: ['workspace'],
    resourceDetails: {
      hasWorkspace: true,
      localBranchCount: 1,
      remoteBranchCount: 0,
      tmuxSessionCount: 0,
      prs: [],
      hasXbrief: false,
      hasTasks: false,
      dockerContainerCount: 0,
    },
  };
}

const FEATURES = [
  feature('WFX-1', 'Render the fixture dashboard tiles', 'In Progress', true),
  feature('WFX-2', 'Wire the fixture settings page', 'In Progress', true),
  feature('WFX-3', 'Review the fixture importer', 'In Review', false),
  feature('WFX-4', 'Write the fixture onboarding copy', 'Todo', false),
];

async function routeFixedAnswers(page: Page): Promise<void> {
  await page.route('**/api/issues/resource-allocated', (route) => route.fulfill({ json: FEATURES }));
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { id: 9001, name: 'pw-created', title: 'Agent' } });
    }
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const conversations = (await response.json()) as Array<{ name: string; isWorking?: boolean }>;
    return route.fulfill({
      response,
      json: conversations.map((c) => (c.name === 'fixture-1' ? { ...c, isWorking: true } : c)),
    });
  });
  await page.route('**/api/agents', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ json: { success: true } });
  });
}

async function openHome(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ({ theme }) => {
      localStorage.setItem('overdeck.ui.sidebarCollapsed', 'false');
      localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
      localStorage.setItem('overdeck.ui.awarenessCollapsed', 'true');
      localStorage.setItem('overdeck.ui.theme', theme);
    },
    { theme },
  );
  await routeFixedAnswers(page);
  await page.goto(`${dashboard.baseUrl}/command-deck/${DECK}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#pan-recovery-overlay').evaluate((el) => el.remove()).catch(() => {});
  await expect(page.getByTestId('project-home')).toBeVisible({ timeout: 30_000 });
}

/** The value cell of a Home fact. */
function factValue(page: Page, label: string) {
  return page.locator(`[data-fact="${label}"] [data-fact-value]`);
}

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(async ({ page }) => {
  // The conversations route proxies a live fetch; drop it before the page closes.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(pageErrors).toEqual([]);
});

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pan-5294-home-'));
  const overdeckHome = path.join(tmp, 'overdeck');
  const fakeHome = path.join(tmp, 'home');
  mkdirSync(overdeckHome, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', 'scripts/dev/seed-workflow-fixture.ts', '--root', path.join(tmp, 'fixture'), '--home', fakeHome],
    { cwd: REPO_ROOT, env: fixtureEnv({ OVERDECK_HOME: overdeckHome, HOME: fakeHome }) },
  );
  repoPath = (JSON.parse(stdout) as { repoPath: string }).repoPath;
  dashboard = await startIsolatedDashboard({ home: overdeckHome, env: { HOME: fakeHome } });
  mkdirSync(SCREENSHOTS, { recursive: true });
});

test.afterAll(async () => {
  await dashboard?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// The conversation screenshots come first, before the trailer commit reaches origin.
for (const theme of ['light', 'dark'] as const) {
  test(`conversation screenshot (${theme})`, async ({ page }) => {
    await openHome(page, theme);
    await page.getByText('Fixture conversation', { exact: true }).first().click();
    await expect(page.getByRole('tab', { name: /Fixture conversation/ }).first()).toBeVisible({ timeout: 30_000 });
    // Wait for the transcript, not its loading skeleton.
    await expect(page.getByText('Add the app entry, wire it, and extend the shared notes.')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SCREENSHOTS, `conversation-${theme}.png`) });
  });
}

test('Home puts the actions in the first viewport and its facts agree with the left column', async ({ page }) => {
  // The trailer commit is local only; once on origin/main the changes API lists it.
  await execFileAsync('git', ['-C', repoPath, 'push', '-q', 'origin', 'HEAD:main'], { env: fixtureEnv({}) });
  await openHome(page, 'dark');

  const newConversation = page.getByTestId('project-home').getByRole('button', { name: 'New conversation', exact: true });
  await expect(newConversation).toBeVisible();
  const box = await newConversation.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThan(1000);

  for (const label of ['Agents working', 'Needs you', 'In review', 'Landed this week', 'Spend this week']) {
    await expect(page.locator(`[data-fact="${label}"]`)).toBeVisible();
  }

  // The Agents working fact equals the number the project switcher shows.
  await expect(factValue(page, 'Agents working')).toHaveText('1', { timeout: 30_000 });
  await page.getByTestId('project-switcher').click();
  await expect(page.getByTestId(`project-status-${PROJECT_NAME}`)).toHaveText('1 working');
  await page.keyboard.press('Escape');

  const building = page.locator('[data-phase-group="building"]');
  await expect(building.getByTestId('pipeline-row')).toHaveCount(2);
  await expect(building).toContainText('Building · 2');
  await expect(page.locator('[data-phase-group="review"]')).toContainText('In review · 1');

  const recent = page.getByRole('region', { name: 'Recent changes on main' });
  const attributed = recent.locator('[data-testid="recent-change-row"][data-by="conversation"]');
  await expect(attributed.first()).toContainText('Fixture conversation', { timeout: 30_000 });
  await expect(recent).toContainText('feat: wire the fixture conversation');

  await page.screenshot({ path: path.join(SCREENSHOTS, 'home-dark.png') });
});

test('Home screenshot (light)', async ({ page }) => {
  await openHome(page, 'light');
  await expect(page.locator('[data-phase-group="building"]').getByTestId('pipeline-row')).toHaveCount(2);
  await expect(
    page.getByRole('region', { name: 'Recent changes on main' }).locator('[data-by="conversation"]').first(),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, 'home-light.png') });
});
