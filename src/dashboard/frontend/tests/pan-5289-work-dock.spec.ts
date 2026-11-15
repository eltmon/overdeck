/**
 * The work dock (PAN-5289, WI-24; NFR-5, parent AC-B): Files, Changes,
 * Search and Go to file beside the chat, in a real browser against a real
 * server, plus the four PR screenshots.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and a
 * fake `HOME`, never the operator's live dashboard on :3011) seeded with the
 * shared workflow fixture (`scripts/dev/seed-workflow-fixture.ts`): project
 * `workflow-fixture` ("Workflow fixture") with uncommitted edits to
 * docs/shared.md, a git-ignored build/output.txt, and the conversation
 * "Fixture conversation".
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 * Not in CI's `test:playwright` list (B-D14): it seeds git repositories.
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
const SCREENSHOTS = path.join(REPO_ROOT, 'docs/screenshots/pan-5289');
const DECK = 'workflow-fixture';

test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1920, height: 1000 } });

let dashboard: IsolatedDashboard;
let tmp: string;

const dock = (page: Page): Locator => page.getByTestId('work-dock');
const dockTab = (page: Page, name: string): Locator => dock(page).getByRole('tab', { name: new RegExp(`^${name}`) });

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

async function plusMenu(page: Page, item: RegExp): Promise<void> {
  await page.getByLabel('Open new tab').click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function closeDock(page: Page): Promise<void> {
  if (await dock(page).isVisible()) await dock(page).getByRole('button', { name: 'Hide panel' }).click();
  await expect(dock(page)).toHaveCount(0);
}

/** Open the fixture conversation as a Stage tab (its row in the conversation list). */
async function openConversation(page: Page): Promise<void> {
  await page.getByText('Fixture conversation', { exact: true }).first().click();
  await expect(page.getByRole('tab', { name: /Fixture conversation/ }).first()).toBeVisible({ timeout: 30_000 });
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
  tmp = mkdtempSync(path.join(tmpdir(), 'pan-5289-dock-'));
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

test('the + menu and the Home Files button open the dock', async ({ page }) => {
  await openDeck(page);

  await plusMenu(page, /^Files$/);
  await expect(dockTab(page, 'Files')).toHaveAttribute('aria-selected', 'true');
  await closeDock(page);

  await plusMenu(page, /Changes in Workflow fixture/);
  await expect(dockTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
  await closeDock(page);

  await plusMenu(page, /Go to file…/);
  await expect(page.getByRole('dialog', { name: 'Quick open' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Quick open' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Files', exact: true }).first().click();
  await expect(dockTab(page, 'Files')).toHaveAttribute('aria-selected', 'true');
});

test('the four Files keys work with focus on the page', async ({ page }) => {
  await openDeck(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Control+Shift+E');
  await expect(dockTab(page, 'Files')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Shift+E');
  await expect(dock(page)).toHaveCount(0);

  await page.keyboard.press('Control+Shift+G');
  await expect(dockTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+Shift+F');
  await expect(dockTab(page, 'Search')).toHaveAttribute('aria-selected', 'true');
  await expect(dock(page).getByRole('textbox', { name: 'Search in files' })).toBeFocused();

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Quick open' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('the Files header names the project, and git-ignored files show on request', async ({ page }) => {
  await openDeck(page);
  await plusMenu(page, /^Files$/);
  await expect(dock(page).getByRole('button', { name: /Workflow fixture/ })).toBeVisible();
  await expect(dock(page).locator('[role="treeitem"][data-path="docs"]')).toBeVisible({ timeout: 30_000 });
  await expect(dock(page).locator('[role="treeitem"][data-path="build"]')).toHaveCount(0);
  await dock(page).getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Show git-ignored files/ }).click();
  await expect(dock(page).locator('[role="treeitem"][data-path="build"]')).toBeVisible();
});

test('the keys win inside Monaco and leave the file text unchanged', async ({ page }) => {
  await openDeck(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  // Until the project registry loads there is no root to search (the dock says so), so retry.
  await expect(async () => {
    await page.keyboard.press('Control+P');
    await expect(page.getByRole('dialog', { name: 'Quick open' }).getByRole('combobox')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole('dialog', { name: 'Quick open' }).getByRole('combobox').fill('README.md');
  await page.getByRole('option').filter({ hasText: 'README.md' }).first().click();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  const editorText = () => page.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.textContent ?? '');
  await expect.poll(editorText).toContain('workflow');
  const before = await editorText();

  await page.keyboard.press('Control+Shift+E');
  await expect(dock(page)).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Quick open' })).toBeVisible();
  await page.keyboard.press('Escape');

  expect(await editorText()).toBe(before);
});

test('the fixture conversation lists docs/shared.md under Not committed yet', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  await page.keyboard.press('Control+Shift+G');
  const notCommitted = dock(page).getByRole('group', { name: 'Not committed yet' });
  await expect(notCommitted).toBeVisible({ timeout: 30_000 });
  await expect(notCommitted.locator('[data-change-path="docs/shared.md"]')).toBeVisible();
  await expect(notCommitted).toContainText('Shared file.');
});

test('the diff view renders an uncommitted and a committed file from the real server', async ({ page }) => {
  await openDeck(page);
  await openConversation(page);
  await page.keyboard.press('Control+Shift+G');
  const notCommitted = dock(page).getByRole('group', { name: 'Not committed yet' });
  await expect(notCommitted).toBeVisible({ timeout: 30_000 });

  // Uncommitted: HEAD and the working copy read through the explorer.
  await notCommitted.locator('[data-change-path="docs/shared.md"]').getByTitle('docs/shared.md').click();
  const view = dock(page).getByTestId('dock-diff-view');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-diff-file-path="docs/shared.md"]')).toBeVisible({ timeout: 30_000 });
  await expect(view).not.toContainText("Couldn't load this diff");
  await expect(view).toContainText('not committed');
  await page.screenshot({ path: path.join(process.env.PAN_5289_DIFF_SHOT_DIR ?? tmp, 'diff-uncommitted.png') });

  // Committed: compare <sha>^..<sha> on the fixture repo.
  await view.getByRole('button', { name: 'Back to the list' }).click();
  const commit = dock(page).getByRole('group').filter({ hasText: 'not pushed' }).first();
  await commit.locator('[data-change-path="src/app.ts"]').getByTitle('src/app.ts').click();
  await expect(view.locator('[data-diff-file-path="src/app.ts"]')).toBeVisible({ timeout: 30_000 });
  await expect(view).not.toContainText("Couldn't load this diff");
  await expect(view).toContainText('not pushed');
  await page.screenshot({ path: path.join(process.env.PAN_5289_DIFF_SHOT_DIR ?? tmp, 'diff-committed.png') });
});

test('the keys leave typed text alone in a composer', async ({ page }) => {
  // The fixture conversations have ended (they show Resume Session), and the
  // project Home has no composer since PAN-5294, so this uses the New
  // conversation dialog's First message field, the same kind of textarea.
  await openDeck(page);
  await page.getByRole('button', { name: 'New conversation options' }).last().click();
  await page.getByRole('menuitem', { name: 'New conversation with options…' }).click();
  const composer = page.getByPlaceholder('Sent as soon as the conversation starts');
  await composer.click();
  await composer.fill('draft text');
  await page.keyboard.press('Control+Shift+G');
  await expect(dockTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
  await expect(composer).toHaveValue('draft text');
});

for (const theme of ['light', 'dark'] as const) {
  test(`screenshots (${theme})`, async ({ page }) => {
    await openDeck(page, theme);
    await openConversation(page);
    await closeDock(page);
    await page.keyboard.press('Control+Shift+G');
    await expect(dock(page).getByRole('group', { name: 'Not committed yet' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SCREENSHOTS, `conversation-changes-${theme}.png`) });

    await page.getByRole('tab', { name: /^Home/ }).first().click();
    await plusMenu(page, /^Files$/);
    await expect(dock(page).locator('[role="treeitem"][data-path="docs"]')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SCREENSHOTS, `home-files-${theme}.png`) });
  });
}
