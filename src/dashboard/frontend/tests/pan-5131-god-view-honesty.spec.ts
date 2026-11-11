/**
 * God View honesty pass (PAN-5131 W19): the cast holds only tracker issues, and
 * an orb carries no stored age or heat.
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME`, never
 * the operator's live dashboard on :3011) and in its own browser context, on
 * the pattern of pan-4523-river-bands.spec.ts.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Seeding: `EventRouter` reads the `pan-snapshot-cache-v1` localStorage entry
 * and calls `syncSnapshot` on mount, before any WebSocket bootstrap. `/ws/rpc`
 * is closed so no real, empty snapshot can replace the seeded cast.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import type { DashboardSnapshot } from '@overdeck/contracts';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(120_000);

// Resolved from the repo root, not cwd: `npx playwright test` runs from
// `src/dashboard/frontend`.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCREENSHOT_PATH = path.join(REPO_ROOT, 'docs', 'screenshots', 'pan-5131', 'god-view-honesty.png');

const ISSUE_IDS = ['PAN-99301', 'PAN-99302', 'MIN-99303'];
const SEQUENCER_ID = 'sequencer-runner';
/** Fields an orb must not carry: a stored age or rate cannot stay true (FR-1, FR-3). */
const STORED_FIELDS = ['idleMin', 'staleMin', 'parkedMin', 'heat'];

function buildSnapshot(now: number): DashboardSnapshot {
  const stamp = new Date(now).toISOString();
  const agents = [
    ...ISSUE_IDS.map((issueId) => ({
      id: `agent-${issueId.toLowerCase()}`,
      issueId,
      role: 'work',
      status: 'running',
      model: 'claude-sonnet-5',
      startedAt: stamp,
      lastActivity: stamp,
    })),
    {
      id: SEQUENCER_ID,
      issueId: SEQUENCER_ID,
      role: 'sequencer',
      status: 'running',
      model: 'claude-sonnet-5',
      startedAt: stamp,
      lastActivity: stamp,
    },
  ];
  return {
    sequence: 1,
    timestamp: stamp,
    specialists: [],
    // Without a live pane the liveness gate reads a `running` row as stopped.
    backendPanes: agents.map((agent) => ({
      id: `w1:${agent.id}`,
      agentId: agent.id,
      role: agent.role,
      harness: 'claude-code',
      model: 'unknown',
      state: 'working',
    })),
    derivedIssueStates: [],
    issues: ISSUE_IDS.map((id) => ({
      id,
      identifier: id,
      title: `Honesty fixture ${id}`,
      labels: [],
      state: 'open',
    })),
    agents,
  } as unknown as DashboardSnapshot;
}

async function installFixtures(page: Page): Promise<void> {
  const now = Date.now();
  const cacheEntry = { data: buildSnapshot(now), timestamp: new Date(now).toISOString() };
  await page.addInitScript((entry) => {
    localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify(entry));
  }, cacheEntry);

  // God View is gated behind the experimental-features flag, and a fresh temp
  // home starts with it off. Pass the real response through with the flag on.
  await page.route('**/api/settings', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({
      response,
      json: { ...json, experimental: { ...json.experimental, experimentalFeatures: true } },
    });
  });
  await page.route('**/api/parked', (route) => route.fulfill({
    json: { rows: [], summary: { total: 0, byOrbit: {}, primaryByIssue: {} } },
  }));
  await page.route('**/api/costs/summary', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/conversations', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/velocity', (route) => route.fulfill({ json: {} }));
  await page.routeWebSocket(/\/ws\/rpc/, (ws) => ws.close());
}

type WindowOrb = Record<string, unknown> & { id: string; state: string };

function readOrbs(page: Page): Promise<WindowOrb[]> {
  return page.evaluate(() => (window as unknown as { __orbs?: WindowOrb[] }).__orbs ?? []);
}

/** Implementation checkpoint (PRD W19): if the seeded cast never lands within
 * 10 s, dump the cast and the cache entry so the failure is diagnosable. */
async function waitForSeededOrbs(page: Page): Promise<void> {
  try {
    await expect.poll(async () => (await readOrbs(page)).map((orb) => orb.id).sort(), {
      timeout: 10_000,
      message: 'window.__orbs never carried the three seeded issue orbs',
    }).toEqual(expect.arrayContaining(ISSUE_IDS));
  } catch (err) {
    const orbs = await readOrbs(page).catch(() => '(could not read window.__orbs)');
    const cached = await page.evaluate(
      () => localStorage.getItem('pan-snapshot-cache-v1'),
    ).catch(() => '(could not read localStorage)');
    console.error('[pan-5131-god-view-honesty] seeded orbs never landed.');
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

test.describe('PAN-5131 God View honesty', () => {
  test('the cast holds only tracker issues and stores no age or heat', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
    const page = await context.newPage();
    await installFixtures(page);
    await page.goto(`${dashboard.baseUrl}/god-view`);

    await expect(page.locator('[data-testid="confluence-river-canvas"]')).toBeVisible({ timeout: 20_000 });
    await waitForSeededOrbs(page);

    const orbs = await readOrbs(page);
    const ids = orbs.map((orb) => orb.id);
    expect(ids).toEqual(expect.arrayContaining(ISSUE_IDS));
    expect(ids).not.toContain(SEQUENCER_ID);
    for (const orb of orbs) {
      expect(orb.state, `${orb.id} state`).toBe('active');
      for (const field of STORED_FIELDS) {
        expect(Object.keys(orb), `${orb.id} carries a stored ${field}`).not.toContain(field);
      }
    }

    // The footer lists the model's five stages.
    await expect(page.locator('.confluence-tag')).toContainText('PLAN → WORK → REVIEW → TEST → MERGE');

    // Let the orbs ease into their stage columns before the screenshot.
    await page.waitForTimeout(2_500);
    mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    await context.close();
  });
});
