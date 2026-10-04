/**
 * God View river bands render without overprint, with a real shelf and
 * Doldrums population (PAN-4523 W8).
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME`, never
 * the operator's live dashboard on :3011) — the house rule for new Playwright
 * specs (see pan-4497-timeline-overlap.spec.ts).
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Seeding strategy: `EventRouter`'s instant-render path reads the
 * `pan-snapshot-cache-v1` localStorage entry and calls `syncSnapshot`
 * synchronously on mount, before any WebSocket bootstrap — so an
 * `addInitScript`-seeded snapshot populates the store immediately. `/ws/rpc`
 * is then closed so the WS-only `getSnapshot` bootstrap (and its fallback
 * poller) can never succeed and overwrite the seeded cast with a real, empty
 * one — the same pattern pan-4497-timeline-overlap.spec.ts uses.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import type { DashboardSnapshot } from '@overdeck/contracts';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(120_000);

// Resolved from repo root, not cwd — `npx playwright test` is documented to
// run from `src/dashboard/frontend`, and a cwd-relative path would write a
// stray `src/dashboard/frontend/docs/` tree instead of the real
// `docs/screenshots/`.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCREENSHOT_PATH = path.join(REPO_ROOT, 'docs', 'screenshots', 'pan-4523', 'god-view-bands.png');

const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const SHELF_ISSUE_IDS = ['PAN-99101', 'PAN-99102', 'PAN-99103', 'PAN-99104', 'PAN-99105'];
const PARKED_ISSUE_IDS = ['PAN-99201', 'PAN-99202', 'PAN-99203', 'PAN-99204', 'PAN-99205'];

// >= 58 characters, per the PRD's truncation fixture (D4/W2).
const LONG_REASON = 'RUN-92 safety hold: waiting for the operator to confirm the deploy window';

function buildSnapshot(): DashboardSnapshot {
  const issues = SHELF_ISSUE_IDS.map((id) => ({
    id,
    identifier: id,
    title: `Shelf fixture ${id}`,
    labels: [],
    state: 'open',
  }));
  const agents = SHELF_ISSUE_IDS.map((id, index) => ({
    id: `agent-${id.toLowerCase()}`,
    issueId: id,
    role: 'work',
    status: 'stopped',
    paused: true,
    pausedReason: `${LONG_REASON} (${index + 1})`,
    model: 'claude-sonnet-5',
    startedAt: new Date(NOW - 3 * 60 * 60_000).toISOString(),
    // Distinct idle ages so the shelf's longest-idle-first cap has an order.
    lastActivity: new Date(NOW - (index + 1) * 11 * 60_000).toISOString(),
  }));
  return {
    sequence: 1,
    timestamp: new Date(NOW).toISOString(),
    specialists: [],
    backendPanes: [],
    derivedIssueStates: [],
    issues,
    agents,
  } as unknown as DashboardSnapshot;
}

const PARKED_PAYLOAD = {
  rows: PARKED_ISSUE_IDS.map((id, index) => ({
    issueId: id,
    orbit: 'zombie-session',
    parkedAt: new Date(NOW - (3 * 60 + index * 7) * 60_000).toISOString(),
    parkReason: 'zombie session: the harness process exited but the row never updated',
    unparkCondition: 'operator release or a fresh heartbeat',
  })),
  summary: {
    total: 5,
    byOrbit: { 'zombie-session': 5 },
    primaryByIssue: Object.fromEntries(PARKED_ISSUE_IDS.map((id) => [id, 'zombie-session'])),
  },
};

async function installFixtures(page: Page): Promise<void> {
  const cacheEntry = { data: buildSnapshot(), timestamp: new Date(NOW).toISOString() };
  await page.addInitScript((entry) => {
    localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify(entry));
  }, cacheEntry);

  // God View is gated behind the experimental-features flag (App.tsx bounces
  // any experimental tab to home once /api/settings resolves it as off); the
  // isolated server's fresh temp home always starts with it off. Pass the
  // real response through, just forcing the one flag this spec needs.
  await page.route('**/api/settings', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({
      response,
      json: { ...json, experimental: { ...json.experimental, experimentalFeatures: true } },
    });
  });
  await page.route('**/api/parked', (route) => route.fulfill({ json: PARKED_PAYLOAD }));
  await page.route('**/api/costs/summary', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/conversations', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/velocity', (route) => route.fulfill({ json: {} }));
  // The isolated server's WS upgrade auth never consults loopback/peer trust
  // (by design), so a fresh browser context has no credential and the real
  // handshake fails anyway. Close it immediately so the app falls back to
  // the seeded cache instead of racing a bootstrap that will time out.
  await page.routeWebSocket(/\/ws\/rpc/, (ws) => ws.close());
}

