import { test, expect } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3010';

const mockSystemHealth = {
  severity: 'critical',
  updatedAt: '2026-04-27T10:00:00.000Z',
  summary: {
    cpuPercent: 66.4,
    loadAverage1m: 12.6,
    loadPerCore1m: 1.58,
    totalMemoryBytes: 64 * 1024 ** 3,
    usedMemoryBytes: 54 * 1024 ** 3,
    availableMemoryBytes: 1.5 * 1024 ** 3,
    memoryUsedPercent: 84.4,
    swapTotalBytes: 8 * 1024 ** 3,
    swapUsedBytes: 2 * 1024 ** 3,
    swapUsedPercent: 25,
    overcommitPercent: 94,
    agentCount: 4,
    workAgentCount: 2,
    planningAgentCount: 0,
    specialistSessionCount: 1,
    leakedSpecialistCount: 1,
    containerCount: 1,
    containerMemoryBytes: 2 * 1024 ** 3,
    panopticonMemoryBytes: 10 * 1024 ** 3,
    panopticonMemoryPercent: 15.6,
  },
  thresholds: {
    memoryAvailableWarningBytes: 4 * 1024 ** 3,
    memoryAvailableCriticalBytes: 2 * 1024 ** 3,
    swapUsedWarningPercent: 20,
    swapUsedCriticalPercent: 50,
    cpuLoadWarningPerCore: 1,
    cpuLoadCriticalPerCore: 1.5,
    overcommitWarningPercent: 90,
    overcommitCriticalPercent: 100,
  },
  reasons: ['Available RAM below critical threshold'],
  agents: [],
  leakedSpecialists: [
    {
      name: 'specialist-review-agent',
      currentIssue: 'PAN-455',
      reason: 'parent agent missing',
    },
  ],
  topConsumers: [
    {
      id: 'specialist-review-agent',
      label: 'specialist-review-agent',
      type: 'specialist',
      memoryBytes: 3 * 1024 ** 3,
      memoryGb: 3,
      currentIssue: 'PAN-455',
      leaked: true,
      killTarget: {
        kind: 'specialist',
        projectKey: 'panopticon-cli',
        issueId: 'PAN-455',
        specialistType: 'review-agent',
      },
    },
    {
      id: 'abcdef123456',
      label: 'panopticon-feature-pan-455-api-1',
      type: 'container',
      memoryBytes: 2 * 1024 ** 3,
      memoryGb: 2,
      cpuPercent: 18.2,
      killTarget: {
        kind: 'container',
        containerId: 'abcdef123456',
      },
    },
    {
      id: 'agent-pan-455',
      label: 'agent-pan-455',
      type: 'agent',
      memoryBytes: 1 * 1024 ** 3,
      memoryGb: 1,
      issueId: 'PAN-455',
      killTarget: {
        kind: 'agent',
        agentId: 'agent-pan-455',
      },
    },
  ],
};

test.describe('System health pill (PAN-455)', () => {
  test('verifies header presence, leaked-specialist focus, and kill actions', async ({ page }) => {
    const requests: string[] = [];

    await page.route('**/api/system/health', async (route) => {
      await route.fulfill({ json: mockSystemHealth });
    });
    await page.route('**/api/issues', async (route) => {
      await route.fulfill({ json: { issues: [] } });
    });
    await page.route('**/api/agents', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/activity', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/cloister/**', async (route) => {
      await route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } });
    });
    await page.route('**/api/resources/docker/container/*', async (route) => {
      requests.push(route.request().url());
      await route.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/specialists/*/*/*/kill', async (route) => {
      requests.push(route.request().url());
      await route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/agents/agent-pan-455', async (route) => {
      requests.push(route.request().url());
      await route.fulfill({ json: { success: true } });
    });

    await page.goto(DASHBOARD_URL);

    const pill = page.getByTestId('system-health-pill').first();
    await expect(pill).toBeVisible();
    await expect(page.locator('main').getByTestId('system-health-pill')).toHaveCount(0);
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('critical');

    await pill.click();
    await expect(page.getByText('System health', { exact: true })).toBeVisible();
    await expect(page.locator('div').filter({ hasText: /^Panopticon$/ }).first()).toBeVisible();
    await expect(page.getByText('Overcommit 94.0%')).toBeVisible();
    await expect(page.getByText('specialist-review-agent · PAN-455')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

    await page.getByTitle('Kill specialist specialist-review-agent').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Kill' }).click();
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole('button', { name: 'Show all' }).click();

    await page.getByTitle('Kill agent-pan-455').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Kill' }).click();
    await expect.poll(() => requests.length).toBe(2);

    await page.getByTitle('Remove container panopticon-feature-pan-455-api-1').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();

    await expect.poll(() => requests.length).toBe(3);
    expect(requests.some((url) => url.includes('/api/specialists/panopticon-cli/PAN-455/review-agent/kill'))).toBe(true);
    expect(requests.some((url) => url.includes('/api/agents/agent-pan-455'))).toBe(true);
    expect(requests.some((url) => url.includes('/api/resources/docker/container/abcdef123456'))).toBe(true);
  });
});
