/**
 * Explorer file actions (PAN-5190, WI-E13): create, rename, delete with undo,
 * drag move, OS drop and duplicate, in a real browser against a real server,
 * each checked on disk.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME`, never
 * the operator's live dashboard on :3011) in its own browser context. The temp
 * home registers one throwaway git project, `uat` (issue prefix UAT), with the
 * workspace `workspaces/feature-uat-1`, so the explorer root `issue:UAT-1`
 * resolves to a directory this spec owns.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 * The scenarios run in order and share the workspace.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

const DECK = 'uat';
const ROOT_ID = 'issue:UAT-1';
const DROPPED_BYTES = Array.from({ length: 256 }, (_, i) => (i * 7) % 256);

let dashboard: IsolatedDashboard;
let home: string;
let repo: string;
let workspace: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function seedProject(): void {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'pan-5190-uat-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'uat');
  git(repo, 'config', 'user.email', 'uat@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(repo, '.gitignore'), 'workspaces/\n');
  writeFileSync(path.join(repo, 'README.md'), '# uat\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/uat-1', 'workspaces/feature-uat-1');
  workspace = path.join(repo, 'workspaces', 'feature-uat-1');

  mkdirSync(path.join(workspace, 'src'));
  writeFileSync(path.join(workspace, 'src', 'keep.ts'), 'export const keep = 1\n');
  mkdirSync(path.join(workspace, 'docs'));
  writeFileSync(path.join(workspace, 'docs', 'guide.md'), '# guide\n');
  writeFileSync(path.join(workspace, 'a.txt'), 'alpha\n');

  writeFileSync(
    path.join(home, 'projects.yaml'),
    `projects:\n  ${DECK}:\n    name: ${DECK}\n    path: ${repo}\n    issue_prefix: UAT\n`,
  );
}

async function openDeck(page: Page): Promise<void> {
  await page.addInitScript(
    ({ deck, rootId }) => {
      localStorage.setItem('overdeck.ui.sidebarCollapsed', 'true');
      localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
      localStorage.setItem(
        `pan-panes:${deck}`,
        JSON.stringify([
          { paneId: 'home', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true },
          { paneId: 'files-uat', paneType: 'files', label: 'Files', createdAt: 2, explorerRootId: rootId },
        ]),
      );
      localStorage.setItem(`pan-active-pane:${deck}`, 'files-uat');
    },
    { deck: DECK, rootId: ROOT_ID },
  );
  await page.goto(`${dashboard.baseUrl}/command-deck/${DECK}`, { waitUntil: 'domcontentloaded' });
  await expect(row(page, 'docs')).toBeVisible({ timeout: 30_000 });
}

const row = (page: Page, rootPath: string): Locator => page.locator(`[role="treeitem"][data-path="${rootPath}"]`);
const tree = (page: Page): Locator => page.getByRole('tree');
const ws = (...parts: string[]): string => path.join(workspace, ...parts);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** In an unsplit deck an opened file takes over; go back to the Files tab. */
async function showFiles(page: Page): Promise<void> {
  await page.getByRole('tab').filter({ hasText: 'Files' }).first().click();
  await expect(tree(page)).toBeVisible();
}

/** Expand a folder row (a folder click toggles it and opens nothing). */
async function expand(page: Page, rootPath: string): Promise<void> {
  if ((await row(page, rootPath).getAttribute('aria-expanded')) !== 'true') await row(page, rootPath).click();
  await expect(row(page, rootPath)).toHaveAttribute('aria-expanded', 'true');
}

/** Select a row without opening a preview: right-click selects it, Escape closes the menu. */
async function selectRow(page: Page, rootPath: string): Promise<void> {
  await row(page, rootPath).click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(row(page, rootPath)).toHaveAttribute('aria-selected', 'true');
}

/** Dispatch an explorer row drag over `target` in the page, with the real drag payload types. */
async function dragPayloadOver(target: Locator, paths: string[], drop: boolean): Promise<void> {
  await target.evaluate(
    (el, { rootId, paths, drop }) => {
      const dt = new DataTransfer();
      dt.setData('application/x-overdeck-paths', paths.join('\n'));
      dt.setData('application/x-overdeck-explorer', JSON.stringify({ rootId, paths }));
      const fire = (type: string) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire('dragenter');
      fire('dragover');
      if (drop) fire('drop');
    },
    { rootId: ROOT_ID, paths, drop },
  );
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
  home = mkdtempSync(path.join(tmpdir(), 'overdeck-e2e-home-'));
  seedProject();
  dashboard = await startIsolatedDashboard({ home });
});

test.afterAll(async () => {
  await dashboard?.stop();
  if (repo) rmSync(repo, { recursive: true, force: true });
});

