/**
 * PAN-5295 (child D2): the turn card, file chips, composer controls and tab
 * strip on the shared workflow fixture.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and a
 * fake `HOME`, never the operator's live dashboard on :3011) seeded with the
 * shared workflow fixture (`scripts/dev/seed-workflow-fixture.ts`): project
 * `workflow-fixture` with the conversation "Fixture conversation"
 * (`fixture-1`), which has commits and uncommitted edits.
 *
 * The seeded session is not alive, so the panel would show the resume bar
 * instead of the composer. The composer checks and the screenshots patch the
 * conversation rows the page reads (`sessionAlive: true` on `fixture-1`).
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
import { expect, test, type Locator, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const SCREENSHOTS = path.join(REPO_ROOT, 'docs/screenshots/pan-5295');
const DECK = 'workflow-fixture';

test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1920, height: 1000 } });

let dashboard: IsolatedDashboard;
let tmp: string;

interface ChangedFile { path: string; additions: number; deletions: number }
interface Changes {
  uncommitted: Array<ChangedFile & { turnIds: string[] }>;
  commits: Array<{ sha: string; pushed: boolean; turnId?: string; files: ChangedFile[] }>;
}

/** The turn card's numbers, from the same rule the card uses (D2-8): one row per path, uncommitted first. */
interface CardNumbers { files: number; additions: number; deletions: number; pushed: number; local: number; uncommitted: number }

const dock = (page: Page): Locator => page.getByTestId('work-dock');
const card = (page: Page): Locator => page.getByTestId('turn-changes-card');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

async function cardNumbers(page: Page): Promise<CardNumbers> {
  const response = await page.request.get(`${dashboard.baseUrl}/api/conversations/fixture-1/changes?scope=conversation`);
  expect(response.ok()).toBe(true);
  const changes = (await response.json()) as Changes;
  // The fixture keys every change to one assistant message (checked in turn-card-wiring),
  // so the whole answer is one turn.
  const seen = new Set<string>();
  const rows: ChangedFile[] = [];
  let uncommitted = 0;
  for (const file of changes.uncommitted) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    rows.push(file);
    uncommitted++;
  }
  for (const commit of changes.commits) {
    for (const file of commit.files) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      rows.push(file);
    }
  }
  return {
    files: rows.length,
    additions: rows.reduce((n, r) => n + r.additions, 0),
    deletions: rows.reduce((n, r) => n + r.deletions, 0),
    pushed: changes.commits.filter((c) => c.pushed).length,
    local: changes.commits.filter((c) => !c.pushed).length,
    uncommitted,
  };
}

/** The seeded session is not alive; mark fixture-1 alive so the composer renders. */
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

async function openDeck(page: Page, theme: 'light' | 'dark' = 'dark'): Promise<void> {
  await page.addInitScript(
    ({ theme }) => {
      localStorage.setItem('overdeck.ui.sidebarCollapsed', 'false');
      localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
      localStorage.setItem('overdeck.ui.awarenessCollapsed', 'true');
      localStorage.setItem('overdeck.ui.theme', theme);
    },
    { theme },
  );
  await page.goto(`${dashboard.baseUrl}/command-deck/${DECK}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Open new tab')).toBeVisible({ timeout: 30_000 });
}

async function openConversation(page: Page): Promise<void> {
  await page.getByText('Fixture conversation', { exact: true }).first().click();
  await expect(page.getByRole('tab', { name: /Fixture conversation/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
}

async function closeDock(page: Page): Promise<void> {
  if (await dock(page).isVisible()) await dock(page).getByRole('button', { name: 'Hide panel' }).click();
  await expect(dock(page)).toHaveCount(0);
}

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pan-5295-turn-'));
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
  mkdirSync(SCREENSHOTS, { recursive: true });
});

test.afterAll(async () => {
  await dashboard?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('one turn card shows the turn\'s files and tags, with no Changed files card', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  const numbers = await cardNumbers(page);

  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toContainText(plural(numbers.files, 'file changed', 'files changed'));
  await expect(card(page)).toContainText(`+${numbers.additions}`);
  await expect(card(page)).toContainText(`−${numbers.deletions}`);
  if (numbers.pushed > 0) await expect(card(page)).toContainText(plural(numbers.pushed, 'commit pushed', 'commits pushed'));
  if (numbers.local > 0) await expect(card(page)).toContainText(plural(numbers.local, 'commit not pushed', 'commits not pushed'));
  expect(numbers.uncommitted).toBeGreaterThan(0);
  await expect(card(page)).toContainText(`${numbers.uncommitted} not committed`);
  await expect(card(page).locator('[data-change-path]')).toHaveCount(numbers.files);
  await expect(page.getByText(/Changed files/)).toHaveCount(0);
});

test('Review opens the dock diff view on the turn\'s first file with i/N', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  await closeDock(page);
  const numbers = await cardNumbers(page);

  await card(page).getByRole('button', { name: 'Review' }).click();
  await expect(dock(page).getByTestId('dock-diff-position')).toHaveText(`1/${numbers.files}`, { timeout: 30_000 });
});

test('the docs/shared.md chip in a tool row opens its diff in the dock', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  await closeDock(page);
  // A chip steps through every conversation target (D2-9): each uncommitted
  // file, then each commit's files — not the turn card's deduplicated rows.
  const response = await page.request.get(`${dashboard.baseUrl}/api/conversations/fixture-1/changes?scope=conversation`);
  const changes = (await response.json()) as Changes;
  const targets = changes.uncommitted.length + changes.commits.reduce((n, c) => n + c.files.length, 0);

  // The MultiEdit row's output names the file; expand it and click the chip.
  await page.getByText('MultiEdit', { exact: true }).first().click();
  const chip = page.getByTestId('markdown-file-link-label').filter({ hasText: 'shared.md' }).first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.click();
  // docs/shared.md is uncommitted, so its diff is the list's first entry.
  await expect(dock(page).getByTestId('dock-diff-position')).toHaveText(`1/${targets}`, { timeout: 30_000 });
});

test('the composer shows the Send menu, Thinking and an enabled model button', async ({ page }) => {
  await patchLiveSession(page);
  await openDeck(page);
  await openConversation(page);

  const send = page.getByRole('button', { name: /^Send:/ });
  await expect(send).toBeVisible({ timeout: 30_000 });
  await send.click();
  const menu = page.getByRole('menu', { name: 'Send' });
  await expect(menu.getByRole('menuitemradio', { name: /^normally/ })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: /^interrupt now/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('effort-chip')).toHaveText(/^Thinking: /);
  await expect(page.getByRole('button', { name: 'Attach files' })).toBeVisible();
});

test('tabs show no shortcut chip or Chat <id> label, and N tabs lists them', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);

  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  for (let i = 0; i < count; i++) {
    const text = (await tabs.nth(i).textContent()) ?? '';
    expect(text).not.toContain('⌘');
    expect(text).not.toMatch(/^Chat /);
  }
  await page.getByRole('button', { name: `${count} tabs, list all tabs` }).click();
  await expect(page.getByRole('menu', { name: 'All tabs' }).getByRole('menuitemradio')).toHaveCount(count);
  await page.keyboard.press('Escape');
});

for (const theme of ['dark', 'light'] as const) {
  test(`screenshots (${theme})`, async ({ page }) => {
    await patchLiveSession(page);
    await openDeck(page, theme);
    await openConversation(page);
    await closeDock(page);
    await expect(page.getByRole('button', { name: /^Send:/ })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SCREENSHOTS, `conversation-turn-${theme}.png`) });
  });
}
