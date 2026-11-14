/**
 * New-build banner end to end (PAN-5236 WI-7).
 *
 * Every journey runs against an **isolated** dashboard (its own temp
 * `OVERDECK_HOME` and port, no Deacon) in a fresh browser context, never the
 * operator's live dashboard on 3011.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`,
 * which is what gives the bundle its `__OVERDECK_FRONTEND_BUILD_COMMIT__`.
 */

import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-5236';
const BANNER = '[data-component="new-build-banner"]';
const DRIFT_COMMIT = '0'.repeat(40);
const BANNER_TEXT = 'A newer Overdeck is running. Reload to update.';

let dashboard: IsolatedDashboard;

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

test.beforeEach(async () => {
  dashboard = await startIsolatedDashboard();
  mkdirSync(SHOT_DIR, { recursive: true });
});

test.afterEach(async () => {
  await dashboard?.stop();
});

/**
 * Rewrites `/api/health`'s `buildCommit` to a commit the bundle never has.
 * A request can land between stopping and restarting the fixture server
 * (journey 6): let that one fail exactly as a real outage would rather than
 * crashing the route handler.
 */
async function installDriftRoute(page: Page): Promise<void> {
  await page.route('**/api/health', async (route) => {
    try {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({ response, json: { ...json, buildCommit: DRIFT_COMMIT } });
    } catch {
      await route.abort();
    }
  });
}

test('matching commits: the main dashboard shows no banner', async ({ page }) => {
  // Registered before navigation: the buildDrift check's /api/health fetch
  // can fire during bootstrap, before the snapshot-cache wait below resolves.
  const healthChecked = page.waitForResponse((res) => res.url().includes('/api/health'), { timeout: 60_000 });
  await page.goto(`${dashboard.baseUrl}/pipeline`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => localStorage.getItem('pan-snapshot-cache-v1') !== null, undefined, { timeout: 60_000 });
  // Wait for the buildDrift check itself before asserting absence —
  // otherwise "no banner" can pass for free, before the check has even run.
  await healthChecked;
  await page.waitForTimeout(2_000);
  await expect(page.locator(BANNER)).toHaveCount(0);
});

// One page per test (never several pages streaming at once in the same
// context): each page's first /ws/rpc bootstrap and buildDrift check run
// without competing with another page's connection for the fixture server's
// attention, so a single generous timeout covers it reliably.
test('drift: the main dashboard shows the banner', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await installDriftRoute(page);
    await page.goto(`${dashboard.baseUrl}/pipeline`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(BANNER)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(BANNER)).toContainText(BANNER_TEXT);
    await page.screenshot({ path: `${SHOT_DIR}/drift-main.png` });
  } finally {
    await context.close();
  }
});

test('drift: the web /m shell shows the banner', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await installDriftRoute(page);
    await page.goto(`${dashboard.baseUrl}/m`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(BANNER)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(BANNER)).toContainText(BANNER_TEXT);
    await page.screenshot({ path: `${SHOT_DIR}/drift-mobile.png` });
  } finally {
    await context.close();
  }
});

test('drift: the conversation popout shows the banner', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await installDriftRoute(page);
    await page.goto(`${dashboard.baseUrl}/popout/conversation/1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(BANNER)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(BANNER)).toContainText(BANNER_TEXT);
    await page.screenshot({ path: `${SHOT_DIR}/drift-popout.png` });
  } finally {
    await context.close();
  }
});

test('reload keeps a seeded draft and hides the banner once the same server commit has been tried', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await installDriftRoute(page);
    await page.goto(`${dashboard.baseUrl}/pipeline`, { waitUntil: 'domcontentloaded' });
    // Seed the draft once, directly, after the initial load — not via
    // addInitScript, which would re-run on the reload under test too and
    // silently re-plant the draft if the reload path ever cleared it,
    // masking exactly the regression this journey exists to catch.
    await page.evaluate(() => localStorage.setItem('conv-draft:pan-5236-probe', 'keep me'));

    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText('Unsent drafts are kept.');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      banner.getByRole('button', { name: 'Reload' }).click(),
    ]);

    const draft = await page.evaluate(() => localStorage.getItem('conv-draft:pan-5236-probe'));
    expect(draft).toBe('keep me');
    // Same drifted server commit as before the reload (D-4): stays hidden.
    await page.waitForTimeout(5_000);
    await expect(page.locator(BANNER)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('open across a deploy: the banner appears on a server restart, without a page reload', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Registered before navigation: see the "matching commits" journey above.
    const healthChecked = page.waitForResponse((res) => res.url().includes('/api/health'), { timeout: 60_000 });
    await page.goto(`${dashboard.baseUrl}/pipeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pan-snapshot-cache-v1') !== null, undefined, { timeout: 60_000 });
    await healthChecked;
    await page.waitForTimeout(2_000);
    await expect(page.locator(BANNER)).toHaveCount(0);

    await installDriftRoute(page);
    await dashboard.stop({ keepHome: true });
    dashboard = await startIsolatedDashboard({ port: dashboard.port, home: dashboard.home });

    await expect(page.locator(BANNER)).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(BANNER)).toContainText(BANNER_TEXT);
    await page.screenshot({ path: `${SHOT_DIR}/reconnect-drift.png` });
  } finally {
    await context.close();
  }
});
