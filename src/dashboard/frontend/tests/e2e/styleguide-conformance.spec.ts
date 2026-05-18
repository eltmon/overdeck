import { test, expect } from '@playwright/test';

/**
 * Styleguide Conformance Test (PAN-1148)
 *
 * Asserts that shared primitive class signatures (data-component attributes)
 * are present across dashboard surfaces. Runs in an isolated browser context
 * with no shared profile — each test gets a fresh page and seeded store.
 *
 * Surfaces tested:
 *   - Pipeline   (kanban / list view)  → issue-row + verb-badge
 *   - Board      (kanban / card view)  → issue-card + verb-badge
 *   - Command Deck                      → issue-row + verb-badge
 *   - Agents                            → agent-card + verb-badge
 *
 * /god-view is explicitly skipped per PRD §3 non-goal.
 */

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';

/** Minimal mock issue shape for the store snapshot. */
const MOCK_ISSUES = [
  {
    id: 'issue-1',
    identifier: 'PAN-1148',
    title: 'Add styleguide-conformance Playwright test',
    status: 'In Progress',
    priority: 1,
    labels: ['styleguide', 'test'],
    url: 'https://example.test/issues/PAN-1148',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    state: 'in_progress',
    source: 'github',
  },
  {
    id: 'issue-2',
    identifier: 'PAN-1149',
    title: 'Integrate IssueRow primitive into Pipeline',
    status: 'To Do',
    priority: 2,
    labels: ['ui'],
    url: 'https://example.test/issues/PAN-1149',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    state: 'backlog',
    source: 'github',
  },
];

/** Minimal mock agent shape for the store snapshot. */
const MOCK_AGENTS = [
  {
    id: 'agent-pan-1148',
    issueId: 'PAN-1148',
    status: 'running',
    role: 'work',
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  },
  {
    id: 'agent-pan-1149',
    issueId: 'PAN-1149',
    status: 'stopped',
    role: 'work',
    model: 'claude-sonnet-4-6',
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    lastActivity: new Date(Date.now() - 1800_000).toISOString(),
  },
];

/** Inject a snapshot into localStorage so the store bootstraps with data. */
async function seedStoreSnapshot(page: import('@playwright/test').Page) {
  const snapshot = {
    sequence: 1,
    agents: MOCK_AGENTS,
    specialists: [],
    reviewStatuses: [],
    issues: MOCK_ISSUES,
    timestamp: new Date().toISOString(),
  };

  await page.addInitScript((cacheValue) => {
    localStorage.setItem('pan-snapshot-cache-v1', cacheValue);
  }, JSON.stringify({ data: snapshot, timestamp: new Date().toISOString() }));
}

/** Common route stubs so the dashboard renders without error banners. */
async function stubCommonRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/version', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'test' }) }),
  );
  await page.route('**/api/dashboard/session', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'mock skip' }) }),
  );
  await page.route('**/api/costs/by-issue', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  await page.route('**/api/registered-projects', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/api/tracker-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ primary: 'github', configured: [] }) }),
  );
  await page.route('**/api/cliproxy/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ running: true, pid: 1, checkedAt: new Date().toISOString() }) }),
  );
  await page.route('**/api/confirmations', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
}

/** Stubs for the Agents page. */
async function stubAgentsRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/specialists', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ specialists: [], projects: [] }) }),
  );
  await page.route('**/api/specialists/projects', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/api/cloister/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] }) }),
  );
  await page.route('**/api/activity', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
}

/** Stubs for the Command Deck page. */
async function stubCommandDeckRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/command-deck/projects', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          name: 'panopticon-cli',
          path: '/tmp/panopticon-cli',
          features: [
            {
              issueId: 'PAN-1148',
              title: 'Styleguide conformance test',
              branch: 'feature/pan-1148',
              status: 'running',
              stateLabel: 'In Progress',
              agentStatus: 'running',
              hasPlanning: true,
              hasPrd: true,
              hasState: true,
              isShadow: false,
              readyForMerge: false,
              sessions: [],
            },
          ],
        },
      ]),
    }),
  );
  await page.route('**/api/session-trees**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trees: [] }) }),
  );
  await page.route('**/api/conversations**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
}

test.describe('Styleguide Conformance', () => {
  test('Board surface (Current cycle) renders issue-card and verb-badge', async ({ page }) => {
    await stubCommonRoutes(page);
    await seedStoreSnapshot(page);

    await page.goto(`${DASHBOARD_URL}/`);
    // Ensure we are in the Current (board/card) view
    const currentBtn = page.locator('button', { hasText: 'Current' }).first();
    if (await currentBtn.count()) {
      await currentBtn.click();
    }

    await expect(page.locator('[data-component="issue-card"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-component="verb-badge"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Pipeline surface (All cycle) renders issue-row and verb-badge', async ({ page }) => {
    await stubCommonRoutes(page);
    await seedStoreSnapshot(page);

    await page.goto(`${DASHBOARD_URL}/`);
    const allBtn = page.locator('button', { hasText: 'All' }).first();
    await expect(allBtn).toBeVisible({ timeout: 10_000 });
    await allBtn.click();

    await expect(page.locator('[data-component="issue-row"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-component="verb-badge"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Command Deck surface renders issue-row and verb-badge', async ({ page }) => {
    await stubCommonRoutes(page);
    await stubCommandDeckRoutes(page);
    await seedStoreSnapshot(page);

    await page.goto(`${DASHBOARD_URL}/command-deck`);

    await expect(page.locator('[data-component="issue-row"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-component="verb-badge"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Agents surface renders agent-card and verb-badge', async ({ page }) => {
    await stubCommonRoutes(page);
    await stubAgentsRoutes(page);
    await seedStoreSnapshot(page);

    await page.goto(`${DASHBOARD_URL}/agents`);

    await expect(page.locator('[data-component="agent-card"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-component="verb-badge"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('God View is explicitly skipped', async ({ page }) => {
    await stubCommonRoutes(page);
    await seedStoreSnapshot(page);

    await page.goto(`${DASHBOARD_URL}/god-view`);
    await page.waitForTimeout(500);

    // God View is a non-goal for this issue; no styleguide assertions apply.
    // We simply verify the page loads without crashing.
    await expect(page.locator('body')).toBeVisible();
  });
});
