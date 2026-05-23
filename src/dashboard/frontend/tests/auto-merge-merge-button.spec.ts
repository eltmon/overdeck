import { expect, test } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';
const ISSUE_ID = 'PAN-1418';
const scheduledAt = '2026-05-23T12:00:00.000Z';
const executeAt = '2099-05-23T12:05:00.000Z';

declare global {
  interface Window {
    useDashboardStore: {
      getState(): {
        syncSnapshot(snapshot: unknown): void;
        applyEvent(event: unknown): void;
        openIssue(issueId: string, tab?: string): void;
      };
      setState(state: unknown): void;
    };
  }
}

test.describe('auto-merge cooldown merge controls', () => {
  test('cancelled cooldown hides countdown and restores drawer merge button', async ({ page }) => {
    let cancelRequested = false;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.includes(`/api/issues/${ISSUE_ID}/merge/cancel`)) {
        expect(request.method()).toBe('POST');
        cancelRequested = true;
        await route.fulfill({ json: { cancelled: true } });
        return;
      }
      await route.fulfill({ json: defaultApiResponse(url) });
    });

    await page.goto(`${DASHBOARD_URL}/board`);
    await expect.poll(() => page.evaluate(() => Boolean(window.useDashboardStore))).toBe(true);
    await seedDashboardState(page);

    const drawer = page.getByTestId('issue-drawer');
    await expect(drawer).toBeVisible();
    await expect(page.getByText('Auto-merging in').first()).toBeVisible();
    await expect(drawer.getByTestId('merge-btn')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    await page.getByTitle('Cancel auto-merge').click();
    await expect.poll(() => cancelRequested).toBe(true);

    await page.evaluate(({ issueId }) => {
      const store = window.useDashboardStore;
      store.getState().applyEvent({
        sequence: 2,
        type: 'merge.auto.cancelled',
        timestamp: new Date().toISOString(),
        payload: { issueId, reason: 'manual', cancelledBy: 'api' },
      });
      store.getState().openIssue(issueId, 'overview');
    }, { issueId: ISSUE_ID });

    await expect(page.getByText('Auto-merging in')).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('merge-btn')).toBeVisible();
  });
});

async function seedDashboardState(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(({ issueId, scheduledAt, executeAt }) => {
    const store = window.useDashboardStore;
    const issue = {
        id: issueId,
        identifier: issueId,
        title: 'Optional auto-merge cooldown',
        status: 'In Review',
        state: 'in_review',
        priority: 2,
        labels: [],
        url: `https://example.test/issues/${issueId}`,
        createdAt: '2026-05-23T12:00:00.000Z',
        updatedAt: '2026-05-23T12:00:00.000Z',
        source: 'github',
        autoMergeScheduled: { executeAt, scheduledAt },
        hasPlan: true,
        hasBeads: true,
      };
    store.getState().syncSnapshot({
        sequence: 1,
        timestamp: new Date().toISOString(),
        agents: [],
        specialists: [],
        reviewStatuses: [
          {
            issueId,
            reviewStatus: 'passed',
            testStatus: 'passed',
            readyForMerge: true,
            mergeStatus: 'pending',
            prUrl: 'https://example.test/pull/1418',
            updatedAt: '2026-05-23T12:00:00.000Z',
            autoMergeScheduled: { executeAt, scheduledAt },
          },
        ],
        issues: [issue],
        resources: null,
        channelPermissionRequests: [],
        agentRuntimeById: {},
        scanProgress: null,
        enrichStats: null,
        enrichProgressBySessionId: {},
        embedProgressBySessionId: {},
      });
    store.setState({ bootstrapComplete: true });
    store.getState().openIssue(issueId, 'overview');
  }, { issueId: ISSUE_ID, scheduledAt, executeAt });
}

function systemHealthResponse(): unknown {
  return {
    severity: 'ok',
    updatedAt: new Date().toISOString(),
    summary: {
      cpuPercent: 0,
      loadAverage1m: 0,
      loadPerCore1m: 0,
      totalMemoryBytes: 1,
      usedMemoryBytes: 0,
      availableMemoryBytes: 1,
      memoryUsedPercent: 0,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 0,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      panopticonMemoryBytes: 0,
      panopticonMemoryPercent: 0,
    },
    thresholds: {
      memoryAvailableWarningBytes: 0,
      memoryAvailableCriticalBytes: 0,
      swapUsedWarningPercent: 0,
      swapUsedCriticalPercent: 0,
      cpuLoadWarningPerCore: 0,
      cpuLoadCriticalPerCore: 0,
      overcommitWarningPercent: 0,
      overcommitCriticalPercent: 0,
    },
    reasons: [],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
  };
}

function defaultApiResponse(url: string): unknown {
  if (url.includes('/api/version')) return { version: 'test' };
  if (url.includes('/api/dashboard/session')) return { csrfToken: 'test-csrf-token' };
  if (url.includes('/api/conversations')) return [];
  if (url.includes('/api/system/health')) return systemHealthResponse();
  if (url.includes('/api/metrics/summary')) {
    return { today: { totalCost: 0, agentCount: 0, activeCount: 0, stuckCount: 0, warningCount: 0 }, topSpenders: { agents: [], issues: [] } };
  }
  if (url.includes('/api/registered-projects')) return [];
  if (url.includes('/api/tracker-status')) return { primary: 'github', configured: [] };
  if (url.includes('/api/cliproxy/status')) return { running: true, pid: 123, checkedAt: new Date().toISOString() };
  if (url.includes('/api/confirmations')) return [];
  if (url.includes('/api/costs')) return { issues: [] };
  if (url.includes('/api/cloister/')) {
    return { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] };
  }
  return {};
}
