/**
 * Linear MCP auth banner: expired link → Connect Linear → mocked success
 * (PAN-4464 WI-12).
 *
 * `npm run build` first: the fixture serves the *built* frontend out of `dist`
 * and runs the *built* server.
 *
 * Real Linear consent cannot run here, so the Linear MCP auth API is scripted
 * with `page.route` and every `https://linear.app/**` request is fulfilled
 * locally — the test never leaves the machine. The dashboard runs isolated
 * (throwaway `OVERDECK_HOME`, own port) in its own browser context.
 */
import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-4464';
const OLD_URL = 'https://linear.app/oauth/authorize?state=old';
const FRESH_URL = 'https://linear.app/oauth/authorize?state=fresh';
const AGENT = {
  agentId: 'conv-20261001-eba1',
  issueId: null,
  declaredAt: '2026-10-01T12:00:00.000Z',
  expiresAt: '2026-10-01T12:30:00.000Z',
  notifiedAt: null,
  issueUrl: null,
  conversationUrl: '/conv/3172',
  conversationTitle: 'Fernkite: hosted Emma assessment',
};

type ServerState = 'expired' | 'active' | 'none';

function projection(state: ServerState) {
  if (state === 'none') {
    return { status: 'none', authUrl: null, authUrlAgentId: null, authUrlExpiresAt: null, declaredAt: null, blockedAgents: [] };
  }
  return {
    status: state,
    authUrl: state === 'expired' ? OLD_URL : FRESH_URL,
    authUrlAgentId: AGENT.agentId,
    authUrlExpiresAt: state === 'expired' ? '2026-10-01T12:30:00.000Z' : '2099-01-01T00:00:00.000Z',
    declaredAt: AGENT.declaredAt,
    blockedAgents: [AGENT],
  };
}

let dashboard: IsolatedDashboard | null = null;

test.setTimeout(240_000);

test.afterEach(async () => {
  await dashboard?.stop();
  dashboard = null;
});

async function scriptLinearApi(page: Page): Promise<{ verifyCalls: () => number }> {
  let state: ServerState = 'expired';
  let verifyCalls = 0;
  await page.route('**/api/linear-mcp-auth', route => route.fulfill({ json: projection(state) }));
  await page.route('**/api/linear-mcp-auth/connect', async route => {
    state = 'active';
    await route.fulfill({
      status: 202,
      json: { action: 'refreshing', requestedFrom: AGENT.agentId, previousAuthUrl: OLD_URL },
    });
  });
  await page.route('**/api/linear-mcp-auth/verify', async route => {
    verifyCalls += 1;
    state = 'none';
    await route.fulfill({ status: 202, json: { requestedFrom: AGENT.agentId } });
  });
  return { verifyCalls: () => verifyCalls };
}

test('an expired Linear link is refreshed, approved, and verified from one click', async ({ browser }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  dashboard = await startIsolatedDashboard();

  const context = await browser.newContext();
  await context.route('https://linear.app/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Linear</title><p>Authorize Overdeck</p>',
  }));
  const page = await context.newPage();
  const api = await scriptLinearApi(page);

  await page.goto(`${dashboard.baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Linear authentication required/)).toBeVisible({ timeout: 30_000 });

  const row = page.getByRole('link', { name: 'Fernkite: hosted Emma assessment' });
  await expect(row).toHaveAttribute('href', '/conv/3172');
  await expect(row).toHaveAttribute('title', AGENT.agentId);
  await page.screenshot({ path: `${SHOT_DIR}/expired.png` });

  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: /Connect Linear/ }).click();
  const popup = await popupPromise;

  await expect(page.getByText('Getting a fresh link…')).toBeVisible();
  await expect.poll(() => popup.url(), { timeout: 15_000 }).toContain('state=fresh');
  await expect(page.getByText('Approve access in the Linear tab, then come back here.')).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/awaiting-approval.png` });

  // Returning to the dashboard after the 2 s grace auto-verifies on a
  // loopback host. Headless focus is unreliable, so fall back to Check now.
  await page.waitForTimeout(2_500);
  await page.bringToFront();
  await page.waitForTimeout(1_000);
  if (api.verifyCalls() === 0) {
    await page.getByRole('button', { name: 'Check now' }).click();
  }

  await expect(page.getByText('Linear connected — 1 agent resumed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Linear authentication required/)).toHaveCount(0);
  expect(api.verifyCalls()).toBe(1);
  await page.screenshot({ path: `${SHOT_DIR}/connected.png` });

  await context.close();
});
