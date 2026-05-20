import { test, expect } from '@playwright/test';

/**
 * DrawerActiveAgent stream excerpt regression test (PAN-1221 F3)
 *
 * Verifies that the DrawerActiveAgent stream panel renders recent output
 * lines when the dashboard store contains agent.output_received data.
 */

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';

test.describe('DrawerActiveAgent stream panel', () => {
  test('renders recent stream output lines for the active agent', async ({ page }) => {
    // Mock API endpoints so the dashboard can load without a live backend
    await page.route('**/api/agents', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/issues', (route) => {
      route.fulfill({ json: { issues: [] } });
    });
    await page.route('**/api/activity', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/cloister/**', (route) => {
      route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } });
    });
    await page.route('**/api/specialists', (route) => {
      route.fulfill({ json: { specialists: [], projects: [] } });
    });
    await page.route('**/api/version**', (route) => {
      route.fulfill({ json: { version: 'test' } });
    });

    await page.goto(`${DASHBOARD_URL}/?issue=PAN-1221-TEST&tab=overview`);

    // Seed the dashboard store directly so the drawer renders with an active agent
    // and pre-populated output lines.
    await page.evaluate(() => {
      // @ts-expect-error — useDashboardStore is exposed on window in dev builds
      const store = window.useDashboardStore;
      if (!store) return;

      store.getState().syncSnapshot({
        sequence: 1,
        timestamp: new Date().toISOString(),
        agents: [
          {
            id: 'agent-pan-1221',
            issueId: 'PAN-1221-TEST',
            status: 'running',
            role: 'work',
            model: 'claude-opus-4-7',
            runtime: 'claude-code',
            startedAt: new Date().toISOString(),
            consecutiveFailures: 0,
            killCount: 0,
          },
        ],
        reviewStatuses: [],
        resources: null,
        channelPermissionRequests: [],
        agentRuntimeById: {},
        scanProgress: null,
        enrichStats: null,
        enrichProgressBySessionId: {},
        embedProgressBySessionId: {},
      } as never);

      store.setState({
        drawer: { issueId: 'PAN-1221-TEST', tab: 'overview' },
        agentOutputById: {
          'agent-pan-1221': [
            'line-1: Boot sequence complete',
            'line-2: Planning phase started',
            'line-3: Reading project files',
            'line-4: Analyzing codebase',
            'line-5: Working on PAN-1221',
            'line-6: Emitted agent.output_received event',
            'line-7: Stream panel should show this',
            'line-8: Final output line here',
          ],
        },
        bootstrapComplete: true,
      });
    });

    // The drawer should be visible
    const drawer = page.getByTestId('issue-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // The stream panel should show the recent output lines
    const streamPanel = page.getByTestId('drawer-active-agent-stream');
    await expect(streamPanel).toBeVisible();

    // Verify specific output lines are rendered (last 8 from the seeded store)
    await expect(streamPanel.getByText('line-1: Boot sequence complete')).toBeVisible();
    await expect(streamPanel.getByText('line-5: Working on PAN-1221')).toBeVisible();
    await expect(streamPanel.getByText('line-8: Final output line here')).toBeVisible();

    // The "No recent stream output" placeholder should NOT appear
    await expect(streamPanel.getByText('No recent stream output')).not.toBeVisible();
  });

  test('shows placeholder when active agent has no output', async ({ page }) => {
    await page.route('**/api/agents', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/issues', (route) => {
      route.fulfill({ json: { issues: [] } });
    });
    await page.route('**/api/activity', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/cloister/**', (route) => {
      route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } });
    });
    await page.route('**/api/specialists', (route) => {
      route.fulfill({ json: { specialists: [], projects: [] } });
    });
    await page.route('**/api/version**', (route) => {
      route.fulfill({ json: { version: 'test' } });
    });

    await page.goto(`${DASHBOARD_URL}/?issue=PAN-1221-EMPTY&tab=overview`);

    await page.evaluate(() => {
      // @ts-expect-error
      const store = window.useDashboardStore;
      if (!store) return;

      store.getState().syncSnapshot({
        sequence: 1,
        timestamp: new Date().toISOString(),
        agents: [
          {
            id: 'agent-pan-1221-empty',
            issueId: 'PAN-1221-EMPTY',
            status: 'running',
            role: 'work',
            model: 'claude-opus-4-7',
            runtime: 'claude-code',
            startedAt: new Date().toISOString(),
            consecutiveFailures: 0,
            killCount: 0,
          },
        ],
        reviewStatuses: [],
        resources: null,
        channelPermissionRequests: [],
        agentRuntimeById: {},
        scanProgress: null,
        enrichStats: null,
        enrichProgressBySessionId: {},
        embedProgressBySessionId: {},
      } as never);

      store.setState({
        drawer: { issueId: 'PAN-1221-EMPTY', tab: 'overview' },
        agentOutputById: {},
        bootstrapComplete: true,
      });
    });

    const drawer = page.getByTestId('issue-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    const streamPanel = page.getByTestId('drawer-active-agent-stream');
    await expect(streamPanel).toBeVisible();
    await expect(streamPanel.getByText('No recent stream output')).toBeVisible();
  });
});
