/**
 * File explorer code pane (PAN-5187, PRD section 10): preview tabs, Monaco,
 * autosave and external changes, in a real browser against a real server.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME`, never
 * the operator's live dashboard on :3011) and in its own browser context. The
 * temp home registers one throwaway git project, `uat` (issue prefix UAT),
 * with the workspace `workspaces/feature-uat-1`, so the explorer root
 * `issue:UAT-1` resolves to a directory this spec owns. The PAN-5187
 * workspace itself is never touched.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Seeding: the pane store hydrates from `pan-panes:<deck>` localStorage, so a
 * Files pane for the root is seeded before navigation and the spec drives
 * the real tree from there.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(180_000);

const DECK = 'uat';
const ROOT_ID = 'issue:UAT-1';

let dashboard: IsolatedDashboard;
let repo: string;
let workspace: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function seedProject(home: string): void {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'pan-5187-uat-repo-')));
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

  const fixture = path.join(workspace, 'uat-fixture');
  mkdirSync(fixture);
  for (const name of ['a', 'b', 'c']) {
    writeFileSync(
      path.join(fixture, `${name}.ts`),
      `export function ${name}(value: number): string {\n  return \`${name}: \${value}\`\n}\n`,
    );
  }

  // Real-world TypeScript: a relative import, a Node global and JSX. Without
  // project context, Monaco's semantic checks would flag all three.
  writeFileSync(
    path.join(fixture, 'real.ts'),
    "import { a } from './a'\nimport type { Stats } from 'node:fs'\nexport const port: number = Number(process.env.PORT ?? a(1).length)\nexport type S = Stats\n",
  );
  writeFileSync(
    path.join(fixture, 'view.tsx'),
    "import { useState } from 'react'\nexport function View() {\n  const [n] = useState(0)\n  return <div className=\"x\">{n}</div>\n}\n",
  );

  // PAN-5188's viewers, mounted by the code pane: a 1x1 PNG, a one-page PDF and a CSV.
  writeFileSync(
    path.join(fixture, 'logo.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  );
  writeFileSync(path.join(fixture, 'doc.pdf'), minimalPdf());
  writeFileSync(path.join(fixture, 'table.csv'), 'name,count\nalpha,42\nbeta,7\n');

  // D-C5: a text file just under the 5 MiB editable limit (4.9 MiB).
  const line = '// filler line for the 4.9 MiB save check, padded to a fixed width.......\n';
  writeFileSync(path.join(fixture, 'big.ts'), line.repeat(Math.floor((4.9 * 1024 * 1024) / line.length)));

  writeFileSync(
    path.join(home, 'projects.yaml'),
    `projects:\n  ${DECK}:\n    name: ${DECK}\n    path: ${repo}\n    issue_prefix: UAT\n`,
  );
}

/** A one-page PDF with a correct cross-reference table. */
function minimalPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 18 Tf 20 40 Td (PAN-5187) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
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
}

const treeItem = (page: Page, name: string) => page.getByRole('treeitem').filter({ hasText: name }).first();
const codeTabs = (page: Page) => page.getByRole('tab').filter({ hasText: /\b[abc]\.ts/ });

// Uncaught page errors (a worker that failed to start, a disposed diff
// editor) fail every test here.
const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
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

test('single clicks reuse one italic preview tab, and typing autosaves to disk and pins it', async ({ page }) => {
  await openDeck(page);

  await treeItem(page, 'uat-fixture').click();
  // In an unsplit deck a preview open activates the code tab, so go back to
  // the Files tab before each click, as a user would.
  for (const name of ['a.ts', 'b.ts', 'c.ts']) {
    await page.getByRole('tab').filter({ hasText: 'Files' }).first().click();
    await treeItem(page, name).click();
    await expect(codeTabs(page).first()).toContainText(name);
  }

  // FR-7 preview tabs (f-preview-open.ac5): one code tab, italic, showing c.ts.
  await expect(codeTabs(page)).toHaveCount(1);
  const tab = codeTabs(page).first();
  await expect(tab).toContainText('c.ts');
  await expect(tab.locator('span.italic')).toHaveText('c.ts');

  // Monaco renders the file with syntax highlighting (several token classes).
  const editor = page.locator('.monaco-editor').first();
  await expect(editor.locator('.view-lines')).toContainText('export function c');
  const tokenClasses = await editor
    .locator('.view-lines span[class^="mtk"]')
    .evaluateAll((spans) => new Set(spans.map((s) => s.className)).size);
  expect(tokenClasses).toBeGreaterThan(1);
  await page.screenshot({ path: test.info().outputPath('preview-tab.png') });

  // Autosave (f-code-pane-save.ac6): the marker reaches disk 1 s after typing,
  // and the first edit pins the preview tab.
  const marker = `// pan-5187-marker-${Date.now()}`;
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  // insertText, not type: Monaco 0.55 reads input through the EditContext API,
  // and Playwright's per-key typing never reaches it (Enter, a keydown
  // command, does). Real keyboards and IMEs go through EditContext.
  await page.keyboard.insertText(marker);
  await expect(tab.getByLabel('Unsaved changes')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect
    .poll(() => readFileSync(path.join(workspace, 'uat-fixture', 'c.ts'), 'utf8'), { timeout: 5000 })
    .toContain(marker);
  await expect(tab.locator('span.italic')).toHaveCount(0);
  await expect(tab.getByLabel('Unsaved changes')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('autosaved.png') });

  // The pane's own save never raises the banner: save again, keep typing so
  // the pane is dirty while the watcher echo of that save is handled.
  await page.keyboard.insertText(' A');
  await page.waitForTimeout(1100);
  await page.keyboard.insertText('B');
  await page.waitForTimeout(800);
  await expect(tab.getByLabel('Unsaved changes')).toBeVisible();
  await expect(page.getByTestId('external-change-banner')).toHaveCount(0);
});

