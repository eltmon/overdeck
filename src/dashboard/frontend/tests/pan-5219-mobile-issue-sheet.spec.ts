/**
 * PAN-5219 — tapping an issue notification opens that issue's sheet at
 * `/m/pipeline?issue=<id>&event=<kind>&at=<iso>`, proved at 390×844 on an
 * isolated dashboard, never the operator's live one. `npm run build` first:
 * the fixture serves the built frontend from `dist`.
 *
 * Seeding follows pan-4661-mobile-pipeline.spec.ts: a `pan-snapshot-cache-v1`
 * localStorage entry seeds the store before any WebSocket bootstrap, and
 * `/ws/rpc` is closed so a real, empty bootstrap can never overwrite it.
 *
 * Test A opens a pipeline (GitHub) issue with a PR, a live agent, costs and
 * check-runs. Test B opens a Linear issue with none of those, to prove every
 * section degrades to its "not available" text instead of hiding or
 * crashing.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { DashboardSnapshot } from '@overdeck/contracts';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-5219';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const NOW = Date.now();

function iso(offsetMs = 0): string {
  return new Date(NOW + offsetMs).toISOString();
}

const LONG_DESCRIPTION = `This PR ships the phone issue sheet described in [the PRD](https://example.com/prd). ${'It adds status, cost, PR and checks sections. '.repeat(10)}`.slice(0, 500);

function buildSnapshot(): DashboardSnapshot {
  const issues = [
    {
      id: 'PAN-90010',
      identifier: 'PAN-90010',
      title: 'Ship the phone issue sheet',
      description: LONG_DESCRIPTION,
      labels: [],
      priority: 2,
      source: 'github',
      status: 'open',
      url: 'https://github.com/eltmon/overdeck/pull/90010',
      createdAt: iso(-120_000),
      updatedAt: iso(-60_000),
    },
    {
      id: 'MIN-1141',
      identifier: 'MIN-1141',
      title: 'Investigate a stopped agent',
      description: 'A short description.',
      labels: [],
      priority: 2,
      source: 'linear',
      stateType: 'started',
      status: 'open',
      url: 'https://linear.app/example/issue/MIN-1141',
      createdAt: iso(-120_000),
      updatedAt: iso(-60_000),
    },
  ];
  const derivedIssueStates = [
    {
      issueId: 'PAN-90010',
      state: 'in-review',
      pr: { url: 'https://github.com/eltmon/overdeck/pull/90010', number: 90010, reviewState: 'approved', checks: 'green', mergeable: true },
    },
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
  // Same reasoning as pan-4661-mobile-pipeline.spec.ts: a fresh context has no
  // credential for the real WS upgrade, so close it and fall back to the seed.
  await page.routeWebSocket(/\/ws\/rpc/, (ws) => ws.close());

  await page.route('**/api/issues/PAN-90010/costs', (route) => route.fulfill({
    json: { issueId: 'PAN-90010', totalCost: 2, resolvedTotalCost: 2.5, totalTokens: 100, sessions: [], byModel: {}, byStage: { work: { cost: 2, tokens: 1 } } },
  }));
  await page.route('**/api/issues/PAN-90010/check-runs', (route) => route.fulfill({
    json: {
      issueId: 'PAN-90010',
      pr: { number: 90010, url: 'https://github.com/eltmon/overdeck/pull/90010', headRefName: 'pan-90010', headRefOid: 'abc123', mergeable: 'MERGEABLE', statusCheckRollup: [] },
      checkRuns: [],
      summary: { total: 4, passed: 3, failed: 0, running: 1, skipped: 0, pending: 0, cancelled: 0 },
    },
  }));
  await page.route('**/api/issues/MIN-1141/costs', (route) => route.fulfill({ status: 403, body: '' }));
  await page.route('**/api/issues/MIN-1141/check-runs', (route) => route.fulfill({
    json: { issueId: 'MIN-1141', pr: null, checkRuns: [], summary: { total: 0, passed: 0, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 } },
  }));
  await page.route('**/api/agent-directory*', (route) => route.fulfill({
    json: {
      generatedAt: iso(),
      windowHours: 0,
      scope: 'live',
      entries: [{
        id: 'agent-90010',
        kind: 'agent',
        label: 'work',
        location: 'local',
        projectKey: 'pan',
        issueId: 'PAN-90010',
        issueTitle: null,
        parentId: null,
        role: 'work',
        harness: 'claude-code',
        model: 'opus',
        state: 'working',
        startedAt: iso(-180_000),
        lastActivityAt: iso(-10_000),
        costUsd: null,
        source: 'overdeck',
        transcript: null,
      }],
    },
  }));
}

