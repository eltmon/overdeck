/**
 * PAN-3762 — the pairing journey, end to end.
 *
 * Runs against an isolated dashboard (its own temp `OVERDECK_HOME` and port,
 * no Deacon) in a fresh browser context, never the operator's live dashboard.
 * `npm run build` first — the fixture serves the built frontend from `dist`.
 *
 * Journey: issue a pairing credential with the internal token → open
 * `/#pair=<credential>` in a fresh context → the dashboard loads with an
 * `overdeck_device` cookie, no `overdeck_session`, and the hash gone → revoke
 * the device → its next credential-checked `/api/*` call is 401 and the RPC
 * socket closes.
 *
 * The browser's TCP peer is loopback, which the remote request gate trusts, so
 * the post-revocation check uses `GET /api/devices`: that route checks the
 * credential itself, whatever the peer.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type WebSocket as PageWebSocket } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-3762';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const BANNER = '[data-component="degraded-mode-banner"]';

let dashboard: IsolatedDashboard;
let internalToken: string;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeEach(async () => {
  dashboard = await startIsolatedDashboard();
  // The fixture inherits this process's env; the server prefers that variable over the file.
  internalToken = process.env.OVERDECK_INTERNAL_TOKEN || readFileSync(join(dashboard.home, 'internal-token'), 'utf8').trim();
});

test.afterEach(async () => {
  await dashboard?.stop();
});

function asInternal(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-overdeck-internal-token': internalToken };
}

test('pairs a fresh browser, then revocation cuts it off', async ({ browser }) => {
  const issued = await fetch(`${dashboard.baseUrl}/api/pairing/credentials`, {
    method: 'POST',
    headers: asInternal(),
    body: JSON.stringify({ label: 'e2e' }),
  });
  expect(issued.status).toBe(200);
  const { credential, pairingPath } = await issued.json() as { credential: string; pairingPath: string };
  expect(pairingPath).toBe(`/#pair=${credential}`);

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const rpcSockets: PageWebSocket[] = [];
    page.on('websocket', (ws) => {
      if (ws.url().includes('/ws/rpc')) rpcSockets.push(ws);
    });

    const exchange = page.waitForResponse((res) => res.url().endsWith('/api/pairing/exchange'));
    const mint = page.waitForResponse((res) => res.url().endsWith('/api/dashboard/session') && res.request().method() === 'POST');
    await page.goto(`${dashboard.baseUrl}${pairingPath}`, { waitUntil: 'domcontentloaded' });
    expect((await exchange).status()).toBe(200);
    expect((await mint).status()).toBe(200);
    await expect(page.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(`${BANNER}[data-phase="unauthorized"]`)).toHaveCount(0);

    expect(new URL(page.url()).hash).toBe('');
    const cookies = await context.cookies();
    const deviceCookie = cookies.find((c) => c.name === 'overdeck_device');
    expect(deviceCookie?.value).toMatch(/^odk_[0-9a-f]{64}$/);
    expect(cookies.some((c) => c.name === 'overdeck_session')).toBe(false);

    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/paired-dashboard.png` });

    const listed = await page.request.get(`${dashboard.baseUrl}/api/devices`);
    expect(listed.status()).toBe(200);
    const { devices } = await listed.json() as { devices: Array<{ id: string; name: string; revokedAt: string | null }> };
    expect(devices).toHaveLength(1);
    expect(devices[0]!.revokedAt).toBeNull();

    // The page can open /ws/rpc before its session mint finishes; that first
    // attempt is refused and retried. Watch a socket that is open and settled.
    const openSockets = () => rpcSockets.filter((ws) => !ws.isClosed());
    await expect.poll(() => openSockets().length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1_500);
    const liveSocket = openSockets().at(-1);
    expect(liveSocket, 'an RPC socket should stay open for a paired device').toBeTruthy();
    // Effect's RPC server ends the socket without a close code, which the page
    // may report as a socket error rather than a clean close; either ends it.
    let revokeSent = false;
    const socketEnded = new Promise<string>((resolve) => {
      liveSocket!.on('close', () => resolve(`close (after revoke: ${revokeSent})`));
      liveSocket!.on('socketerror', () => resolve(`socketerror (after revoke: ${revokeSent})`));
    });

    revokeSent = true;
    const revoked = await fetch(`${dashboard.baseUrl}/api/devices/${devices[0]!.id}`, {
      method: 'DELETE',
      headers: asInternal(),
    });
    expect(revoked.status).toBe(200);

    const ended = await Promise.race([
      socketEnded,
      new Promise<string>((resolve) => setTimeout(() => resolve('still open'), 20_000)),
    ]);
    expect(ended).toMatch(/after revoke: true/);
    const afterRevoke = await page.request.get(`${dashboard.baseUrl}/api/devices`);
    expect(afterRevoke.status()).toBe(401);

    await page.waitForTimeout(1_000);
    await page.screenshot({ path: `${SHOT_DIR}/after-revocation.png` });
  } finally {
    await context.close();
  }
});

test('refuses to reuse a pairing credential', async ({ browser }) => {
  const issued = await fetch(`${dashboard.baseUrl}/api/pairing/credentials`, {
    method: 'POST',
    headers: asInternal(),
    body: JSON.stringify({}),
  });
  const { pairingPath } = await issued.json() as { pairingPath: string };

  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const page = await first.newPage();
    const firstExchange = page.waitForResponse((res) => res.url().endsWith('/api/pairing/exchange'));
    await page.goto(`${dashboard.baseUrl}${pairingPath}`, { waitUntil: 'domcontentloaded' });
    expect((await firstExchange).status()).toBe(200);

    const again = await second.newPage();
    const exchange = again.waitForResponse((res) => res.url().endsWith('/api/pairing/exchange'));
    await again.goto(`${dashboard.baseUrl}${pairingPath}`, { waitUntil: 'domcontentloaded' });
    expect((await exchange).status()).toBe(401);
    expect((await second.cookies()).some((c) => c.name === 'overdeck_device')).toBe(false);
  } finally {
    await first.close();
    await second.close();
  }
});
