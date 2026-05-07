import { test, expect } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3011';

const mockConversation = {
  id: 1,
  name: 'test-conv-toolcalls',
  tmuxSession: 'test-session',
  status: 'active' as const,
  cwd: '/home/test',
  issueId: null,
  createdAt: new Date().toISOString(),
  endedAt: null,
  lastAttachedAt: new Date().toISOString(),
  sessionAlive: true,
  isFavorited: false,
  title: 'Test Conversation',
};

const mockMessages = {
  messages: [
    {
      id: 'u1',
      role: 'user',
      text: 'Run some tools',
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'a1',
      role: 'assistant',
      text: 'I will run those tools for you.',
      createdAt: '2024-01-01T00:00:05Z',
      completedAt: '2024-01-01T00:00:10Z',
    },
  ],
  workLog: [
    {
      id: 'w1',
      createdAt: '2024-01-01T00:00:06Z',
      label: 'Bash',
      tone: 'tool',
      detail: 'ls -la',
    },
    {
      id: 'w2',
      createdAt: '2024-01-01T00:00:07Z',
      label: 'Read',
      tone: 'tool',
      detail: 'src/main.ts',
    },
  ],
  streaming: false,
};

test.describe('Hide tool calls toggle', () => {
  test.beforeEach(async ({ page }) => {
    // Mock all API routes the dashboard needs
    await page.route('**/api/conversations', async (route) => {
      await route.fulfill({ json: [mockConversation] });
    });
    await page.route('**/api/conversations/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/messages')) {
        await route.fulfill({ json: mockMessages });
      } else if (url.includes('/diffs')) {
        await route.fulfill({ json: { summaries: [] } });
      } else {
        await route.fulfill({ json: mockConversation });
      }
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
    await page.route('**/api/system/health', async (route) => {
      await route.fulfill({ json: { status: 'ok', severity: 'none', summary: { cpuPercent: 0, loadAverage1m: 0, loadPerCore1m: 0, totalMemoryBytes: 64 * 1024 ** 3, usedMemoryBytes: 0, availableMemoryBytes: 64 * 1024 ** 3, memoryUsedPercent: 0, swapTotalBytes: 0, swapUsedBytes: 0, swapUsedPercent: 0, overcommitPercent: 0, agentCount: 0, workAgentCount: 0, planningAgentCount: 0, specialistSessionCount: 0, leakedSpecialistCount: 0, containerCount: 0, containerMemoryBytes: 0, panopticonMemoryBytes: 0, panopticonMemoryPercent: 0 }, thresholds: {}, reasons: [], agents: [], leakedSpecialists: [], topConsumers: [] } });
    });
    await page.route('**/api/version', async (route) => {
      await route.fulfill({ json: { version: '0.0.0-test' } });
    });
    await page.route('**/api/registered-projects', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/issues/resource-allocated', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/costs/by-issue', async (route) => {
      await route.fulfill({ json: { issues: [] } });
    });
    await page.route('**/api/session-trees**', async (route) => {
      await route.fulfill({ json: { trees: [] } });
    });
    await page.route('**/api/specialists', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/workspaces/**', async (route) => {
      await route.fulfill({ status: 404, json: {} });
    });
  });

  test('collapses and expands tool calls via wrench toggle', async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/conv/${mockConversation.id}`);

    // Wait for the conversation panel to render
    await page.waitForSelector('text=Test Conversation', { timeout: 10000 });

    // Initially tool calls should be visible
    await expect(page.locator('text=Bash')).toBeVisible();
    await expect(page.locator('text=Read')).toBeVisible();

    // Find and click the hide-tool-calls toggle (wrench button in header)
    const toggle = page.locator('button[title="Hide tool calls"]').first();
    await expect(toggle).toBeVisible();
    await toggle.click();

    // After toggling, tool calls should be collapsed
    await expect(page.locator('text=2 tool calls were made')).toBeVisible();
    await expect(page.locator('text=Bash')).not.toBeVisible();
    await expect(page.locator('text=Read')).not.toBeVisible();

    // Click the collapsed line to expand inline
    await page.locator('text=2 tool calls were made').click();
    await expect(page.locator('text=Bash')).toBeVisible();
    await expect(page.locator('text=Read')).toBeVisible();
  });

  test('persists hide state in localStorage per conversation', async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/conv/${mockConversation.id}`);
    await page.waitForSelector('text=Test Conversation', { timeout: 10000 });

    const toggle = page.locator('button[title="Hide tool calls"]').first();
    await toggle.click();

    // Verify localStorage was updated
    const ls = await page.evaluate(() => {
      const raw = localStorage.getItem('panopticon:conversation-ui:v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(ls).toEqual({ hideToolCallsById: { 'test-conv-toolcalls': true } });
  });
});