test('an external change raises the banner on a dirty pane and reloads a clean one', async ({ page }) => {
  const file = path.join(workspace, 'uat-fixture', 'b.ts');
  await openDeck(page);
  await treeItem(page, 'uat-fixture').click();
  await treeItem(page, 'b.ts').dblclick();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor.locator('.view-lines')).toContainText('export function b');

  // Dirty pane: an edit not yet saved, then another process appends a line.
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('// unsaved edit');
  appendFileSync(file, '// x from another process\n');

  const banner = page.getByTestId('external-change-banner');
  await expect(banner).toContainText('This file changed on disk, and you have unsaved edits.', { timeout: 1000 });
  for (const name of ['Compare', 'Reload from disk', 'Keep my edits', 'Overwrite']) {
    await expect(banner.getByRole('button', { name })).toBeVisible();
  }
  await banner.getByRole('button', { name: 'Compare' }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('external-change-compare.png') });

  await banner.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(banner).toHaveCount(0);
  const plain = page.locator('.monaco-editor').first();
  await expect(plain.locator('.view-lines')).toContainText('x from another process');
  await expect(plain.locator('.view-lines')).not.toContainText('unsaved edit');

  // Clean pane: the next external change reloads the text with no banner.
  appendFileSync(file, '// y from another process\n');
  await expect(plain.locator('.view-lines')).toContainText('y from another process', { timeout: 1000 });
  await expect(banner).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('external-change-reloaded.png') });
});

test('a 4.9 MiB file saves through one WebSocket frame (D-C5)', async ({ page }) => {
  const file = path.join(workspace, 'uat-fixture', 'big.ts');
  const before = readFileSync(file, 'utf8').length;
  await openDeck(page);
  await treeItem(page, 'uat-fixture').click();
  await treeItem(page, 'big.ts').dblclick();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor.locator('.view-lines')).toContainText('filler line', { timeout: 30_000 });
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText('z');
  await expect.poll(() => readFileSync(file, 'utf8').length, { timeout: 15_000 }).toBe(before + 1);
  expect(readFileSync(file, 'utf8').startsWith('z')).toBe(true);
  await expect(page.getByTestId('external-change-banner')).toHaveCount(0);
});

test('real TypeScript and TSX files show no false error squiggles', async ({ page }) => {
  await openDeck(page);
  await treeItem(page, 'uat-fixture').click();
  for (const name of ['real.ts', 'view.tsx']) {
    await page.getByRole('tab').filter({ hasText: 'Files' }).first().click();
    await treeItem(page, name).dblclick();
    const editor = page.locator('.monaco-editor').first();
    await expect(editor.locator('.view-lines')).toContainText('export');
    // Give the TypeScript worker time to publish diagnostics.
    await page.waitForTimeout(3000);
    await page.screenshot({ path: test.info().outputPath(`squiggles-${name}.png`) });
    await expect(editor.locator('.squiggly-error')).toHaveCount(0);
  }
});

test('a PNG, a PDF and a CSV render in code panes through the PAN-5188 viewers', async ({ page }) => {
  await openDeck(page);
  await treeItem(page, 'uat-fixture').click();
  const open = async (name: string) => {
    await page.getByRole('tab').filter({ hasText: 'Files' }).first().click();
    await treeItem(page, name).dblclick();
  };

  await open('logo.png');
  const image = page.getByTestId('code-pane-viewer').locator('img').first();
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1);

  await open('doc.pdf');
  await expect(page.getByTestId('code-pane-viewer').getByLabel('Page 1')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('viewer-pdf.png') });

  await open('table.csv');
  const table = page.getByRole('table', { name: 'table.csv' });
  await expect(table).toContainText('alpha', { timeout: 15_000 });
  await expect(table).toContainText('42');
  // Double click opens permanent panes, even in an unsplit deck: all three stay, none italic.
  for (const name of ['logo.png', 'doc.pdf', 'table.csv']) {
    const tab = page.getByRole('tab').filter({ hasText: name });
    await expect(tab).toHaveCount(1);
    await expect(tab.locator('span.italic')).toHaveCount(0);
  }
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('name,count');
  await page.screenshot({ path: test.info().outputPath('viewer-csv-edit.png') });
});

test('the Context page editor still mounts Monaco with the shared setup', async ({ page }) => {
  // NFR-8: the code pane chunk (with Monaco's all-language bundle) is not loaded here.
  const codePaneChunks: string[] = [];
  page.on('request', (request) => {
    if (/\/CodePane-[^/]*\.js/.test(request.url())) codePaneChunks.push(request.url());
  });
  await page.goto(`${dashboard.baseUrl}/context`, { waitUntil: 'domcontentloaded' });
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('context-editor.png') });
  expect(codePaneChunks).toEqual([]);
});
