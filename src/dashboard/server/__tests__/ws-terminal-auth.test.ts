import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket as WsClient } from 'ws';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests, dashboardSessionCookieHeader } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import { setupTerminalWebSocket } from '../ws-terminal.js';

const TRUSTED_ORIGIN = 'http://localhost:3011';

/** Extract the `name=value` pair from a Set-Cookie header for use as a request cookie. */
function requestCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
      resolve(address.port);
    });
  });
}

/** Resolve with the HTTP status of a rejected upgrade, or 101 when it opens. */
function upgradeStatus(client: WsClient): Promise<number> {
  return new Promise<number>((resolve) => {
    client.once('open', () => resolve(101));
    client.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? -1));
    client.once('error', () => {
      // 'unexpected-response' also fires an 'error'; ignore it here.
    });
  });
}

describe('/ws/terminal upgrade gate', () => {
  let server: http.Server;

  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    server = http.createServer();
    setupTerminalWebSocket(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  it('rejects the upgrade with 401 when no credential is sent', async () => {
    const port = await listen(server);
    const client = new WsClient(`ws://127.0.0.1:${port}/ws/terminal?session=x`, {
      headers: { origin: TRUSTED_ORIGIN },
    });

    const statusCode = await new Promise<number>((resolve, reject) => {
      client.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? -1));
      client.once('open', () => reject(new Error('expected the upgrade to be rejected')));
      client.once('error', () => {
        // 'unexpected-response' also fires an 'error'; ignore it here.
      });
    });

    expect(statusCode).toBe(401);
    client.terminate();
  });

  it('accepts the upgrade with a valid session cookie', async () => {
    const port = await listen(server);
    const cookie = requestCookie(dashboardSessionCookieHeader());
    const client = new WsClient(`ws://127.0.0.1:${port}/ws/terminal?session=x`, {
      headers: { origin: TRUSTED_ORIGIN, cookie },
    });

    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('unexpected-response', (_req, res) =>
        reject(new Error(`expected the upgrade to be accepted, got ${res.statusCode}`)),
      );
      client.once('error', (err) => reject(err));
    });

    client.terminate();
  });
});

describe('/ws/terminal upgrade scopes (PAN-2351)', () => {
  let server: http.Server;
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-2351-ws-scope-'));
    process.env.OVERDECK_HOME = home;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    _resetAccessTokensForTests();
    server = http.createServer();
    setupTerminalWebSocket(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await _settleAccessTokenWritesForTests();
    _resetAccessTokensForTests();
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  async function bearer(scopes: Parameters<typeof createAccessToken>[0]['scopes']) {
    const { token } = await createAccessToken({ name: scopes.join('+'), scopes, kind: 'token' });
    return { authorization: `Bearer ${token}` };
  }

  it('upgrades an operate-scoped Bearer token and rejects a read:events token with 403', async () => {
    const port = await listen(server);
    const operate = new WsClient(`ws://127.0.0.1:${port}/ws/terminal?session=x`, { headers: await bearer(['operate']) });
    expect(await upgradeStatus(operate)).toBe(101);
    operate.terminate();

    const readOnly = new WsClient(`ws://127.0.0.1:${port}/ws/terminal?session=x`, { headers: await bearer(['read:events']) });
    expect(await upgradeStatus(readOnly)).toBe(403);
    readOnly.terminate();
  });
});
