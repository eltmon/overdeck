import http from 'node:http';
import { WebSocket as WsClient } from 'ws';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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