interface WindowOrb { id: string; state: string }

async function orbCounts(page: Page): Promise<{ shelf: number; stale: number }> {
  return page.evaluate(() => {
    const orbs = (window as unknown as { __orbs?: WindowOrb[] }).__orbs ?? [];
    return {
      shelf: orbs.filter((orb) => orb.state === 'shelf').length,
      stale: orbs.filter((orb) => orb.state === 'stale').length,
    };
  });
}

/** Implementation checkpoint (PRD W8): if the seeded cast never lands within
 * 10s, dump the orb cast and the seeded cache entry so the failure is
 * diagnosable instead of a bare timeout. */
async function waitForSeededOrbs(page: Page): Promise<void> {
  try {
    await expect.poll(async () => {
      const counts = await orbCounts(page);
      return counts.shelf >= 5 && counts.stale >= 5;
    }, {
      timeout: 10_000,
      message: 'window.__orbs never carried >= 5 shelf and >= 5 stale orbs',
    }).toBe(true);
  } catch (err) {
    const orbs = await page.evaluate(
      () => (window as unknown as { __orbs?: WindowOrb[] }).__orbs ?? null,
    ).catch(() => '(could not read window.__orbs)');
    const cached = await page.evaluate(
      () => localStorage.getItem('pan-snapshot-cache-v1'),
    ).catch(() => '(could not read localStorage)');
    console.error('[pan-4523-river-bands] seeded orbs never landed.');
    console.error('window.__orbs:', JSON.stringify(orbs));
    console.error('pan-snapshot-cache-v1 present:', cached != null);
    throw err;
  }
}

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

test.describe('PAN-4523 river bands', () => {
  test('shelf and Doldrums bands render disjoint with no overprinted text', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await installFixtures(page);
    await page.goto(`${dashboard.baseUrl}/god-view`);

    await expect(page.locator('[data-testid="confluence-river-canvas"]')).toBeVisible({ timeout: 20_000 });
    await waitForSeededOrbs(page);

    // Let orbs ease into their shelf/Doldrums rows before screenshotting.
    await page.waitForTimeout(2_500);

    const counts = await orbCounts(page);
    expect(counts.shelf).toBeGreaterThanOrEqual(5);
    expect(counts.stale).toBeGreaterThanOrEqual(5);

    // The band text itself lives on a <canvas> and isn't DOM-inspectable, but
    // the HUD overlays that sit below the river (.confluence-tag,
    // .confluence-hint) must stay clear of the Doldrums band — the canvas
    // bottom minus the HUD_GUTTER (32px, D2) — or they'd overprint it.
    const canvasBox = await page.locator('[data-testid="confluence-river-canvas"]').boundingBox();
    expect(canvasBox).not.toBeNull();
    const doldrumsBottomPageY = canvasBox!.y + canvasBox!.height - 32;

    for (const selector of ['.confluence-tag', '.confluence-hint']) {
      const locator = page.locator(selector).first();
      if (!(await locator.isVisible().catch(() => false))) continue;
      const box = await locator.boundingBox();
      expect(box, `${selector} has no bounding box`).not.toBeNull();
      expect(box!.y, `${selector} overlaps the Doldrums band`).toBeGreaterThanOrEqual(doldrumsBottomPageY);
    }

    await page.screenshot({ path: SCREENSHOT_PATH });

    await context.close();
  });
});
