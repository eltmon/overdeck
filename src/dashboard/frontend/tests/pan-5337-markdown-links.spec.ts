/**
 * Markdown preview links (PAN-5337): a relative link in a code pane's or an
 * editor pane's Preview opens the linked file through the explorer instead
 * of a 404 browser tab, in a real browser against a real server.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME`, never
 * the operator's live dashboard on :3011) and in its own browser context.
 * The temp home registers one throwaway git repo as project `p5337uat`, so
 * the explorer root `project:p5337uat` resolves to a directory this spec
 * owns; no feature workspace is needed since the fixture lives at the
 * project root.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Seeding: the pane store hydrates from `pan-panes:<deck>` localStorage, so a
 * pane is seeded before navigation (a Files pane for the code-pane path, an
 * editor pane by absolute path for the editor-pane path — the operator's
 * repro is chat chip -> editor pane -> Preview, and seeding the pane directly
 * exercises the same explorerLocationForPath route without a live agent).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(180_000);

const DECK = 'p5337uat';
const ROOT_ID = 'project:p5337uat';

let dashboard: IsolatedDashboard;
let repo: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function seedProject(home: string): void {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'pan-5337-uat-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'uat');
  git(repo, 'config', 'user.email', 'uat@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');

  mkdirSync(path.join(repo, 'docs'));
  mkdirSync(path.join(repo, 'docs', 'levels'));

  // 120 lines clears the fold in both the narrower code-pane column (beside
  // the Files tree) and the wider, single-column editor-pane layout.
  const filler = Array.from({ length: 120 }, (_, i) => `Filler line ${i + 1} to push Details below the fold.`).join('\n');
  writeFileSync(
    path.join(repo, 'docs', 'index.md'),
    `# Index\n\n[Fort](fort3d.md) [Levels](levels/) [Down](#details) [Gone](missing.md) [Web](https://example.com)\n\n${filler}\n\n## Details\n\nFound it.\n`,
  );
  writeFileSync(path.join(repo, 'docs', 'fort3d.md'), '# Fort\n');
  writeFileSync(path.join(repo, 'docs', 'levels', 'a.md'), '# A\n');
  writeFileSync(path.join(repo, 'README.md'), '# pan-5337-uat\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');

  writeFileSync(
    path.join(home, 'projects.yaml'),
    `projects:\n  ${DECK}:\n    name: ${DECK}\n    path: ${repo}\n    issue_prefix: PFIVE\n`,
  );
}

async function openDeckWithFiles(page: Page): Promise<void> {
  await page.addInitScript(
    ({ deck, rootId }) => {
      localStorage.setItem('overdeck.ui.sidebarCollapsed', 'true');
      localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
      localStorage.setItem(
        `pan-panes:${deck}`,
        JSON.stringify([
          { paneId: 'home', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true },
          { paneId: 'files-p5337', paneType: 'files', label: 'Files', createdAt: 2, explorerRootId: rootId },
        ]),
      );
      localStorage.setItem(`pan-active-pane:${deck}`, 'files-p5337');
    },
    { deck: DECK, rootId: ROOT_ID },
  );
  await page.goto(`${dashboard.baseUrl}/command-deck/${DECK}`, { waitUntil: 'domcontentloaded' });
}

async function openDeckWithEditor(page: Page, filePath: string): Promise<void> {
  await page.addInitScript(
    ({ deck, filePath: fp }) => {
      localStorage.setItem('overdeck.ui.sidebarCollapsed', 'true');
      localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
      localStorage.setItem(
        `pan-panes:${deck}`,
        JSON.stringify([
          { paneId: 'home', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true },
          { paneId: 'editor-p5337', paneType: 'editor', label: 'index.md', createdAt: 2, editorFilePath: fp },
        ]),
      );
      localStorage.setItem(`pan-active-pane:${deck}`, 'editor-p5337');
    },
    { deck: DECK, filePath },
  );
  await page.goto(`${dashboard.baseUrl}/command-deck/${DECK}`, { waitUntil: 'domcontentloaded' });
}

const treeItem = (page: Page, name: string) => page.getByRole('treeitem').filter({ hasText: name }).first();

/**
 * Down, Gone, Web and Levels — every link type except Fort, which each
 * caller checks on its own since opening a file changes the pane layout.
 */
