import http from 'node:http';

import { Effect } from 'effect';
import { WebSocket as WsClient } from 'ws';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests, dashboardSessionCookieHeader } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import { startTerminalHeartbeat } from '../ws-terminal-heartbeat.js';
import { setupTerminalWebSocket } from '../ws-terminal.js';

const TRUSTED_ORIGIN = 'http://localhost:3011';

const ptyMockState = vi.hoisted(() => ({
  write: vi.fn(),
  exitCallback: null as ((info: { exitCode: number }) => void) | null,
}));

vi.mock('@lydell/node-pty', () => ({
  spawn: vi.fn(() => ({
    write: ptyMockState.write,
    resize: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn((cb: (info: { exitCode: number }) => void) => {
      ptyMockState.exitCallback = cb;
    }),
    kill: vi.fn(),
  })),
}));

vi.mock('../../../lib/tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tmux.js')>()),
  sessionExists: () => Effect.succeed(true),
  getWindowDimensions: () => Effect.succeed({ cols: 80, rows: 24 }),
  capturePane: async () => '',
  listSessionNames: () => Effect.succeed(['x']),
  resizeWindow: () => Effect.succeed(undefined),
}));

vi.mock('../services/terminal-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/terminal-service.js')>()),
  resolveTerminalAttachTarget: async () => ({ kind: 'tmux' as const }),
}));

vi.mock('../ws-terminal-heartbeat.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ws-terminal-heartbeat.js')>();
  return { ...actual, startTerminalHeartbeat: vi.fn(actual.startTerminalHeartbeat) };
});

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

function openSocket(url: string): Promise<WsClient> {
  const cookie = requestCookie(dashboardSessionCookieHeader());
  const client = new WsClient(url, { headers: { origin: TRUSTED_ORIGIN, cookie } });
  return new Promise((resolve, reject) => {
    client.once('open', () => resolve(client));
    client.once('unexpected-response', (_req, res) => reject(new Error(`upgrade rejected: ${res.statusCode}`)));
    client.once('error', (err) => reject(err));
  });
}

function nextMessage(client: WsClient): Promise<string> {
  return new Promise((resolve) => {
    client.once('message', (data) => resolve(data.toString()));
  });
}

async function attachAndAwaitSnapshot(client: WsClient): Promise<void> {
  client.send(JSON.stringify({ type: 'attach', cols: 80, rows: 24 }));
  const msg = await nextMessage(client);
  if (!msg.startsWith('\u0000{"type":"snapshot"')) {
    throw new Error(`expected a snapshot control frame, got: ${msg}`);
  }
}

describe('/ws/terminal heartbeat wiring (PAN-4434)', () => {
  let server: http.Server;

  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    ptyMockState.write.mockClear();
    ptyMockState.exitCallback = null;
    vi.mocked(startTerminalHeartbeat).mockClear();
    server = http.createServer();
    setupTerminalWebSocket(server);
  });

  afterEach(async () => {
    ptyMockState.exitCallback?.({ exitCode: 0 });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  it('a pong never reaches the PTY', async () => {
    const port = await listen(server);
    const client = await openSocket(`ws://127.0.0.1:${port}/ws/terminal?session=pong-filter&heartbeat=1`);
    await attachAndAwaitSnapshot(client);
    client.send(JSON.stringify({ type: 'ready' }));
    client.send(JSON.stringify({ type: 'pong' }));
    client.send(JSON.stringify({ type: 'ping' }));
    client.send('x');

    await vi.waitFor(() => expect(ptyMockState.write).toHaveBeenCalledWith('x'));
    expect(ptyMockState.write).not.toHaveBeenCalledWith('{"type":"pong"}');
    expect(ptyMockState.write).not.toHaveBeenCalledWith('{"type":"ping"}');

    client.terminate();
  });

  it('a pong before attach is not buffered as input', async () => {
    const port = await listen(server);
    const client = await openSocket(`ws://127.0.0.1:${port}/ws/terminal?session=pong-preattach&heartbeat=1`);
    client.send(JSON.stringify({ type: 'pong' }));
    await attachAndAwaitSnapshot(client);
    client.send('y');

    await vi.waitFor(() => expect(ptyMockState.write).toHaveBeenCalledWith('y'));
    expect(ptyMockState.write).not.toHaveBeenCalledWith('{"type":"pong"}');

    client.terminate();
  });

  it('starts the heartbeat at connection only when opted in', async () => {
    const port = await listen(server);

    const optedIn = await openSocket(`ws://127.0.0.1:${port}/ws/terminal?session=heartbeat-optin&heartbeat=1`);
    await vi.waitFor(() => expect(startTerminalHeartbeat).toHaveBeenCalledTimes(1));
    optedIn.terminate();

    vi.mocked(startTerminalHeartbeat).mockClear();

    const optedOut = await openSocket(`ws://127.0.0.1:${port}/ws/terminal?session=heartbeat-optout`);
    await attachAndAwaitSnapshot(optedOut);
    expect(startTerminalHeartbeat).toHaveBeenCalledTimes(0);
    optedOut.terminate();
  });
});