async function phoneContext(browser: Browser, baseUrl: string): Promise<BrowserContext> {
  const context = await browser.newContext({ ...PHONE });
  // PAN-5208: keep the once-per-session logo sting out of this spec's taps and screenshots.
  await context.addInitScript(() => {
    sessionStorage.setItem('overdeck.logoSting.played', '1');
  });
  await context.grantPermissions(['notifications'], { origin: baseUrl });
  return context;
}

/**
 * Visible buttons and links inside the shell, each at least 44×44 CSS px.
 * D-9: inline links and code-block copy buttons inside the description
 * subtree are exempt — jsdom cannot measure them, but Playwright can, so this
 * spec still lets them through rather than widening the markdown itself.
 */
async function expectTapTargets(page: Page): Promise<void> {
  const targets = page.locator('[data-component="mobile-app"]').locator('button, a');
  const count = await targets.count();
  expect(count, 'the shell renders tappable controls').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const insideDescription = await target.evaluate((el) => el.closest('[data-testid="mobile-issue-description"]') !== null);
    if (insideDescription) continue;
    const box = await target.boundingBox();
    const label = (await target.textContent())?.trim() || (await target.getAttribute('aria-label')) || `#${i}`;
    expect(box, `${label} has a box`).not.toBeNull();
    expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
  }
}

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

test('pipeline issue sheet with a PR, cost, checks and a live agent (PAN-90010)', async ({ browser }) => {
  const baseUrl = dashboard.baseUrl;
  const context = await phoneContext(browser, baseUrl);
  try {
    const page = await context.newPage();
    await installFixtures(page);

    const at = encodeURIComponent(iso(-60_000));
    await page.goto(`${baseUrl}/m/pipeline?issue=PAN-90010&event=merge.completed&at=${at}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-component="mobile-app"]')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('mobile-issue-event')).toContainText('Merged PR #90010 at', { timeout: 30_000 });
    await expect(page.getByText('$2.50')).toBeVisible();
    await expect(page.getByRole('link', { name: '3 passed · 0 failed · 1 running' })).toBeVisible();
    await expect(page.getByText(/Approved/)).toBeVisible();
    await expect(page.getByText(/Live/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Phone sections' })).toHaveCount(0);

    await expectTapTargets(page);
    expect(await page.evaluate(() => [window.innerWidth, window.scrollX])).toEqual([390, 0]);
    await page.screenshot({ path: `${SHOT_DIR}/pipeline-issue.png` });
  } finally {
    await context.close();
  }
});

test('Linear issue sheet with no PR, cost or agent (MIN-1141)', async ({ browser }) => {
  const baseUrl = dashboard.baseUrl;
  const context = await phoneContext(browser, baseUrl);
  try {
    const page = await context.newPage();
    await installFixtures(page);

    const at = encodeURIComponent(iso(-30_000));
    await page.goto(`${baseUrl}/m/pipeline?issue=MIN-1141&event=stopped&at=${at}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-component="mobile-app"]')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('mobile-issue-event')).toContainText('Agent stopped responding at', { timeout: 30_000 });
    await expect(page.getByText('Cost not available')).toBeVisible();
    await expect(page.getByText('No pull request')).toBeVisible();
    await expect(page.getByText('A short description.')).toBeVisible();
    await expect(page.getByText('No agent')).toBeVisible();

    await expectTapTargets(page);
    expect(await page.evaluate(() => [window.innerWidth, window.scrollX])).toEqual([390, 0]);
    await page.screenshot({ path: `${SHOT_DIR}/linear-issue.png` });
  } finally {
    await context.close();
  }
});
