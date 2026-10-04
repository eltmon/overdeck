/**
 * Diff panel Compare view and ignore-whitespace toggle (PAN-4503).
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and
 * port, no Deacon), never the operator's live dashboard on 3011. Each test
 * uses a fresh browser context, so localStorage starts empty.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Every diff route is mocked with `page.route`, so no repository is read: the
 * spec checks that the popout restores a compare from its URL, renders the
 * file list and a patch, re-requests with `ignoreWhitespace=1` when the toggle
 * is pressed, and remembers the toggle across a reload.
 */

import { test, expect, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(180_000);

const NAME = 'pan-4503-uat';
const POPOUT_PATH =
  `/popout/diff?diff=1&prefix=/api/conversations/${NAME}/diffs&agentId=${NAME}` +
  '&repo=/tmp/pan-4503-uat&diffTurnId=compare&diffBase=v1&diffHead=main&diffMode=two-dot';

const B_PATCH = [
  'diff --git a/b.txt b/b.txt',
  'index 45b983b..b1b7161 100644',
  '--- a/b.txt',
  '+++ b/b.txt',
  '@@ -1 +1,2 @@',
  ' hi',
  '+there',
  '',
].join('\n');

const REFS = {
  repoRoot: '/tmp/pan-4503-uat',
  head: { branch: 'main', sha: 'b'.repeat(40) },
  branches: [{ name: 'main', sha: 'b'.repeat(40), remote: false }],
  tags: [{ name: 'v1', sha: 'a'.repeat(40) }],
  commits: [
    { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'Second', date: '2020-01-02T00:00:00Z' },
    { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'First', date: '2020-01-01T00:00:00Z' },
  ],
};

let dashboard: IsolatedDashboard;

/** Mock the diff routes; returns the list of compare request URLs seen so far. */
async function mockDiffRoutes(page: Page): Promise<string[]> {
  const compareRequests: string[] = [];
  await page.route(`**/api/conversations/${NAME}/diffs`, (route) => route.fulfill({ json: { summaries: [] } }));
  await page.route('**/api/diffs/refs**', (route) => route.fulfill({ json: REFS }));
  await page.route('**/api/diffs/compare**', (route) => {
    const url = new URL(route.request().url());
    compareRequests.push(url.toString());
    const ignoreWhitespace = url.searchParams.get('ignoreWhitespace') === '1';
    const files = ignoreWhitespace
      ? [{ path: 'b.txt', kind: 'M', additions: 1, deletions: 0 }]
      : [
          { path: 'a.js', kind: 'M', additions: 2, deletions: 2 },
          { path: 'b.txt', kind: 'M', additions: 1, deletions: 0 },
        ];
    const body: Record<string, unknown> = {
      repoRoot: '/tmp/pan-4503-uat',
      mode: url.searchParams.get('mode') ?? 'two-dot',
      base: { ref: 'v1', sha: 'a'.repeat(40) },
      head: { ref: 'main', sha: 'b'.repeat(40) },
      mergeBase: null,
      files,
    };
    if (url.searchParams.get('file') === 'b.txt') body.diff = B_PATCH;
    return route.fulfill({ json: body });
  });
  return compareRequests;
}

function fileButton(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`) });
}

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

test('compare popout restores refs, renders patches and refetches without whitespace', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const compareRequests = await mockDiffRoutes(page);
    await page.goto(`${dashboard.baseUrl}${POPOUT_PATH}`);

    await expect(page.getByLabel('Compare base ref')).toHaveValue('v1');
    await expect(page.getByLabel('Compare head ref')).toHaveValue('main');
    await expect(fileButton(page, 'a.js')).toBeVisible();
    await expect(fileButton(page, 'b.txt')).toBeVisible();
    expect(compareRequests[0]).toContain('repo=%2Ftmp%2Fpan-4503-uat');
    expect(compareRequests[0]).toContain('base=v1');
    expect(compareRequests[0]).toContain('head=main');

    await fileButton(page, 'b.txt').click();
    await expect(page.getByText('there', { exact: true }).first()).toBeVisible();
    expect(page.url()).toContain('diffFilePath=b.txt');
    expect(page.url()).toContain('diffBase=v1');

    await page.getByRole('button', { name: 'Ignore whitespace changes' }).click();
    const toggle = page.getByRole('button', { name: 'Show whitespace changes' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => compareRequests.at(-1) ?? '').toContain('ignoreWhitespace=1');

    // Back to the file list: the Compare chip keeps the refs and drops the file.
    await page.getByRole('button', { name: 'Compare…' }).click();
    await expect(fileButton(page, 'b.txt')).toBeVisible();
    await expect(fileButton(page, 'a.js')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Show whitespace changes' })).toHaveAttribute('aria-pressed', 'true');

    const second = await context.newPage();
    await mockDiffRoutes(second);
    await second.goto(`${dashboard.baseUrl}${POPOUT_PATH}`);
    await expect(second.getByLabel('Compare base ref')).toHaveValue('v1');
    await expect(fileButton(second, 'b.txt')).toBeVisible();
    await expect(fileButton(second, 'a.js')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('applying new refs writes them to the URL', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const compareRequests = await mockDiffRoutes(page);
    await page.goto(`${dashboard.baseUrl}${POPOUT_PATH}`);
    await expect(fileButton(page, 'a.js')).toBeVisible();

    await page.getByLabel('Compare base ref').fill('aaaaaaa');
    await page.getByLabel('Three-dot compare').click();
    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    await expect.poll(() => page.url()).toContain('diffBase=aaaaaaa');
    expect(page.url()).toContain('diffTurnId=compare');
    expect(page.url()).toContain('diffHead=main');
    expect(page.url()).toContain('diffMode=three-dot');
    await expect.poll(() => compareRequests.at(-1) ?? '').toContain('mode=three-dot');
  } finally {
    await context.close();
  }
});
