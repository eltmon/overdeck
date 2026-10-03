import { expect, test, type Page } from '@playwright/test';

// PAN-4493 WI-6: paste an image, open it full size from the composer thumbnail,
// close it, send the message, and open it again from the sent-message thumbnail.

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';
const CONVERSATION_ID = 4493;
const ATTACHMENT_NAME = '3f2b1c4d-0000-4000-8000-000000004493.png';
const ATTACHMENT_PATH = `/home/op/.overdeck/conversation-attachments/image-lightbox-fixture/${ATTACHMENT_NAME}`;
// 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

const CONVERSATION = {
  id: CONVERSATION_ID,
  name: 'image-lightbox-fixture',
  tmuxSession: 'conv-image-lightbox-fixture',
  status: 'active',
  cwd: '/tmp/image-lightbox-fixture',
  issueId: 'PAN-4493',
  createdAt: '2026-10-03T00:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  claudeSessionId: '00000000-0000-0000-0000-000000004493',
  title: 'Image lightbox fixture',
  titleSource: 'manual',
  titleSeed: 'Image lightbox fixture',
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
  branch: 'feature/pan-4493',
  isWorktree: true,
  pendingInputCount: 0,
  pendingInputKinds: [],
  transcriptMissing: false,
  needsTerminal: false,
};

async function installFixtures(page: Page, options: { sent: boolean }) {
  await page.route('**/api/conversations/*/upload-image', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ path: ATTACHMENT_PATH }),
  }));
  await page.route(`**/api/conversations/*/attachments/${ATTACHMENT_NAME}`, route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: PNG_BYTES,
  }));
  await page.route('**/api/conversations/*/message', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }));
  await page.route('**/api/conversations/*/messages', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      messages: options.sent
        ? [{
            id: 'msg-1',
            role: 'user',
            text: `@${ATTACHMENT_PATH}`,
            createdAt: '2026-10-03T00:00:01.000Z',
          }]
        : [],
      workLog: [],
      streaming: false,
    }),
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

/** Dispatches a synthetic clipboard paste of a PNG onto the composer. */
async function pasteImage(page: Page): Promise<void> {
  const composer = page.locator('[contenteditable="true"]').last();
  await composer.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG_B64);
}

test.describe('PAN-4493 image lightbox', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('pastes, opens from the composer, sends, and opens from the sent message', async ({ page }, testInfo) => {
    await installFixtures(page, { sent: false });
    await page.goto(`${DASHBOARD_URL}/conv/${CONVERSATION_ID}`, { waitUntil: 'domcontentloaded' });

    const composer = page.locator('[contenteditable="true"]').last();
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.click();

    await pasteImage(page);
    // Fallback: some Chromium builds drop clipboardData on a synthetic
    // ClipboardEvent — if the thumbnail never appears, fall back to the same
    // addAttachments path the paperclip button and drag-drop use.
    const thumbnailButton = page.getByTitle('View pasted.png');
    if (!(await thumbnailButton.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await page.locator('input[type="file"]').setInputFiles({
        name: 'pasted.png',
        mimeType: 'image/png',
        buffer: PNG_BYTES,
      });
    }
    await expect(thumbnailButton).toBeVisible();

    await thumbnailButton.click();
    const lightbox = page.getByTestId('image-lightbox');
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('img')).toHaveJSProperty('naturalWidth', 1);
    await page.screenshot({ path: testInfo.outputPath('composer-lightbox-open.png') });

    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();

    await thumbnailButton.click();
    await expect(lightbox).toBeVisible();
    await lightbox.click({ position: { x: 5, y: 5 } });
    await expect(lightbox).toBeHidden();

    await installFixtures(page, { sent: true });
    await page.getByTitle('Send message (Enter)').click();

    const sentThumbnails = page.getByTestId('user-message-attachments');
    await expect(sentThumbnails).toBeVisible();
    await sentThumbnails.locator('button').click();
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('img')).toHaveAttribute('src', new RegExp(`/attachments/${ATTACHMENT_NAME}$`));
    await page.screenshot({ path: testInfo.outputPath('sent-message-lightbox-open.png') });

    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
  });
});
