import { test, expect, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3011';

const mockConversation = {
  id: 910,
  name: 'test-conv-search',
  tmuxSession: 'test-session-search',
  status: 'active' as const,
  cwd: '/home/test/search',
  issueId: null,
  createdAt: new Date().toISOString(),
  endedAt: null,
  lastAttachedAt: new Date().toISOString(),
  sessionAlive: true,
  isFavorited: false,
  title: 'Search Test Conversation',
};

function message(id: string, role: 'user' | 'assistant', index: number, text: string) {
  return {
    id,
    role,
    text,
    createdAt: new Date(1_700_000_000_000 + index * 5000).toISOString(),
    completedAt: role === 'assistant' ? new Date(1_700_000_000_000 + index * 5000 + 1000).toISOString() : undefined,
  };
}

const mockMessages = {
  messages: Array.from({ length: 18 }, (_, index) => {
    if (index === 1) return message('a-old', 'assistant', index, 'Very old virtualized answer with alpha-needle inside it.');
    if (index === 10) return message('a-mid', 'assistant', index, 'Middle answer with beta-needle for next result checks.');
    if (index === 17) return message('a-tail', 'assistant', index, 'Latest visible answer with alpha-needle in the tail.');
    return message(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant', index, `Ordinary filler message ${index}`);
  }),
  workLog: [
    {
      id: 'w-search',
      createdAt: new Date(1_700_000_000_000 + 11 * 5000).toISOString(),
      label: 'Bash',
      tone: 'tool' as const,
      detail: 'grep for gamma-tool-needle in files',
    },
  ],
  streaming: false,
};

async function mockDashboardApis(page: Page) {
  await page.route('**/api/conversations', route => route.fulfill({ json: [mockConversation] }));
  await page.route('**/api/conversations/**', route => {
    const url = route.request().url();
    if (url.includes('/messages')) return route.fulfill({ json: mockMessages });
    if (url.includes('/diffs')) return route.fulfill({ json: { summaries: [] } });
    return route.fulfill({ json: mockConversation });
  });
  await page.route('**/api/issues', route => route.fulfill({ json: { issues: [] } }));
  await page.route('**/api/agents', route => route.fulfill({ json: [] }));
  await page.route('**/api/activity', route => route.fulfill({ json: [] }));
  await page.route('**/api/cloister/**', route => route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } }));
  await page.route('**/api/system/health', route => route.fulfill({ json: { status: 'ok', severity: 'none', summary: { cpuPercent: 0, loadAverage1m: 0, loadPerCore1m: 0, totalMemoryBytes: 64 * 1024 ** 3, usedMemoryBytes: 0, availableMemoryBytes: 64 * 1024 ** 3, memoryUsedPercent: 0, swapTotalBytes: 0, swapUsedBytes: 0, swapUsedPercent: 0, overcommitPercent: 0, agentCount: 0, workAgentCount: 0, planningAgentCount: 0, specialistSessionCount: 0, leakedSpecialistCount: 0, containerCount: 0, containerMemoryBytes: 0, panopticonMemoryBytes: 0, panopticonMemoryPercent: 0 }, thresholds: {}, reasons: [], agents: [], leakedSpecialists: [], topConsumers: [] } }));
  await page.route('**/api/version', route => route.fulfill({ json: { version: '0.0.0-test' } }));
  await page.route('**/api/registered-projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/issues/resource-allocated', route => route.fulfill({ json: [] }));
  await page.route('**/api/costs/by-issue', route => route.fulfill({ json: { issues: [] } }));
  await page.route('**/api/session-trees**', route => route.fulfill({ json: { trees: [] } }));
  await page.route('**/api/specialists', route => route.fulfill({ json: [] }));
  await page.route('**/api/workspaces/**', route => route.fulfill({ status: 404, json: {} }));
}

test.describe('Conversation Ctrl+F search', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto(`${DASHBOARD_URL}/conv/${mockConversation.id}`);
    await expect(page.locator('[class*="conversationTerminalTitleText"]', { hasText: 'Search Test Conversation' })).toBeVisible();
  });

  test('opens from Ctrl+F, highlights matches, navigates, searches tool logs, handles no results, and closes', async ({ page }) => {
    await page.locator('[class*="messagesTimeline_"]').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
    const search = page.getByRole('textbox', { name: 'Search conversation' });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();

    await search.fill('alpha-needle');
    await expect(page.getByText('1/2')).toBeVisible();
    await expect(page.locator('[data-conversation-search-highlight]', { hasText: 'alpha-needle' })).toBeVisible();
    await expect(page.locator('[data-search-row-id="a-old"] [data-conversation-search-highlight]', { hasText: 'alpha-needle' })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.getByText('2/2')).toBeVisible();
    await expect(page.locator('[data-search-row-id="a-tail"] [data-conversation-search-highlight]', { hasText: 'alpha-needle' })).toBeVisible();

    await page.keyboard.press('Shift+Enter');
    await expect(page.getByText('1/2')).toBeVisible();

    await search.fill('gamma-tool-needle');
    await expect(page.getByText('1/1')).toBeVisible();
    await expect(page.locator('[data-conversation-search-highlight]', { hasText: 'gamma-tool-needle' })).toBeVisible();
    await expect(page.locator('[data-search-row-id="w-search"] [data-conversation-search-highlight]', { hasText: 'gamma-tool-needle' })).toBeVisible();

    await search.fill('definitely-not-present');
    await expect(page.getByText('0/0')).toBeVisible();
    await expect(page.locator('[data-conversation-search-highlight]')).toHaveCount(0);

    await search.fill('beta-needle');
    await expect(page.getByText('1/1')).toBeVisible();
    await expect(page.locator('[data-conversation-search-highlight]', { hasText: 'beta-needle' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();
    await expect(page.locator('[data-conversation-search-highlight]')).toHaveCount(0);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
    await expect(search).toBeVisible();
    await expect(search).toHaveValue('');
    await page.getByRole('search', { name: 'Search conversation' }).getByRole('button', { name: 'Close search' }).click();
    await expect(search).toBeHidden();
  });
});
