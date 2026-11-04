/**
 * PAN-4661 — the phone pipeline tab at /m/pipeline, proved at 390×844 on an
 * isolated dashboard (its own temp `OVERDECK_HOME` and port), never the
 * operator's live one. `npm run build` first: the fixture serves the built
 * frontend from `dist`.
 *
 * Seeding strategy: `EventRouter`'s instant-render path reads the
 * `pan-snapshot-cache-v1` localStorage entry and calls `syncSnapshot`
 * synchronously on mount, before any WebSocket bootstrap (D-4661-14). An
 * `addInitScript`-seeded snapshot populates the store immediately; `/ws/rpc`
 * is then closed so the WS-only bootstrap can never overwrite the seeded
 * cast with a real, empty one — the same pattern pan-4523-river-bands.spec.ts
 * and pan-2355-mobile.spec.ts use.
 *
 * Test A proves the grouped list, the Needs you mark, tap targets, scrollX
 * and the sheet round trip. Test B proves tab navigation from /m and the
 * not-found sheet. Both record every request and assert /m/pipeline issues
 * no `/api/` request beyond the set the shell already issues from /m (the
 * PRD's implementation checkpoint): rather than hard-code that set, the spec
 * measures it live from /m's own Needs-you tab load before comparing.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { DashboardSnapshot } from '@overdeck/contracts';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-4661';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const NOW = Date.now();

function iso(offsetMs = 0): string {
  return new Date(NOW + offsetMs).toISOString();
}

function buildSnapshot(): DashboardSnapshot {
  const LONG_TITLE = 'A very long work-item title that should wrap across two lines on a 390 px wide phone screen instead of overflowing';
  const issues = [
    { id: 'PAN-90001', identifier: 'PAN-90001', title: 'Ready to ship', labels: [], priority: 2, state: 'open', status: 'open', url: 'https://example.com/PAN-90001', createdAt: iso(-60_000), updatedAt: iso(-60_000) },
    { id: 'PAN-90002', identifier: 'PAN-90002', title: 'Needs your review', labels: [], priority: 1, state: 'open', status: 'open', url: 'https://example.com/PAN-90002', createdAt: iso(-50_000), updatedAt: iso(-50_000) },
    { id: 'PAN-90003', identifier: 'PAN-90003', title: LONG_TITLE, labels: [], priority: 2, state: 'open', status: 'open', url: 'https://example.com/PAN-90003', createdAt: iso(-40_000), updatedAt: iso(-40_000) },
    { id: 'PAN-90004', identifier: 'PAN-90004', title: 'Planned next', labels: [], priority: 3, state: 'open', status: 'open', url: 'https://example.com/PAN-90004', createdAt: iso(-30_000), updatedAt: iso(-30_000) },
  ];
  const derivedIssueStates = [
    { issueId: 'PAN-90001', state: 'ready' },
    { issueId: 'PAN-90002', state: 'in-review', attention: 'needs-you' },
    { issueId: 'PAN-90003', state: 'working' },
    { issueId: 'PAN-90004', state: 'planned' },
  ];
  return {
    sequence: 1,
    timestamp: iso(),
    specialists: [],
    backendPanes: [],
    agents: [],
    issues,
    derivedIssueStates,
  } as unknown as DashboardSnapshot;
}

async function installFixtures(page: Page): Promise<void> {
  const cacheEntry = { data: buildSnapshot(), timestamp: iso() };
  await page.addInitScript((entry) => {
    localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify(entry));
  }, cacheEntry);

  await page.route('**/api/conversations/pending-input', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/conversations', (route) => route.fulfill({ json: [] }));
  // The isolated server's WS upgrade auth never consults loopback/peer trust,
  // so a fresh browser context has no credential and the real handshake
  // fails anyway. Close it immediately so the app falls back to the seeded
  // cache instead of racing a bootstrap that will time out.
  await page.routeWebSocket(/\/ws\/rpc/, (ws) => ws.close());
}

async function phoneContext(browser: Browser, baseUrl: string): Promise<BrowserContext> {
  const context = await browser.newContext({ ...PHONE });
  await context.grantPermissions(['notifications'], { origin: baseUrl });
  return context;
}

/** Visible buttons and links inside the shell, each at least 44×44 CSS px. */
async function expectTapTargets(page: Page): Promise<void> {
  const targets = page.locator('[data-component="mobile-app"]').locator('button, a');
  const count = await targets.count();
  expect(count, 'the shell renders tappable controls').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    const label = (await target.textContent())?.trim() || (await target.getAttribute('aria-label')) || `#${i}`;
    expect(box, `${label} has a box`).not.toBeNull();
    expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
  }
}

