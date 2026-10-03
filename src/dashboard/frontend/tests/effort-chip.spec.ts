/**
 * PAN-4255: the composer effort chip shows `<Level> · <source>` for a running
 * claude-code conversation (never "Effort unverified"), and a pick sends a
 * live change and re-labels the chip `<Level> · set`.
 *
 * Every API the panel reads is route-mocked; each test runs in Playwright's
 * fresh browser context (an isolated profile).
 */
import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';
const CONVERSATION_ID = 4255;
const CONTEXT_USAGE = {
  activeBytes: 2048,
  estimatedTokens: 12_000,
  contextWindow: 200_000,
  percentUsed: 6,
  lastModel: 'claude-opus-4-7',
  lastEffort: 'high',
  lastTurnAt: '2026-10-03T12:00:00.000Z',
};
const CONVERSATION = {
  id: CONVERSATION_ID,
  name: 'effort-chip-fixture',
  tmuxSession: 'conv-effort-chip-fixture',
  status: 'active',
  cwd: '/tmp/effort-chip-fixture',
  issueId: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  claudeSessionId: '00000000-0000-0000-0000-000000004255',
  title: 'Effort chip fixture',
  titleSource: 'manual',
  titleSeed: 'Effort chip fixture',
  totalCost: 0,
  totalTokens: 0,
  archivedAt: null,
  model: 'claude-opus-4-7',
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
  // With WebSocket streaming on, the HTTP messages read is skipped and the
  // panel falls back to the row's contextUsage.
  contextUsage: CONTEXT_USAGE,
  branch: null,
  isWorktree: false,
  pendingInputCount: 0,
  pendingInputKinds: [],
  transcriptMissing: false,
  needsTerminal: false,
};

async function installEffortFixtures(page: Page): Promise<{ thinkingLevelBodies: Array<Record<string, unknown>>; unexpectedWrites: string[] }> {
  const thinkingLevelBodies: Array<Record<string, unknown>> = [];
  // Registered first so the specific mocks below win: no un-mocked write ever
  // reaches the dashboard this spec runs against.
  const unexpectedWrites: string[] = [];
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    unexpectedWrites.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/conversations/*/thinking-level', async route => {
    thinkingLevelBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, effort: 'low', source: 'explicit' }),
    });
  });
  await page.route(/\/api\/effort\/default(\?|$)/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ effort: 'high', source: 'default', requested: 'high', clamped: false }),
  }));
  await page.route('**/api/conversations/*/messages', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ messages: [], workLog: [], streaming: false, contextUsage: CONTEXT_USAGE }),
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
  return { thinkingLevelBodies, unexpectedWrites };
}

test.describe('composer effort chip (PAN-4255)', () => {
  // Wide enough that the composer toolbar does not truncate its pickers.
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1000 } });

  test('shows the effective level and source, then a live change as set', async ({ page }, testInfo) => {
    const { thinkingLevelBodies, unexpectedWrites } = await installEffortFixtures(page);
    await page.goto(`${DASHBOARD_URL}/conv/${CONVERSATION_ID}`, { waitUntil: 'domcontentloaded' });

    // Only a running session's picker carries a chip (data-observed); the
    // sidebar's new-conversation picker does not.
    const chip = page.locator('[data-testid="effort-chip"][data-observed]');
    await expect(chip).toHaveText('High · default', { timeout: 15_000 });
    await expect(chip).toHaveAttribute('data-observed', 'true');
    await expect(page.getByText('Effort unverified')).toHaveCount(0);
    await chip.screenshot({ path: testInfo.outputPath('effort-chip-default.png') });

    await chip.click();
    await page.getByTestId('effort-picker-dropdown').getByRole('button', { name: 'Low', exact: true }).click();

    await expect(chip).toHaveText('Low · set');
    expect(thinkingLevelBodies).toEqual([{ level: 'low' }]);
    await expect(page.getByText('Effort unverified')).toHaveCount(0);
    await chip.screenshot({ path: testInfo.outputPath('effort-chip-set.png') });
    expect(unexpectedWrites).toEqual([]);
  });
});
