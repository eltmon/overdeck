/**
 * PAN-4259: an Agents Directory row for a native agent shows its launch
 * effort and source (`<level> (<source>)`), the same label the row and
 * detail panel compute from `DirectoryEntry.effort`/`effortSource`.
 *
 * Every API the page reads is route-mocked; this test runs in Playwright's
 * fresh browser context (an isolated profile).
 */
import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';

const DIRECTORY_ENTRY = {
  id: 'agent-pan-4259',
  kind: 'agent',
  label: 'work · PAN-4259',
  location: 'local',
  projectKey: 'overdeck',
  issueId: 'PAN-4259',
  issueTitle: null,
  parentId: null,
  role: 'work',
  harness: 'claude-code',
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  effortSource: 'role',
  state: 'stopped',
  startedAt: '2026-10-03T00:00:00.000Z',
  lastActivityAt: '2026-10-03T00:05:00.000Z',
  costUsd: null,
  source: 'overdeck',
  transcript: { route: 'agent', agentId: 'agent-pan-4259' },
};

async function installAgentsFixtures(page: Page): Promise<{ unexpectedWrites: string[] }> {
  const unexpectedWrites: string[] = [];
  // Registered first so the specific mocks below win: no un-mocked write ever
  // reaches the dashboard this spec runs against.
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    unexpectedWrites.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/agent-directory*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: '2026-10-03T00:10:00.000Z',
      windowHours: 24,
      entries: [DIRECTORY_ENTRY],
    }),
  }));
  await page.route('**/api/dashboard/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
  return { unexpectedWrites };
}

test.describe('Agents directory row effort (PAN-4259)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the native agent's effort and source on its row", async ({ page }) => {
    const { unexpectedWrites } = await installAgentsFixtures(page);
    await page.goto(`${DASHBOARD_URL}/agents?view=history`, { waitUntil: 'domcontentloaded' });

    const row = page.locator('[data-component="directory-row"]').first();
    await expect(row).toContainText('xhigh (role)', { timeout: 15_000 });
    expect(unexpectedWrites).toEqual([]);
  });
});