/** Every `/api/` path this page requested, deduped. */
function apiPathsOf(requests: string[], baseUrl: string): Set<string> {
  const set = new Set<string>();
  for (const url of requests) {
    if (!url.startsWith(baseUrl)) continue;
    const path = new URL(url).pathname;
    if (path.startsWith('/api/')) set.add(path);
  }
  return set;
}

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

test('lists active issues by phase', async ({ browser }) => {
  const baseUrl = dashboard.baseUrl;

  // Measure the shell's own baseline /api/ request set on /m first (the PRD's
  // implementation checkpoint), so the pipeline-tab assertion below compares
  // against reality instead of a guessed allowlist.
  const baselineContext = await phoneContext(browser, baseUrl);
  const baselineRequests: string[] = [];
  try {
    const page = await baselineContext.newPage();
    page.on('request', (req) => baselineRequests.push(req.url()));
    await installFixtures(page);
    await page.goto(`${baseUrl}/m`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-component="mobile-app"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
  } finally {
    await baselineContext.close();
  }
  const baselineApiPaths = apiPathsOf(baselineRequests, baseUrl);

  const context = await phoneContext(browser, baseUrl);
  const requests: string[] = [];
  try {
    const page = await context.newPage();
    page.on('request', (req) => requests.push(req.url()));
    await installFixtures(page);

    await page.goto(`${baseUrl}/m/pipeline`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-component="mobile-app"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Pipeline', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });

    const phaseSections = page.locator('section[data-phase]');
    await expect(phaseSections).toHaveCount(4, { timeout: 30_000 });
    await expect(phaseSections.nth(0)).toHaveAttribute('data-phase', 'ship');
    await expect(phaseSections.nth(1)).toHaveAttribute('data-phase', 'review');
    await expect(phaseSections.nth(2)).toHaveAttribute('data-phase', 'work');
    await expect(phaseSections.nth(3)).toHaveAttribute('data-phase', 'plan');

    const needsYouRow = page.locator('[data-issue-id="PAN-90002"]');
    await expect(needsYouRow).toContainText('Needs you');
    const shipRow = page.locator('[data-issue-id="PAN-90001"]');
    await expect(shipRow).not.toContainText('Needs you');

    await expectTapTargets(page);
    expect(await page.evaluate(() => [window.innerWidth, window.scrollX])).toEqual([390, 0]);
    await page.screenshot({ path: `${SHOT_DIR}/pipeline.png` });

    // Tap the needs-you row and verify the full-screen sheet.
    await needsYouRow.getByText('Needs your review').tap();
    await expect(page).toHaveURL(`${baseUrl}/m/pipeline?issue=PAN-90002`);
    await expect(page.getByRole('heading', { name: 'Needs your review' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('in-review')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Phone sections' })).toHaveCount(0);
    await expectTapTargets(page);
    await page.screenshot({ path: `${SHOT_DIR}/sheet.png` });

    // Back returns to the list.
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await expect(page).toHaveURL(`${baseUrl}/m/pipeline`);
    await expect(page.locator('section[data-phase]').first()).toBeVisible();

    const apiPaths = apiPathsOf(requests, baseUrl);
    const unexpected = [...apiPaths].filter((path) => !baselineApiPaths.has(path));
    expect(unexpected, `/m/pipeline issued /api/ requests beyond /m's baseline set: ${JSON.stringify([...baselineApiPaths])}`).toEqual([]);
  } finally {
    await context.close();
  }
});

test('tab navigation and unknown issue', async ({ browser }) => {
  const baseUrl = dashboard.baseUrl;
  const context = await phoneContext(browser, baseUrl);
  try {
    const page = await context.newPage();
    await installFixtures(page);

    await page.goto(`${baseUrl}/m`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-component="mobile-app"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Pipeline', exact: true }).tap();
    await expect(page).toHaveURL(`${baseUrl}/m/pipeline`);
    await expect(page.locator('[data-issue-id="PAN-90001"]')).toBeVisible({ timeout: 30_000 });

    await page.goto(`${baseUrl}/m/pipeline?issue=PAN-99999`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This issue is not in the pipeline.')).toBeVisible({ timeout: 30_000 });
    const back = page.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toBeVisible();
    const box = await back.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});
