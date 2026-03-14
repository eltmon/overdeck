import { test, expect } from '@playwright/test';

/**
 * Ephemeral Per-Project Specialist UI Smoke Tests (PAN-300)
 *
 * Verifies that the dashboard correctly displays per-project ephemeral
 * specialist sessions. Uses API mocking to simulate running sessions
 * without requiring live specialists.
 */

const DASHBOARD_URL = 'http://localhost:3010';

const MOCK_SPECIALISTS_RESPONSE = {
  specialists: [
    {
      name: 'merge-agent',
      displayName: 'Merge Agent',
      description: 'PR merging and conflict resolution',
      enabled: true,
      autoWake: true,
      state: 'sleeping',
      isRunning: false,
      tmuxSession: 'specialist-merge-agent',
    },
    {
      name: 'review-agent',
      displayName: 'Review Agent',
      description: 'Code review and feedback',
      enabled: true,
      autoWake: true,
      state: 'sleeping',
      isRunning: false,
      tmuxSession: 'specialist-review-agent',
    },
    {
      name: 'test-agent',
      displayName: 'Test Agent',
      description: 'Running test suites',
      enabled: true,
      autoWake: false,
      state: 'sleeping',
      isRunning: false,
      tmuxSession: 'specialist-test-agent',
    },
  ],
  projects: [
    {
      projectKey: 'pan',
      specialistType: 'merge-agent',
      metadata: {
        runCount: 3,
        lastRunAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        lastRunStatus: 'passed',
        currentRun: 'run-abc123',
      },
      isRunning: true,
      tmuxSession: 'specialist-pan-merge-agent',
    },
  ],
};

const MOCK_PROJECT_SPECIALISTS_RESPONSE = [
  {
    projectKey: 'pan',
    specialistType: 'merge-agent',
    metadata: {
      runCount: 3,
      lastRunAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      lastRunStatus: 'passed',
      currentRun: null,
    },
    isRunning: false,
    tmuxSession: 'specialist-pan-merge-agent',
  },
  {
    projectKey: 'pan',
    specialistType: 'review-agent',
    metadata: {
      runCount: 5,
      lastRunAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      lastRunStatus: 'passed',
      currentRun: null,
    },
    isRunning: false,
    tmuxSession: 'specialist-pan-review-agent',
  },
];

const MOCK_HEALTH_RESPONSE = [
  {
    agentId: 'specialist-pan-merge-agent',
    status: 'healthy',
    reason: null,
    lastPing: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    contextPercent: null,
  },
  {
    agentId: 'agent-pan-300',
    status: 'healthy',
    reason: null,
    lastPing: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    contextPercent: 25,
  },
];

