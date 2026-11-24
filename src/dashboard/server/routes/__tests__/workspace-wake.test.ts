import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The REST route runs the coordinator with its default deps; these keep it off Docker.
const routeMocks = vi.hoisted(() => ({
  wakeWorkspaceStack: vi.fn(),
  bypassAuth: true,
}));
vi.mock('../../../../lib/workspace/stack-restore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/workspace/stack-restore.js')>()),
  wakeWorkspaceStack: routeMocks.wakeWorkspaceStack,
}));
vi.mock('../../../../lib/workspace/stack-idle-config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/workspace/stack-idle-config.js')>()),
  workspacePathForIssue: () => null,
}));
vi.mock('../dashboard-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard-auth.js')>();
  return {
    ...actual,
    rejectUnsafeDashboardMutationRequest: (...args: Parameters<typeof actual.rejectUnsafeDashboardMutationRequest>) =>
      routeMocks.bypassAuth ? null : actual.rejectUnsafeDashboardMutationRequest(...args),
  };
});

import { requiredScopeFor } from '../../route-scopes.js';
import type { StackWakeResult } from '../../../../lib/workspace/stack-restore.js';
import {
  APP_HOST_TTL_MS,
  ensureWorkspaceWakeRouterFile,
  renderWakePage,
  requestWorkspaceWake,
  resetWorkspaceWakeStateForTests,
  setupWorkspaceWakeHost,
  WAKE_RESULT_TTL_MS,
  wakePollDecision,
  workspaceWakeRouteLayer,
  type WorkspaceWakeDeps,
} from '../workspace-wake.js';

const MARKER = { 'x-overdeck-wake-router': '1' };
const WOKEN: StackWakeResult = { kind: 'woken', restored: { kind: 'none' }, started: ['pan-1-frontend-1'], alreadyRunning: [] };

function makeDeps(overrides: Partial<WorkspaceWakeDeps> = {}) {
  const wake = vi.fn(async (): Promise<StackWakeResult> => WOKEN);
  const readLabelHost = vi.fn(async (): Promise<string | null> => null);
  const deps: Partial<WorkspaceWakeDeps> = {
    wake,
    readLabelHost,
    workspacePathFor: () => '/workspaces/feature-pan-1',
    composeProjectFor: () => 'overdeck-feature-pan-1',
    projectExists: (issueId) => issueId === 'PAN-1',
    wakeDomains: () => new Set(['overdeck.localhost', 'pan.localhost']),
    isTrusted: () => true,
    now: () => Date.now(),
    ...overrides,
  };
  return { deps, wake, readLabelHost };
}

