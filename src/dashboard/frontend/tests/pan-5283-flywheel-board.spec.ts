/**
 * Flywheel lane board at rail and phone widths, light and dark (PAN-5283 D20).
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME`, never
 * the operator's live dashboard on :3011). `npm run build` first: the fixture
 * serves the built frontend from `dist`.
 *
 * `GET /api/flywheel/status` is served from `fixtures/flywheel-board-status.json`
 * (seven in-flight cards, a gate-queued card, handoff agents, three shipped
 * merges and a health block), so the board renders the same shapes every run.
 * Each viewport and theme is its own test with one page load (PAN-4767).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(120_000);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Resolved from the repo root, not cwd, so the PNGs land in docs/screenshots/.
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SHOT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots', 'pan-5283');
const STATUS = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'flywheel-board-status.json'), 'utf8'));

type Theme = 'light' | 'dark';
const VIEWPORTS = {
  // The 560 px default rail beside the conversation column.
  rail: { width: 1440, height: 2200 },
  phone: { width: 390, height: 3200 },
} as const;
const PHONE_DEVICE = { hasTouch: true, isMobile: true } as const;

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

async function openBoard(browser: Browser, viewport: keyof typeof VIEWPORTS, theme: Theme): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORTS[viewport], ...(viewport === 'phone' ? PHONE_DEVICE : {}) });
  await context.addInitScript(({ value, closeFeed }) => {
    try {
      window.localStorage.setItem('overdeck.ui.theme', value);
      // The app shell's session activity feed (w-80) defaults open and is
      // outside this page; at phone width it would leave the page 70 px.
      if (closeFeed) window.localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
    } catch { /* storage blocked */ }
  }, { value: theme, closeFeed: viewport === 'phone' });
  const page = await context.newPage();
  await page.route('**/api/flywheel/status', (route) => route.fulfill({ json: STATUS }));
  await page.route('**/api/conversations/pending-input', (route) => route.fulfill({ json: [] }));
  // A fresh context has no WS credential on the isolated server; close it so
  // the page never waits on a bootstrap that cannot succeed.
  await page.routeWebSocket(/\/ws\/rpc/, (ws) => ws.close());
  await page.goto(`${dashboard.baseUrl}/flywheel`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('flywheel-lane-board')).toBeVisible({ timeout: 60_000 });
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  return page;
}

async function assertBoard(page: Page): Promise<void> {
  // No horizontal page scroll, and the rail itself does not overflow sideways.
  const widths = await page.evaluate(() => {
    const rail = document.querySelector('[aria-label="Flywheel control rail"]') as HTMLElement | null;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      railScroll: rail?.scrollWidth ?? 0,
      railClient: rail?.clientWidth ?? 0,
    };
  });
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);
  expect(widths.railScroll).toBeLessThanOrEqual(widths.railClient);

  // The header count equals the number of in-flight cards.
  const header = await page.getByTestId('flywheel-inflight-count').textContent();
  const inFlight = Number(/(\d+) in flight/.exec(header ?? '')?.[1]);
  await expect(page.locator('[data-testid^="flywheel-card-"]')).toHaveCount(inFlight);
  expect(inFlight).toBe(STATUS.inFlight.length);

  // A gate-queued card shows its blocker, never "no agent".
  const gated = page.getByTestId('flywheel-card-PAN-5275');
  await expect(page.getByTestId('flywheel-blocker-PAN-5275')).toContainText('typecheck');
  await expect(gated).not.toContainText('no agent');
}

for (const viewport of ['rail', 'phone'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`board at ${viewport} width in ${theme} theme`, async ({ browser }) => {
      const page = await openBoard(browser, viewport, theme);
      await assertBoard(page);
      // Let fonts settle before the screenshot.
      await page.waitForTimeout(500);
      const target = viewport === 'rail' ? page.locator('[aria-label="Flywheel control rail"]') : page.locator('body');
      await target.screenshot({ path: path.join(SHOT_DIR, `board-${viewport}-${theme}.png`) });
      await page.context().close();
    });
  }
}
