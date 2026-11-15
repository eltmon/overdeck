/**
 * The conversation header (PAN-5291, WI-11; AC-D1, NFR-4): the Changes and
 * Files buttons, the status line in words and the ⋯ menu, in a real browser
 * against a real server, plus the two PR screenshots.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and a
 * fake `HOME`, never the operator's live dashboard on :3011) seeded with the
 * shared workflow fixture (`scripts/dev/seed-workflow-fixture.ts`): project
 * `workflow-fixture` with the conversation "Fixture conversation"
 * (`fixture-1`), which has commits and uncommitted edits.
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
const SCREENSHOTS = path.join(REPO_ROOT, 'docs/screenshots/pan-5291');
const DECK = 'workflow-fixture';

test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1920, height: 1000 } });

let dashboard: IsolatedDashboard;
let tmp: string;

interface Totals {
  files: number;
  additions: number;
  deletions: number;
  commitsPushed: number;
  commitsLocal: number;
  uncommittedFiles: number;
}

const dock = (page: Page): Locator => page.getByTestId('work-dock');
const dockTab = (page: Page, name: string): Locator => dock(page).getByRole('tab', { name: new RegExp(`^${name}`) });
const header = (page: Page): Locator => page.locator('[data-machine-state]').first();
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

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

/** Open the fixture conversation as a Stage tab (its row in the conversation list). */
async function openConversation(page: Page): Promise<void> {
  await page.getByText('Fixture conversation', { exact: true }).first().click();
  await expect(page.getByRole('tab', { name: /Fixture conversation/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(header(page)).toBeVisible({ timeout: 30_000 });
}

async function closeDock(page: Page): Promise<void> {
  if (await dock(page).isVisible()) await dock(page).getByRole('button', { name: 'Hide panel' }).click();
  await expect(dock(page)).toHaveCount(0);
}

async function fixtureTotals(page: Page): Promise<Totals> {
  const response = await page.request.get(`${dashboard.baseUrl}/api/conversations/fixture-1/changes?scope=conversation`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { totals: Totals }).totals;
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
  tmp = mkdtempSync(path.join(tmpdir(), 'pan-5291-header-'));
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

test('the header shows the fixture change totals on Changes and in the status line', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  const totals = await fixtureTotals(page);

  const changes = header(page).getByRole('button', { name: /^Changes/ });
  if (totals.additions + totals.deletions > 0) {
    await expect(changes).toContainText(`+${totals.additions}`, { timeout: 30_000 });
    await expect(changes).toContainText(`−${totals.deletions}`);
  }
  await expect(header(page).getByRole('button', { name: 'Files', exact: true })).toBeVisible();

  const words: string[] = [];
  if (totals.commitsPushed > 0) words.push(plural(totals.commitsPushed, 'commit pushed', 'commits pushed'));
  if (totals.commitsLocal > 0) words.push(plural(totals.commitsLocal, 'commit not pushed', 'commits not pushed'));
  if (totals.uncommittedFiles > 0) words.push(plural(totals.uncommittedFiles, 'file not committed', 'files not committed'));
  expect(words.length).toBeGreaterThan(0);
  for (const word of words) await expect(header(page).getByRole('button', { name: word, exact: true })).toBeVisible();
});

test('Changes, Files, the folder and "files not committed" open the dock on the right tab', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  await closeDock(page);
  const totals = await fixtureTotals(page);

  await header(page).getByRole('button', { name: /^Changes/ }).click();
  await expect(dockTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
  await expect(dock(page).getByRole('radio', { name: 'This conversation' })).toHaveAttribute('aria-checked', 'true');

  await header(page).getByRole('button', { name: 'Files', exact: true }).click();
  await expect(dockTab(page, 'Files')).toHaveAttribute('aria-selected', 'true');

  await header(page).getByRole('button', { name: /^Changes/ }).click();
  await expect(dockTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
  await header(page).getByRole('button', { name: /^~|^\// }).click();
  await expect(dockTab(page, 'Files')).toHaveAttribute('aria-selected', 'true');

  // With the Changes list on screen, "files not committed" moves the chip (FR-8).
  await header(page).getByRole('button', { name: /^Changes/ }).click();
  await expect(dock(page).getByRole('radio', { name: 'This conversation' })).toHaveAttribute('aria-checked', 'true');
  expect(totals.uncommittedFiles).toBeGreaterThan(0);
  await header(page).getByRole('button', { name: /files? not committed$/ }).click();
  await expect(dock(page).getByRole('radio', { name: 'Not committed' })).toHaveAttribute('aria-checked', 'true');
});

test('the ⋯ menu holds the moved actions and row 1 has no copy or detach icon', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  await expect(header(page).getByRole('button', { name: 'Copy link to conversation' })).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Detach conversation' })).toHaveCount(0);

  await header(page).getByLabel('More conversation actions').click();
  const menu = page.getByRole('menu', { name: 'Conversation actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'About this conversation' })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Bookmarks/ })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Show tool calls/ })).toBeVisible();
  // Archive conversation is not listed: a Stage agent pane (AgentPane) passes no
  // onArchived, so the header menu has never offered Archive there.
  for (const name of [/^Copy conversation id/, /^Copy link$/, /^Open in new window$/, /^(Un)?[Ff]avorite$/, /^Regenerate title$/, /^Export transcript$/]) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

for (const theme of ['dark', 'light'] as const) {
  test(`screenshots (${theme})`, async ({ page }) => {
    await openDeck(page, theme);
    await openConversation(page);
    await closeDock(page);
    await expect(header(page).getByRole('button', { name: /^Changes/ })).toContainText('+', { timeout: 30_000 });
    await page.screenshot({ path: path.join(SCREENSHOTS, `conversation-header-${theme}.png`) });
  });
}