async function checkNonFileLinks(page: Page, context: BrowserContext, preview: Locator): Promise<void> {
  const urlBefore = page.url();
  const pagesBefore = context.pages().length;

  // Down: scrolls the heading into view inside the preview, never touching
  // the URL. Asserted out of view first so the in-view check can't pass on a
  // heading that never needed scrolling.
  const details = preview.getByRole('heading', { name: 'Details' });
  await expect(details).not.toBeInViewport();
  await preview.getByRole('link', { name: 'Down' }).click();
  await expect(details).toBeInViewport();
  expect(page.url()).toBe(urlBefore);

  // Gone: a dashed, inert span — no navigation, no new page.
  const gone = preview.getByText('Gone', { exact: true });
  await expect(gone).toHaveAttribute('data-doc-link-state', 'missing');
  await expect(gone).toHaveAttribute('aria-disabled', 'true');
  await expect(gone).toHaveCSS('text-decoration-style', 'dashed');
  await gone.click();
  expect(context.pages().length).toBe(pagesBefore);
  expect(page.url()).toBe(urlBefore);

  // Web: opens a new browser tab (routed to a local stub, no real network).
  const [popup] = await Promise.all([context.waitForEvent('page'), preview.getByRole('link', { name: 'Web' }).click()]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  expect(popup.url()).toContain('example.com');
  await popup.close();
  expect(page.url()).toBe(urlBefore);

  // Levels: reveals the folder in the Files dock — no new tab, same URL.
  await preview.getByRole('link', { name: 'Levels' }).click();
  await expect(treeItem(page, 'levels')).toHaveAttribute('aria-selected', 'true');
  expect(context.pages().length).toBe(pagesBefore);
  expect(page.url()).toBe(urlBefore);
}

// Uncaught page errors fail every test here.
const pageErrors: string[] = [];
test.beforeEach(async ({ page, context }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
  );
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test.beforeAll(async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'overdeck-e2e-home-'));
  seedProject(home);
  dashboard = await startIsolatedDashboard({ home });
});

test.afterAll(async () => {
  await dashboard?.stop();
  if (repo) rmSync(repo, { recursive: true, force: true });
});

test('code pane Preview resolves every link type (code-pane-preview-links.ac3)', async ({ page, context }) => {
  await openDeckWithFiles(page);

  await treeItem(page, 'docs').click();
  await treeItem(page, 'index.md').click();
  await page.getByRole('tab', { name: 'Preview' }).click();
  const preview = page.getByTestId('code-pane-markdown');
  await expect(preview.getByRole('heading', { name: 'Index' })).toBeVisible();

  await checkNonFileLinks(page, context, preview);
  await expect(page.getByRole('tab').filter({ hasText: 'index.md' })).toHaveCount(1);

  const urlBefore = page.url();
  const pagesBefore = context.pages().length;

  // Fort: opens docs/fort3d.md in the root's one preview tab — no new tab, same URL.
  await preview.getByRole('link', { name: 'Fort' }).click();
  await expect(page.getByRole('tab').filter({ hasText: 'fort3d.md' })).toHaveCount(1);
  await expect(page.getByRole('tab').filter({ hasText: 'index.md' })).toHaveCount(0);
  await expect(page.getByTestId('code-pane-header')).toContainText('docs/fort3d.md');
  expect(context.pages().length).toBe(pagesBefore);
  expect(page.url()).toBe(urlBefore);

  await page.screenshot({ path: test.info().outputPath('code-pane-preview-links.png') });
});

test('editor pane Preview resolves every link type (editor-pane-preview-links.ac3)', async ({ page, context }) => {
  await openDeckWithEditor(page, path.join(repo, 'docs', 'index.md'));

  await expect(page.getByTestId('editor-pane-textarea')).toBeVisible();
  await page.getByRole('tab', { name: 'Preview' }).click();
  const preview = page.getByTestId('markdown-tab');
  await expect(preview.getByRole('heading', { name: 'Index' })).toBeVisible();

  await checkNonFileLinks(page, context, preview);

  const urlBefore = page.url();
  const pagesBefore = context.pages().length;
  const indexTab = page.getByRole('tab').filter({ hasText: 'index.md' });
  await expect(indexTab).toHaveCount(1);

  // The operator's repro: chat chip -> editor pane -> Preview -> fort3d.md
  // opens a code pane on docs/fort3d.md beside it, never a browser tab. See
  // the commit body for a pre-existing Stage draft-loss finding from writing
  // this check, not asserted here and not fixed in this item.
  await preview.getByRole('link', { name: 'Fort' }).click();
  await expect(page.getByRole('tab').filter({ hasText: 'fort3d.md' })).toBeVisible();
  await expect(page.getByTestId('code-pane-header')).toContainText('docs/fort3d.md');
  expect(context.pages().length).toBe(pagesBefore);
  expect(page.url()).toBe(urlBefore);
  await expect(indexTab).toHaveCount(1);

  await page.screenshot({ path: test.info().outputPath('editor-pane-preview-links.png') });
});