beforeEach(() => {
  resetWorkspaceWakeStateForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── Real server (no fake timers: they would stall the sockets) ──────────────

interface Harness {
  port: number;
  requestListener: ReturnType<typeof vi.fn>;
  upgradeListener: ReturnType<typeof vi.fn>;
  close: () => Promise<void>;
}

async function startServer(deps: Partial<WorkspaceWakeDeps>): Promise<Harness> {
  // No constructor listener: every listener must go through the patched server.on.
  const server = http.createServer();
  setupWorkspaceWakeHost(server, deps, { dynamicDir: join(tmpdir(), 'pan-5649-missing-dynamic-dir') });
  const requestListener = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('dashboard');
  });
  // Registered after setup, as setupTerminalWebSocket and the Effect app do.
  const upgradeListener = vi.fn((_req: http.IncomingMessage, socket: import('node:stream').Duplex) => {
    socket.end('HTTP/1.1 418 Teapot\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('request', requestListener);
  server.on('upgrade', upgradeListener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    requestListener,
    upgradeListener,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function send(port: number, options: { path?: string; headers: Record<string, string> }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: options.path ?? '/', method: 'GET', headers: options.headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('setupWorkspaceWakeHost dispatch (PAN-5649)', () => {
  let harness: Harness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it('passes a feature-host request without the marker to the original listener', async () => {
    const { deps, wake } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, { headers: { host: 'feature-pan-1.overdeck.localhost' } });
    expect(reply).toMatchObject({ status: 200, body: 'dashboard' });
    expect(harness.requestListener).toHaveBeenCalledOnce();
    expect(wake).not.toHaveBeenCalled();
  });

  it('passes a marked dashboard-host request to the original listener', async () => {
    const { deps } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, { headers: { host: 'overdeck.localhost', ...MARKER } });
    expect(reply.body).toBe('dashboard');
    expect(harness.requestListener).toHaveBeenCalledOnce();
  });

  it('passes an unmarked /ws/rpc upgrade on a feature host to the original upgrade listener', async () => {
    const { deps } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, {
      path: '/ws/rpc',
      headers: { host: 'feature-pan-1.overdeck.localhost', connection: 'Upgrade', upgrade: 'websocket' },
    });
    expect(reply.status).toBe(418);
    expect(harness.upgradeListener).toHaveBeenCalledOnce();
  });

  it('refuses a marked upgrade with 503 and never shows it to a later upgrade listener', async () => {
    const { deps, wake } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, {
      path: '/ws',
      headers: { host: 'feature-pan-1.overdeck.localhost', connection: 'Upgrade', upgrade: 'websocket', ...MARKER },
    });
    expect(reply.status).toBe(503);
    expect(harness.upgradeListener).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });

  it('answers 404 to an untrusted caller without docker calls', async () => {
    const { deps, wake, readLabelHost } = makeDeps({ isTrusted: () => false });
    harness = await startServer(deps);
    const reply = await send(harness.port, { headers: { host: 'feature-pan-1.overdeck.localhost', ...MARKER } });
    expect(reply).toMatchObject({ status: 404, body: 'Not found' });
    expect(harness.requestListener).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
    expect(readLabelHost).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown domain or an unregistered project', async () => {
    const { deps, wake, readLabelHost } = makeDeps();
    harness = await startServer(deps);
    const evil = await send(harness.port, { headers: { host: 'feature-pan-1.evil.test', ...MARKER } });
    expect(evil.status).toBe(404);
    expect(evil.body).toBe('No Overdeck workspace answers at feature-pan-1.evil.test.');
    const unknown = await send(harness.port, { headers: { host: 'feature-zzz-9.overdeck.localhost', ...MARKER } });
    expect(unknown.status).toBe(404);
    expect(wake).not.toHaveBeenCalled();
    expect(readLabelHost).not.toHaveBeenCalled();
  });

  it('destroys a Vite ping socket without a status line', async () => {
    const { deps, wake } = makeDeps();
    harness = await startServer(deps);
    await expect(send(harness.port, { headers: { host: 'feature-pan-1.overdeck.localhost', accept: 'text/x-vite-ping', ...MARKER } }))
      .rejects.toThrow();
    expect(wake).not.toHaveBeenCalled();
  });

  it('answers an empty 503 to a non-waking request', async () => {
    const { deps, wake } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, { headers: { host: 'feature-pan-1.overdeck.localhost', 'sec-fetch-mode': 'no-cors', ...MARKER } });
    expect(reply.status).toBe(503);
    expect(reply.headers['x-overdeck-wake']).toBe('1');
    expect(reply.headers['retry-after']).toBe('5');
    expect(reply.body).toBe('');
    expect(wake).not.toHaveBeenCalled();
  });

  it('wakes a script request and answers 503 with a plain message', async () => {
    const { deps, wake } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, { headers: { host: 'feature-pan-1.overdeck.localhost', accept: '*/*', ...MARKER } });
    expect(reply.status).toBe(503);
    expect(reply.headers['retry-after']).toBe('5');
    expect(reply.headers['x-overdeck-wake']).toBe('1');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.body).toContain('PAN-1');
    expect(reply.body).toContain('is starting');
    expect(wake).toHaveBeenCalledExactlyOnceWith({ issueId: 'PAN-1', trigger: 'browser' });
    expect(harness.requestListener).not.toHaveBeenCalled();
  });

  it('wakes a navigation and answers the wake page with a CSP header', async () => {
    const { deps, wake } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, {
      headers: { host: 'feature-pan-1.overdeck.localhost', 'sec-fetch-mode': 'navigate', accept: 'text/html,*/*', ...MARKER },
    });
    expect(reply.status).toBe(503);
    expect(reply.headers['content-type']).toContain('text/html');
    expect(reply.headers['content-security-policy']).toContain("default-src 'none'");
    expect(reply.body).toContain('stopped after being unused');
    expect(wake).toHaveBeenCalledOnce();
  });

  it('redirects to the label host before waking', async () => {
    const { deps, wake } = makeDeps({ readLabelHost: vi.fn(async () => 'feature-pan-1.overdeck.localhost') });
    harness = await startServer(deps);
    const reply = await send(harness.port, { path: '/x?y=1', headers: { host: 'feature-pan-1.pan.localhost', ...MARKER } });
    expect(reply.status).toBe(307);
    expect(reply.headers.location).toBe('https://feature-pan-1.overdeck.localhost/x?y=1');
    expect(wake).not.toHaveBeenCalled();
  });

  it('answers the status path with JSON and never wakes', async () => {
    const { deps, wake, readLabelHost } = makeDeps();
    harness = await startServer(deps);
    const reply = await send(harness.port, { path: '/__overdeck_wake/status', headers: { host: 'feature-pan-1.overdeck.localhost', ...MARKER } });
    expect(reply.status).toBe(200);
    expect(reply.headers['x-overdeck-wake']).toBe('1');
    expect(JSON.parse(reply.body)).toMatchObject({ issueId: 'PAN-1', state: 'idle', appUrl: null });
    expect(wake).not.toHaveBeenCalled();
    expect(readLabelHost).not.toHaveBeenCalled();
  });
});