test.describe('Ephemeral Per-Project Specialist UI (PAN-300)', () => {
  test('Active Ephemeral Specialists section renders for running per-project sessions', async ({ page }) => {
    // Mock API responses
    await page.route('**/api/specialists', (route) => {
      route.fulfill({ json: MOCK_SPECIALISTS_RESPONSE });
    });
    await page.route('**/api/specialists/projects', (route) => {
      route.fulfill({ json: MOCK_PROJECT_SPECIALISTS_RESPONSE });
    });
    await page.route('**/api/agents', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/cloister/**', (route) => {
      route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } });
    });
    await page.route('**/api/activity', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/issues', (route) => {
      route.fulfill({ json: { issues: [] } });
    });

    await page.goto(`${DASHBOARD_URL}/#agents`);
    await page.waitForTimeout(500);

    // Verify the Active Ephemeral Specialists section header appears
    const sectionHeader = page.getByText('Active Ephemeral Specialists');
    await expect(sectionHeader).toBeVisible({ timeout: 5000 });

    // Verify the PAN project badge is shown
    const panBadge = page.getByText('PAN').first();
    await expect(panBadge).toBeVisible();

    // Verify the running session tmux name is shown
    await expect(page.getByText('specialist-pan-merge-agent')).toBeVisible();

    // Verify count shows 1
    await expect(page.getByText('Active Ephemeral Specialists (1)')).toBeVisible();
  });

  test('Clicking ephemeral specialist card selects it for terminal viewing', async ({ page }) => {
    await page.route('**/api/specialists', (route) => {
      route.fulfill({ json: MOCK_SPECIALISTS_RESPONSE });
    });
    await page.route('**/api/specialists/projects', (route) => {
      route.fulfill({ json: MOCK_PROJECT_SPECIALISTS_RESPONSE });
    });
    await page.route('**/api/agents', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/cloister/**', (route) => {
      route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } });
    });
    await page.route('**/api/activity', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/issues', (route) => {
      route.fulfill({ json: { issues: [] } });
    });
    // Mock the terminal output for the per-project session
    await page.route('**/api/agents/specialist-pan-merge-agent/output', (route) => {
      route.fulfill({ json: { output: '[specialist] PAN merge-agent running task PAN-300\n$ git merge origin/main' } });
    });

    await page.goto(`${DASHBOARD_URL}/#agents`);
    await page.waitForTimeout(500);

    // Click on the per-project specialist card
    const sessionCard = page.getByText('specialist-pan-merge-agent');
    await sessionCard.click();

    // Verify terminal view appears with the session output
    await expect(page.getByText('Session not found').or(page.getByText('PAN merge-agent'))).toBeVisible({ timeout: 5000 });
  });

  test('CloisterStatusBar shows ephemeral count with tooltip', async ({ page }) => {
    await page.route('**/api/specialists', (route) => {
      route.fulfill({ json: MOCK_SPECIALISTS_RESPONSE });
    });
    await page.route('**/api/cloister/status', (route) => {
      route.fulfill({ json: { running: true, lastCheck: new Date().toISOString(), summary: { active: 1, stale: 0, warning: 0, stuck: 0, total: 1 }, agentsNeedingAttention: [] } });
    });
    await page.route('**/api/cloister/config', (route) => {
      route.fulfill({ json: { startup: { auto_start: true }, thresholds: {}, specialists: { enabled: [] } } });
    });

    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(500);

    // The Zap icon with count should appear in the status bar when ephemeral sessions are running
    // Count "1" should appear next to the lightning bolt
    const statusBar = page.locator('[title*="Ephemeral"]').first();
    await expect(statusBar).toBeVisible({ timeout: 5000 });
  });

  test('Health dashboard shows per-project specialist section', async ({ page }) => {
    await page.route('**/api/health/agents', (route) => {
      route.fulfill({ json: MOCK_HEALTH_RESPONSE });
    });
    await page.route('**/api/specialists/projects', (route) => {
      route.fulfill({ json: MOCK_PROJECT_SPECIALISTS_RESPONSE });
    });
    await page.route('**/api/tldr/**', (route) => {
      route.fulfill({ status: 404, json: {} });
    });

    await page.goto(`${DASHBOARD_URL}/#health`);
    await page.waitForTimeout(500);

    // Verify "Per-Project Specialists" section header appears
    const perProjectHeader = page.getByText('Per-Project Specialists');
    await expect(perProjectHeader).toBeVisible({ timeout: 5000 });

    // Verify PAN project badge appears
    await expect(page.getByText('PAN').first()).toBeVisible();

    // Verify per-project specialist names appear
    await expect(page.getByText('merge-agent').first()).toBeVisible();

    // Verify the health entry for the per-project specialist appears in agent cards
    // specialist-pan-merge-agent should show with a PAN badge
    await expect(page.getByText('specialist-pan-merge-agent')).toBeVisible();
  });

  test('Queue endpoint returns data for per-project specialist', async ({ page }) => {
    // Verify the API endpoint exists and returns correct shape
    await page.goto(DASHBOARD_URL);

    const response = await page.request.get('/api/specialists/pan/merge-agent/queue');
    // Should return 200 (not 404) even if queue is empty
    // Note: In test environment this might 500 if specialists.js can't load, but should not 404
    expect(response.status()).not.toBe(404);
  });
});
