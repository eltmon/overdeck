import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';
const CONVERSATION_ID = 1525;
const CONVERSATION = {
  id: CONVERSATION_ID,
  name: 'composer-command-fixture',
  tmuxSession: 'conv-composer-command-fixture',
  status: 'active',
  cwd: '/tmp/composer-command-fixture',
  issueId: 'PAN-1525',
  createdAt: '2026-07-24T00:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  claudeSessionId: '00000000-0000-0000-0000-000000001525',
  title: 'Composer command fixture',
  titleSource: 'manual',
  titleSeed: 'Composer command fixture',
  totalCost: 0,
  totalTokens: 0,
  archivedAt: null,
  model: 'claude-fable-5',
  effort: null,
  forkStatus: null,
  forkError: null,
  harness: 'claude-code',
  deliveryMethod: null,
  spawnError: null,
  handoffDocPath: null,
  handoffTargetConvId: null,
  forkFallbackReason: null,
  clearedToConvId: null,
  forkRequest: null,
  forkRetryCount: 0,
  sessionAlive: true,
  contextUsage: null,
  branch: 'feature/pan-1525',
  isWorktree: true,
  pendingInputCount: 0,
  pendingInputKinds: [],
  transcriptMissing: false,
  needsTerminal: false,
};

async function installComposerFixtures(page: Page) {
  await page.route('**/api/conversations/*/message', async route => {
    const payload = route.request().postDataJSON() as { message?: string };
    expect(payload.message).toBe('/pan status');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'captured',
        status: 'completed',
        command: '/pan status',
        output: 'Pipeline status: ready',
        truncated: false,
      }),
    });
  });
  await page.route('**/api/conversations/*/messages', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ messages: [], workLog: [], streaming: false }),
  }));
  await page.route(`**/api/conversations/${CONVERSATION_ID}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(CONVERSATION),
  }));
  await page.route('**/api/conversations', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([CONVERSATION]),
  }));
  await page.route('**/api/dashboard/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
}

async function replaceComposerText(page: Page, text: string) {
  const composer = page.locator('[contenteditable="true"]').last();
  await composer.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  return composer;
}

test.describe('composer command surface', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('routes autocomplete, results, and handoff through dashboard-owned UI', async ({ page }, testInfo) => {
    await installComposerFixtures(page);
    await page.goto(`${DASHBOARD_URL}/conv/${CONVERSATION_ID}`, { waitUntil: 'domcontentloaded' });

    const composer = page.locator('[contenteditable="true"]').last();
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.click();
    await page.keyboard.type('/');

    const menu = page.getByRole('listbox', { name: 'Slash commands' });
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Claude Code native', { exact: true })).toBeVisible();
    await expect(menu.getByText('Overdeck', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('composer-command-menu.png') });

    await page.keyboard.type('pan st');
    await menu.getByText('/pan start', { exact: true }).click();
    await expect(composer).toContainText('/pan start');

    await replaceComposerText(page, '/pan status');
    await page.getByTitle('Send message (Enter)').click();
    await expect(page.getByText('/pan status completed successfully.')).toBeVisible();
    await expect(page.getByText('Pipeline status: ready')).toBeVisible();
    await expect(page.locator('[title="Pending — waiting for agent to process"]')).toHaveCount(0);

    await replaceComposerText(page, '/handoff make tests fast');
    await page.getByTitle('Send message (Enter)').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Focus (optional)')).toHaveValue('make tests fast');
    await expect(dialog.getByRole('radio', { name: /Agent handoff/ })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('composer-handoff-dialog.png') });
  });
});