// ─── Coordinator (fake timers, no sockets) ───────────────────────────────────

describe('requestWorkspaceWake (PAN-5649)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('joins concurrent calls into one wake', async () => {
    let finish: (result: StackWakeResult) => void = () => {};
    const wake = vi.fn(() => new Promise<StackWakeResult>((resolve) => { finish = resolve; }));
    const { deps } = makeDeps({ wake });
    const first = requestWorkspaceWake('PAN-1', 'browser', deps);
    const second = requestWorkspaceWake('pan-1', 'dashboard', deps);
    finish(WOKEN);
    const [a, b] = await Promise.all([first, second]);
    expect(wake).toHaveBeenCalledOnce();
    expect(a).toBe(b);
    expect(a).toMatchObject({ state: 'started', started: ['pan-1-frontend-1'] });
  });

  it('reuses a finished result for 15 s, then wakes again', async () => {
    const { deps, wake } = makeDeps();
    await requestWorkspaceWake('PAN-1', 'browser', deps);
    await vi.advanceTimersByTimeAsync(10_000);
    await requestWorkspaceWake('PAN-1', 'browser', deps);
    expect(wake).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(WAKE_RESULT_TTL_MS + 1_000 - 10_000);
    await requestWorkspaceWake('PAN-1', 'browser', deps);
    expect(wake).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a failed result', async () => {
    const wake = vi.fn(async (): Promise<StackWakeResult> => ({ kind: 'failed', error: 'boom', failed: ['x'] }));
    const { deps } = makeDeps({ wake });
    expect(await requestWorkspaceWake('PAN-1', 'browser', deps)).toMatchObject({ state: 'failed', error: 'boom' });
    await requestWorkspaceWake('PAN-1', 'browser', deps);
    expect(wake).toHaveBeenCalledTimes(2);
  });

  it('turns a thrown wake into failed and maps no-stack', async () => {
    const thrown = makeDeps({ wake: vi.fn(async () => { throw new Error('kaboom'); }) });
    expect(await requestWorkspaceWake('PAN-1', 'browser', thrown.deps)).toMatchObject({ state: 'failed', error: 'kaboom' });
    resetWorkspaceWakeStateForTests();
    const none = makeDeps({ wake: vi.fn(async (): Promise<StackWakeResult> => ({ kind: 'no-stack', reason: 'no-compose-project' })) });
    expect(await requestWorkspaceWake('PAN-1', 'dashboard', none.deps)).toMatchObject({ state: 'no-stack', reason: 'no-compose-project' });
  });

  it('caches the label host for 60 s', async () => {
    const readLabelHost = vi.fn(async () => 'feature-pan-1.overdeck.localhost');
    const { deps } = makeDeps({ readLabelHost, wake: vi.fn(async (): Promise<StackWakeResult> => ({ kind: 'failed', error: 'x', failed: [] })) });
    expect(await requestWorkspaceWake('PAN-1', 'browser', deps)).toMatchObject({ appUrl: 'https://feature-pan-1.overdeck.localhost' });
    await requestWorkspaceWake('PAN-1', 'browser', deps);
    expect(readLabelHost).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(APP_HOST_TTL_MS + 1);
    await requestWorkspaceWake('PAN-1', 'browser', deps);
    expect(readLabelHost).toHaveBeenCalledTimes(2);
  });
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('wakePollDecision (PAN-5649)', () => {
  it.each([
    [200, true, 'wait'],
    [502, false, 'wait'],
    [503, false, 'wait'],
    [504, false, 'wait'],
    [200, false, 'reload'],
    [404, false, 'reload'],
  ] as const)('(%i, %s) → %s', (status, hasHeader, expected) => {
    expect(wakePollDecision(status, hasHeader)).toBe(expected);
  });
});

