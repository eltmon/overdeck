import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3011';

const conversation = {
  id: 3744,
  name: 'pan-3744-uat',
  tmuxSession: 'pan-3744-uat',
  status: 'ended' as const,
  cwd: '/tmp/pan-3744-uat',
  issueId: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  endedAt: '2026-08-16T00:01:00.000Z',
  lastAttachedAt: '2026-08-16T00:01:00.000Z',
  sessionAlive: false,
  isFavorited: false,
  title: 'PAN-3744 loading UAT',
};

async function mockDashboardShell(page: Page, releaseMessages: Promise<void>) {
  await page.route('**/api/dashboard/session', route => route.fulfill({
    json: { ok: true, csrfToken: 'pan-3744-uat' },
  }));
  await page.route('**/api/conversations', route => route.fulfill({ json: [conversation] }));
  await page.route('**/api/conversations/**', async route => {
    const url = route.request().url();
    if (url.includes('/pending-input')) return route.fulfill({ json: [] });
    if (url.includes('/messages')) {
      await releaseMessages;
      return route.fulfill({
        json: {
          messages: [{
            id: 'answer',
            role: 'assistant',
            text: 'Transcript arrived after the loading skeleton.',
            createdAt: '2026-08-16T00:00:30.000Z',
            completedAt: '2026-08-16T00:00:31.000Z',
          }],
          workLog: [],
          streaming: false,
        },
      });
    }
    if (url.includes('/diffs')) return route.fulfill({ json: { summaries: [] } });
    return route.fulfill({ json: conversation });
  });
  await page.route('**/api/issues', route => route.fulfill({ json: { issues: [] } }));
  await page.route('**/api/agents', route => route.fulfill({ json: [] }));
  await page.route('**/api/activity', route => route.fulfill({ json: [] }));
  await page.route('**/api/version', route => route.fulfill({ json: { version: 'pan-3744-uat' } }));
  await page.route('**/api/registered-projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/issues/resource-allocated', route => route.fulfill({ json: [] }));
  await page.route('**/api/costs/by-issue', route => route.fulfill({ json: { issues: [] } }));
  await page.route('**/api/session-trees**', route => route.fulfill({ json: { trees: [] } }));
  await page.route('**/api/specialists', route => route.fulfill({ json: [] }));
  await page.route('**/api/cloister/**', route => route.fulfill({
    json: {
      running: false,
      lastCheck: null,
      summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 },
      agentsNeedingAttention: [],
    },
  }));
}

test.describe('PAN-3744 conversation loading UAT', () => {
  test.use({ ignoreHTTPSErrors: true });

  test('shows the skeleton, never the greeting, until the transcript arrives', async ({ page }) => {
    let releaseMessages!: () => void;
    const messagesReady = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    await mockDashboardShell(page, messagesReady);

    await page.goto(`${DASHBOARD_URL}/conv/${conversation.id}`);

    await expect(page.getByRole('status', { name: 'Loading conversation' })).toBeVisible();
    await expect(page.getByText('How can I help you?')).toHaveCount(0);

    releaseMessages();

    await expect(page.getByText('Transcript arrived after the loading skeleton.')).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading conversation' })).toHaveCount(0);
    await expect(page.getByText('How can I help you?')).toHaveCount(0);
  });
});
