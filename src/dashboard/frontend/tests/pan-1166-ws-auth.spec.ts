/**
 * PAN-1166 — the shared WebSocket auth gate, end to end.
 *
 * Runs against an isolated dashboard (its own temp `OVERDECK_HOME` and port,
 * no Deacon) in a fresh browser context, never the operator's live dashboard.
 * `npm run build` first — the fixture serves the built frontend from `dist`.
 *
 * The isolated fixture's TCP peer is loopback (Playwright's Chromium and the
 * Node `ws` client both run on this host), and its base URL is always a
 * default-trusted origin (`getTrustedOrigins()` adds `http://127.0.0.1:<port>`
 * unconditionally from `API_PORT`), so journey 1's zero-step mint needs no
 * extra origin/token configuration.
 */

import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { WebSocket as WsClient } from 'ws';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-1166';
const BANNER = '[data-component="degraded-mode-banner"]';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const UPGRADE_PATHS = ['/ws/terminal?session=x', '/ws/rpc', '/ws/voice', '/ws/autopreso'];

let dashboard: IsolatedDashboard;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeEach(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterEach(async () => {
  await dashboard?.stop();
});

function wsUrl(path: string): string {
  return `${dashboard.baseUrl.replace(/^http/, 'ws')}${path}`;
}

/**
 * Attempt a raw upgrade with the given headers. Resolves once the outcome is
 * known: `open` means the upgrade was accepted (regardless of what the
 * application-layer handler does with the socket afterwards — see W2's
 * `/ws/terminal` unit test for the same reasoning); `unexpected-response`
 * means the server rejected the upgrade at the gate, with the HTTP status it
 * sent.
 */
function attemptUpgrade(path: string, headers: Record<string, string>): Promise<{ accepted: boolean; statusCode?: number }> {
  return new Promise((resolve) => {
    const client = new WsClient(wsUrl(path), { headers });
    let settled = false;
    const settle = (result: { accepted: boolean; statusCode?: number }) => {
      if (settled) return;
      settled = true;
      client.terminate();
      resolve(result);
    };
    client.once('open', () => settle({ accepted: true }));
    client.once('unexpected-response', (_req, res) => settle({ accepted: false, statusCode: res.statusCode }));
    // 'unexpected-response' also fires an 'error' event; the settled guard
    // above means this only matters for a transport failure that isn't one.
    client.once('error', () => settle({ accepted: false }));
  });
}

test('mints a session with no URL hash and reaches a live dashboard', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(dashboard.baseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator(`${BANNER}[data-phase="unauthorized"]`)).toHaveCount(0);

    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name === 'overdeck_session')).toBe(true);

    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/zero-step-bootstrap.png` });
  } finally {
    await context.close();
  }
});

test('rejects every /ws/* upgrade with 401 when no credential is sent', async () => {
  for (const path of UPGRADE_PATHS) {
    const result = await attemptUpgrade(path, { origin: dashboard.baseUrl });
    expect(result.accepted, `${path} should reject an upgrade with no credential`).toBe(false);
    expect(result.statusCode, `${path} should reject with 401`).toBe(401);
  }
});

test('accepts every /ws/* upgrade carrying the minted session cookie', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(dashboard.baseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 20_000 });

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'overdeck_session');
    expect(sessionCookie, 'zero-step bootstrap should have minted overdeck_session').toBeTruthy();
    const cookieHeader = `overdeck_session=${sessionCookie!.value}`;

    for (const path of UPGRADE_PATHS) {
      const result = await attemptUpgrade(path, { origin: dashboard.baseUrl, cookie: cookieHeader });
      expect(result.accepted, `${path} should accept an upgrade carrying the session cookie`).toBe(true);
    }
  } finally {
    await context.close();
  }
});

test('shows the unauthorized phase loudly when the session mint is refused', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('**/api/dashboard/session', (route) =>
      route.fulfill({ status: 401, json: { error: 'unauthorized' } }),
    );
    await page.goto(dashboard.baseUrl, { waitUntil: 'domcontentloaded' });

    const unauthorizedBanner = page.locator(`${BANNER}[data-phase="unauthorized"]`);
    const firstLoadRefusal = page.locator(FIRST_LOAD).getByText('Dashboard session could not be established');
    await expect(unauthorizedBanner.or(firstLoadRefusal)).toBeVisible({ timeout: 20_000 });

    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/unauthorized.png` });
  } finally {
    await context.close();
  }
});