describe('renderWakePage (PAN-5649)', () => {
  it('escapes the host and embeds the poll decision', () => {
    const html = renderWakePage({ issueId: 'PAN-1', host: '<x>' });
    expect(html).toContain('&lt;x&gt;');
    expect(html).not.toContain('<x>');
    expect(html).toContain(wakePollDecision.toString());
    expect(html).toContain('/__overdeck_wake/status');
  });
});

describe('ensureWorkspaceWakeRouterFile (PAN-5649)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-5649-dynamic-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips a missing dir, writes once, then reports unchanged', async () => {
    await expect(ensureWorkspaceWakeRouterFile({ apiPort: 3011, dynamicDir: join(dir, 'missing') })).resolves.toBe('skipped');
    await expect(ensureWorkspaceWakeRouterFile({ apiPort: 3011, dynamicDir: dir })).resolves.toBe('written');
    await expect(ensureWorkspaceWakeRouterFile({ apiPort: 3011, dynamicDir: dir })).resolves.toBe('unchanged');
    await expect(ensureWorkspaceWakeRouterFile({ apiPort: 4102, dynamicDir: dir })).resolves.toBe('written');
  });
});

// ─── REST route (FR-11) ──────────────────────────────────────────────────────

async function postWake(issueId: string) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/workspaces/${issueId}/wake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(workspaceWakeRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

describe('POST /api/workspaces/:issueId/wake (PAN-5649)', () => {
  beforeEach(() => {
    routeMocks.bypassAuth = true;
    routeMocks.wakeWorkspaceStack.mockReset();
  });

  it('answers 200 with what it started', async () => {
    routeMocks.wakeWorkspaceStack.mockResolvedValue(WOKEN);
    const reply = await postWake('PAN-1');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ state: 'started', started: ['pan-1-frontend-1'], alreadyRunning: [], appUrl: null });
    expect(routeMocks.wakeWorkspaceStack).toHaveBeenCalledExactlyOnceWith({ issueId: 'PAN-1', trigger: 'dashboard' });
  });

  it('answers 404 for no workspace and 409 for no compose project', async () => {
    routeMocks.wakeWorkspaceStack.mockResolvedValue({ kind: 'no-stack', reason: 'no-workspace' });
    expect((await postWake('PAN-1')).status).toBe(404);
    resetWorkspaceWakeStateForTests();
    routeMocks.wakeWorkspaceStack.mockResolvedValue({ kind: 'no-stack', reason: 'no-compose-project' });
    const reply = await postWake('PAN-1');
    expect(reply.status).toBe(409);
    expect(reply.body.error).toBe('PAN-1 has no Docker stack to start.');
  });

  it('answers 500 with the error when the wake failed', async () => {
    routeMocks.wakeWorkspaceStack.mockResolvedValue({ kind: 'failed', error: 'boom', failed: ['x'] });
    const reply = await postWake('PAN-1');
    expect(reply.status).toBe(500);
    expect(reply.body.error).toContain('boom');
  });

  it('answers 400 for an invalid issue id', async () => {
    const reply = await postWake('not_an_issue');
    expect(reply.status).toBe(400);
    expect(routeMocks.wakeWorkspaceStack).not.toHaveBeenCalled();
  });

  it('answers 401 without a dashboard credential and never wakes', async () => {
    routeMocks.bypassAuth = false;
    const previous = process.env.OVERDECK_INTERNAL_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'workspace-wake-internal-token';
    try {
      const reply = await postWake('PAN-1');
      expect(reply.status).toBe(401);
      expect(routeMocks.wakeWorkspaceStack).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.OVERDECK_INTERNAL_TOKEN;
      else process.env.OVERDECK_INTERNAL_TOKEN = previous;
    }
  });

  it('needs the admin scope (no route-scopes row, D13)', () => {
    expect(requiredScopeFor('POST', '/api/workspaces/PAN-1/wake')).toBe('admin');
  });
});