test('1. New file from the folder menu creates it on disk and opens a code tab', async ({ page }) => {
  await openDeck(page);
  await row(page, 'src').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New file' }).click();
  const input = page.getByRole('textbox', { name: 'New file name' });
  await expect(input).toBeFocused();
  await input.fill('new.ts');
  await input.press('Enter');

  await expect.poll(() => existsSync(ws('src', 'new.ts'))).toBe(true);
  await expect(page.getByRole('tab').filter({ hasText: 'new.ts' })).toHaveCount(1);
});

test('2. F2 renames the row on disk and retargets its code tab', async ({ page }) => {
  // Each test has a fresh browser context: open the file's code tab again.
  await openDeck(page);
  await expand(page, 'src');
  await row(page, 'src/new.ts').dblclick();
  await expect(page.getByRole('tab').filter({ hasText: 'new.ts' })).toHaveCount(1);
  await showFiles(page);
  await selectRow(page, 'src/new.ts');
  await tree(page).press('F2');
  const input = page.getByRole('textbox', { name: 'Rename new.ts' });
  await expect(input).toBeFocused();
  await input.fill('renamed.ts');
  await input.press('Enter');

  await expect.poll(() => existsSync(ws('src', 'renamed.ts'))).toBe(true);
  expect(existsSync(ws('src', 'new.ts'))).toBe(false);
  await expect(page.getByRole('tab').filter({ hasText: 'renamed.ts' })).toHaveCount(1);
  await expect(page.getByRole('tab').filter({ hasText: 'new.ts' })).toHaveCount(0);
});

test('3. Delete moves the file to the Overdeck trash, and Ctrl+Z restores the same bytes', async ({ page }) => {
  const file = ws('src', 'renamed.ts');
  writeFileSync(file, 'export const renamed = 42\n');
  const before = readFileSync(file);

  await openDeck(page);
  await expand(page, 'src');
  await expect(row(page, 'src/renamed.ts')).toBeVisible();
  await selectRow(page, 'src/renamed.ts');
  await tree(page).press('Delete');

  await expect.poll(() => existsSync(file)).toBe(false);
  const trashRoot = path.join(home, 'trash');
  expect(readdirSync(trashRoot)).toEqual(['issue-UAT-1']);
  expect(readdirSync(path.join(trashRoot, 'issue-UAT-1'))).toHaveLength(1);
  await expect(page.getByText('Moved renamed.ts to the Overdeck trash')).toBeVisible();

  await tree(page).focus();
  await tree(page).press('Control+z');
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(sha256(readFileSync(file))).toBe(sha256(before));
});

test('4. Dragging a row onto a folder moves it there', async ({ page }) => {
  await openDeck(page);
  await row(page, 'a.txt').dragTo(row(page, 'docs'));
  // Give the move a moment to land before deciding dragTo fired no HTML5 drag events.
  const moved = await expect.poll(() => existsSync(ws('docs', 'a.txt')), { timeout: 3000 }).toBe(true).then(() => true, () => false);
  test.info().annotations.push({ type: 'drag', description: moved ? 'locator.dragTo' : 'dispatched DragEvents (fallback)' });
  if (!moved) {
    // Checkpoint fallback: Chromium's dragTo did not fire HTML5 drag events,
    // so dispatch them with the real payload types.
    await dragPayloadOver(row(page, 'docs'), ['a.txt'], true);
  }
  await expect.poll(() => existsSync(ws('docs', 'a.txt'))).toBe(true);
  expect(existsSync(ws('a.txt'))).toBe(false);
});

test('5. Files dropped from the OS onto a folder upload with the same bytes', async ({ page }) => {
  await openDeck(page);
  await row(page, 'docs').evaluate((el, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'dropped.bin'));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, DROPPED_BYTES);

  await expect.poll(() => existsSync(ws('docs', 'dropped.bin'))).toBe(true);
  expect(sha256(readFileSync(ws('docs', 'dropped.bin')))).toBe(sha256(Uint8Array.from(DROPPED_BYTES)));
});

test('6. Duplicate creates the first free copy name', async ({ page }) => {
  await openDeck(page);
  await expand(page, 'docs');
  await expect(row(page, 'docs/a.txt')).toBeVisible();
  // The click on a file schedules a preview; right-click first, so nothing opens.
  await row(page, 'docs/a.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect.poll(() => existsSync(ws('docs', 'a copy.txt'))).toBe(true);
  expect(readFileSync(ws('docs', 'a copy.txt'), 'utf8')).toBe('alpha\n');
});

test('7. A drag over a folder highlights it as the drop target', async ({ page }) => {
  await openDeck(page);
  await dragPayloadOver(row(page, 'docs'), ['README.md'], false);
  await expect(row(page, 'docs')).toHaveClass(/bg-accent\/60/);
  await tree(page).screenshot({ path: path.join('test-results', 'pan-5190-drop-target.png') });
  await row(page, 'docs').evaluate((el) => el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body })));
});
