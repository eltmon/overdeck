/**
 * Code beside the chat, the editor bar, Create PR and stale tabs (PAN-5290,
 * WI-12; parent AC-C, NFR-6), in a real browser against a real server, plus
 * the six screen-3 screenshots in light and dark.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and a
 * fake `HOME`, never the operator's live dashboard on :3011) seeded with the
 * shared workflow fixture (`scripts/dev/seed-workflow-fixture.ts`): project
 * `workflow-fixture` with conversation `fixture-1`, whose uncommitted lines
 * 21-24 of docs/shared.md the gutter marks, and `fixture-2`'s lines 25-26,
 * which it must not mark.
 *
 * The edit workspace (Start editing, the changes route, discard, the stale
 * tab) runs for real. The fixture has no GitHub repository, so the PR states
 * (open and blocked, mergeable, merged) come from `page.route` stubs of the
 * edit-workspace status, changes and merge calls (C-D15).
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
const SCREENSHOTS = path.join(REPO_ROOT, 'docs/screenshots/pan-5290');
const DECK = 'workflow-fixture';

test.setTimeout(240_000);
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1920, height: 1000 } });

let dashboard: IsolatedDashboard;
let tmp: string;

const bar = (page: Page): Locator => page.getByTestId('code-pane').getByTestId('editor-bar');
const barText = (page: Page): Locator => bar(page).getByTestId('editor-bar-sentence');
const dock = (page: Page): Locator => page.getByTestId('work-dock');

async function openDeck(page: Page, theme: 'light' | 'dark'): Promise<void> {
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
}

/** Go to file with the conversation active: the file opens beside it. */
async function openFileBeside(page: Page, file: string): Promise<void> {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(async () => {
    await page.keyboard.press('Control+P');
    await expect(page.getByRole('dialog', { name: 'Quick open' }).getByRole('combobox')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole('dialog', { name: 'Quick open' }).getByRole('combobox').fill(file);
  await page.getByRole('option').filter({ hasText: path.basename(file) }).first().click();
  await expect(page.getByTestId('code-pane').locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
}

interface StoredPane {
  paneId: string;
  paneType: string;
  explorerRootId?: string;
  explorerPath?: string;
  conversationId?: string;
}

async function storedPanes(page: Page): Promise<StoredPane[]> {
  return page.evaluate(() => {
    const panes: StoredPane[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('pan-panes:')) panes.push(...(JSON.parse(localStorage.getItem(key) ?? '[]') as StoredPane[]));
    }
    return panes;
  });
}

async function codePaneRoot(page: Page, file: string): Promise<string | undefined> {
  return (await storedPanes(page)).find((p) => p.paneType === 'code' && p.explorerPath === file)?.explorerRootId;
}

/** Line numbers of the visible margin rows that carry a gutter mark. */
async function markedLines(page: Page): Promise<string[]> {
  return page.getByTestId('code-pane').evaluate((pane) =>
    [...pane.querySelectorAll('.margin-view-overlays > div')]
      .filter((row) => row.querySelector('.code-changed-line'))
      .map((row) => row.querySelector('.line-numbers')?.textContent?.trim() ?? '')
      .sort((a, b) => Number(a) - Number(b)),
  );
}

async function cursorLine(page: Page): Promise<string> {
  return page.getByTestId('code-pane').locator('.line-numbers.active-line-number').first().innerText();
}

/** POST through the dashboard session the page holds (CSRF header included). */
async function postFromPage(page: Page, url: string, body: unknown): Promise<number> {
  return page.evaluate(
    async ({ url, body }) => {
      const session = await fetch('/api/dashboard/session', { method: 'POST', credentials: 'include' });
      const { csrfToken } = (await session.json()) as { csrfToken?: string };
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-overdeck-csrf-token': csrfToken ?? '' },
        body: JSON.stringify(body),
      });
      return res.status;
    },
    { url, body },
  );
}

async function shot(page: Page, name: string, theme: string): Promise<void> {
  // A dialog fades in: wait for every running animation to finish.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-${theme}.png`) });
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
  tmp = mkdtempSync(path.join(tmpdir(), 'pan-5290-editor-bar-'));
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

for (const theme of ['light', 'dark'] as const) {
  test(`code beside the chat, the editor bar, Create PR, PR states and a stale tab (${theme})`, async ({ page }) => {
    await openDeck(page, theme);
    await openConversation(page);

    // ── Code beside the chat with the conversation's gutter marks ──────────────
    await openFileBeside(page, 'docs/shared.md');
    // Panes persist on a debounce.
    await expect
      .poll(async () => (await storedPanes(page)).map((p) => `${p.paneType}:${p.conversationId ?? p.explorerPath ?? ''}`), { timeout: 10_000 })
      .toEqual(expect.arrayContaining(['agent:fixture-1', 'code:docs/shared.md']));
    const panes = await storedPanes(page);
    const chat = panes.find((p) => p.paneType === 'agent' && p.conversationId === 'fixture-1');
    const code = panes.find((p) => p.paneType === 'code' && p.explorerPath === 'docs/shared.md');
    const layout = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('pan-layout:')).map((k) => localStorage.getItem(k)).join('\n'),
    );
    expect(layout).toContain(chat!.paneId);
    expect(layout).toContain(code!.paneId);

    const api = await page.request.get(`${dashboard.baseUrl}/api/conversations/fixture-1/changes/lines?file=docs/shared.md`);
    expect(await api.json()).toEqual({ path: 'docs/shared.md', lines: [21, 22, 23, 24] });
    await expect.poll(() => markedLines(page), { timeout: 30_000 }).toEqual(['21', '22', '23', '24']);
    await expect(page.getByTestId('code-pane-breadcrumb')).toHaveText(/^Workflow fixture›docs›shared\.md$/);

    // ── Read-only bar, then Start editing keeps the cursor ─────────────────────
    await expect(barText(page)).toHaveText(/^This is the main checkout\./);
    const editor = page.getByTestId('code-pane').locator('.monaco-editor');
    await editor.click();
    await page.keyboard.press('Control+Home');
    for (let i = 1; i < 15; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(() => cursorLine(page)).toBe('15');
    await shot(page, 'readonly-bar', theme);

    await bar(page).getByRole('button', { name: 'Start editing' }).click();
    await expect(barText(page)).toHaveText(/^Editing in /, { timeout: 60_000 });
    await expect.poll(() => codePaneRoot(page, 'docs/shared.md')).toMatch(/^workspace:/);
    await expect.poll(() => cursorLine(page)).toBe('15');
    const editRoot = (await codePaneRoot(page, 'docs/shared.md'))!;
    const workspaceId = editRoot.slice('workspace:'.length);

    // Type a line; once saved, the bar counts the changed files.
    await page.getByTestId('code-pane').locator('.monaco-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('Edited by the PAN-5290 UAT.\n');
    await expect(barText(page)).toHaveText(/ · [1-9]\d* files? changed \+\d+ −\d+ · All edits saved$/, { timeout: 30_000 });
    await shot(page, 'editing-bar', theme);

    // ── Create PR lists what will land and both landing choices ─────────────────
    await bar(page).getByRole('button', { name: 'Create PR' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a pull request' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('create-pr-files')).toContainText('docs/shared.md');
    await expect(dialog.getByTestId('create-pr-files').locator('li').filter({ hasText: 'docs/shared.md' })).toContainText(/\+\d+ −\d+/);
    for (const name of [/Open a pull request/, /Send through the pipeline/]) {
      // The fixture has no GitHub repository: both choices are disabled with the reason.
      await expect(dialog.getByRole('radio', { name })).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(dialog.getByTestId('create-pr-direct-note')).toContainText('github_repo');
    await shot(page, 'create-pr', theme);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    // ── PR states from stubbed routes (C-D15) ──────────────────────────────────
    let prBody: Record<string, unknown> = {
      url: 'https://github.com/eltmon/workflow-fixture/pull/42', number: 42, state: 'OPEN', isDraft: false,
      mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', headSha: 'abc', canMerge: false, reason: 'Required checks or reviews are not met',
      checksPassing: false,
    };
    await page.route(`**/api/explorer/edit-workspaces/${workspaceId}`, async (route) => {
      const real = await route.fetch();
      const status = (await real.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...status, pr: prBody, unpushedCommits: false, prSupport: { available: true, reason: null } } });
    });
    await page.route(`**/api/explorer/edit-workspaces/${workspaceId}/changes`, async (route) => {
      const real = await route.fetch();
      const changes = (await real.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...changes, uncommittedPaths: [] } });
    });
    let mergeCalls = 0;
    await page.route(`**/api/explorer/edit-workspaces/${workspaceId}/merge`, (route) => {
      mergeCalls += 1;
      return route.fulfill({ json: { merged: true } });
    });

    // The status was read before the stubs; without a PR the bar has no Refresh, so reload to read it again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(barText(page)).toHaveText('PR #42 is open · Required checks or reviews are not met.', { timeout: 30_000 });
    const merge = bar(page).getByRole('button', { name: 'Merge' });
    await expect(merge).toBeDisabled();
    await expect(merge).toHaveAttribute('title', 'Required checks or reviews are not met');
    await shot(page, 'pr-open', theme);

    prBody = { ...prBody, mergeStateStatus: 'UNSTABLE', canMerge: true, reason: null, checksPassing: false };
    await bar(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(barText(page)).toHaveText('PR #42 · no conflicts, but its checks have not all passed.');
    await expect(merge).toBeEnabled();
    await merge.click();
    const confirm = page.getByTestId('merge-anyway-dialog');
    await expect(confirm).toBeVisible();
    await shot(page, 'pr-checks-pending', theme);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    expect(mergeCalls).toBe(0);

    prBody = { ...prBody, mergeStateStatus: 'CLEAN', canMerge: true, reason: null, checksPassing: true };
    await bar(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(barText(page)).toHaveText('PR #42 · no conflicts. Merging squashes it into main.');
    await expect(merge).toBeEnabled();
    await merge.click();
    await expect(barText(page)).toHaveText(/^Merged PR #42 into main\./);
    await expect.poll(() => codePaneRoot(page, 'docs/shared.md')).toBe(`project:${DECK}`);
    await shot(page, 'merged-note', theme);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // ── Stale tab: a code tab on the edit workspace, which is then discarded ────
    await page.keyboard.press('Control+Shift+E');
    await dock(page).getByRole('button', { name: /Workflow fixture/ }).click();
    await page.getByRole('menu', { name: 'Files root' }).getByRole('menuitemradio').filter({ hasText: /^edit-/ }).first().click();
    const readme = dock(page).locator('[role="treeitem"][data-path="README.md"]');
    await expect(readme).toBeVisible({ timeout: 30_000 });
    await readme.dblclick();
    await expect.poll(() => codePaneRoot(page, 'README.md')).toBe(editRoot);

    expect(await postFromPage(page, `/api/explorer/edit-workspaces/${workspaceId}/discard`, { closePr: false })).toBe(200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const stale = page.getByTestId('code-pane-stale');
    await expect(async () => {
      if (!(await stale.isVisible())) await page.getByRole('tab', { name: /README\.md/ }).first().click();
      await expect(stale).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60_000 });
    await expect(stale).toContainText('This edit workspace was merged or discarded.');
    await expect(stale.getByRole('button', { name: 'Open on main' })).toBeEnabled();
    await expect(stale.getByRole('button', { name: 'Close tab' })).toBeVisible();
    await shot(page, 'stale-tab', theme);
  });
}
