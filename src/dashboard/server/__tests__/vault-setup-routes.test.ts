/**
 * PAN-4446 WI-6: POST /api/vault/setup, /join and /sync. Only the root session
 * or a paired device may call them (D-8); the internal token and a scoped token
 * get 403 and the vault service is never called. Every response is no-store.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  getVaultServiceSnapshot: vi.fn(),
  reviewEvictionBatch: vi.fn(),
  confirmEvictionBatch: vi.fn(),
  declineEvictionEntry: vi.fn(),
  clearEvictionBatch: vi.fn(),
  reofferEvictionEntry: vi.fn(),
  setupVaultFromDashboard: vi.fn(),
  joinVaultFromDashboard: vi.fn(),
  syncVaultNow: vi.fn(),
}));
vi.mock('../services/vault-service.js', () => serviceMocks);
vi.mock('../services/vault-continue.js', () => ({ previewContinue: vi.fn(), continueHere: vi.fn() }));
const handoffMock = vi.hoisted(() => vi.fn());
vi.mock('../services/vault-handoff.js', () => ({ handOffConversation: handoffMock }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { vaultRouteLayer } = await import('../routes/vault.js');

const INTERNAL_TOKEN = 'vault-setup-internal-token-0123456789';
const SESSION_TOKEN = 'vault-setup-session-token-0123456789';
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN'] as const;
const REMOTE = 'git@example.com:me/vault.git';
const CREATED = {
  status: 'created',
  backend: REMOTE,
  machine: { label: 'desk', environmentId: '00000000-0000-4000-8000-000000000000' },
  recoveryPhrase: 'abandon '.repeat(23) + 'art',
  passphrase: { stored: true, generated: 'one two three four five six' },
};
const JOINED = { status: 'joined', backend: REMOTE, machine: CREATED.machine, records: 2, offline: false, via: 'passphrase' };
let savedEnv: Record<string, string | undefined>;
let home: string;

async function post(path: string, body: unknown, headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(vaultRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, json: text ? JSON.parse(text) : null };
}

function asRootSession() {
  return {
    cookie: `overdeck_session=${SESSION_TOKEN}`,
    'x-overdeck-csrf-token': dashboardCsrfToken(),
    origin: 'http://localhost:3011',
  };
}

const ROUTES = [
  { path: '/api/vault/setup', body: { url: REMOTE, passphrase: { mode: 'generate' } } },
  { path: '/api/vault/join', body: { url: REMOTE, secret: { kind: 'passphrase', value: 'quiet harbor lantern 42 mosaic' } } },
  { path: '/api/vault/sync', body: {} },
  { path: '/api/vault/sessions/by-conversation/conv-1/settle', body: {} },
] as const;
const HANDOFF_SAVED = {
  status: 200,
  body: {
    result: 'saved',
    vaultId: '12345678-aaaa-4bbb-8ccc-dddddddddddd',
    version: 3,
    savedAt: '2026-10-01T10:00:00.000Z',
    title: 'Fix the parser',
    machineLabel: 'desk',
    logLines: 12,
    alreadySaved: false,
    forkedFrom: null,
    wipProblem: null,
  },
};

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-4446-vault-routes-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  for (const mock of Object.values(serviceMocks)) mock.mockReset();
  serviceMocks.setupVaultFromDashboard.mockResolvedValue(CREATED);
  serviceMocks.joinVaultFromDashboard.mockResolvedValue(JOINED);
  serviceMocks.syncVaultNow.mockResolvedValue({ status: 'synced', snapshot: { state: 'ready', running: true } });
  handoffMock.mockReset();
  handoffMock.mockResolvedValue(HANDOFF_SAVED);
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  await rm(home, { recursive: true, force: true });
});

describe('POST /api/vault/setup, /join, /sync (PAN-4446)', () => {
  it('root session: setup returns the created result once with Cache-Control: no-store', async () => {
    const res = await post('/api/vault/setup', { url: REMOTE, passphrase: { mode: 'generate' } }, asRootSession());
    expect(res.status).toBe(200);
    expect(res.json).toEqual(CREATED);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(serviceMocks.setupVaultFromDashboard).toHaveBeenCalledWith({ url: REMOTE, passphrase: { mode: 'generate' } });
  });

  it('root session: join returns the joined result with Cache-Control: no-store', async () => {
    const res = await post('/api/vault/join', { url: REMOTE, secret: { kind: 'phrase', value: 'abandon art' } }, asRootSession());
    expect(res.status).toBe(200);
    expect(res.json).toEqual(JOINED);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(serviceMocks.joinVaultFromDashboard).toHaveBeenCalledWith({ url: REMOTE, secret: { kind: 'phrase', value: 'abandon art' } });
  });

  it('a paired device cookie with CSRF reaches the vault service', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const res = await post(
      '/api/vault/setup',
      { url: REMOTE, passphrase: { mode: 'none' } },
      { cookie: `overdeck_device=${token}`, 'x-overdeck-csrf-token': dashboardCsrfToken() },
    );
    expect(res.status).toBe(200);
    expect(serviceMocks.setupVaultFromDashboard).toHaveBeenCalledTimes(1);
  });

  it.each(ROUTES)('$path refuses the internal token and a scoped Bearer token with 403 and calls no service', async ({ path, body }) => {
    const internal = await post(path, body, { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(internal.status).toBe(403);
    expect(internal.headers['cache-control']).toBe('no-store');

    const { token } = await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    const bearer = await post(path, body, { authorization: `Bearer ${token}` });
    expect(bearer.status).toBe(403);

    expect(serviceMocks.setupVaultFromDashboard).not.toHaveBeenCalled();
    expect(serviceMocks.joinVaultFromDashboard).not.toHaveBeenCalled();
    expect(serviceMocks.syncVaultNow).not.toHaveBeenCalled();
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it('a core error result returns 422 with its code', async () => {
    serviceMocks.setupVaultFromDashboard.mockResolvedValue({ status: 'error', code: 'foreign-vault', message: 'already a vault' });
    const res = await post('/api/vault/setup', { url: REMOTE, passphrase: { mode: 'none' } }, asRootSession());
    expect(res.status).toBe(422);
    expect(res.json).toEqual({ status: 'error', code: 'foreign-vault', message: 'already a vault' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('an option-like url or a bad passphrase or secret returns 400 and calls no service', async () => {
    expect((await post('/api/vault/setup', { url: '-x', passphrase: { mode: 'none' } }, asRootSession())).status).toBe(400);
    expect((await post('/api/vault/setup', { url: 'a\nb', passphrase: { mode: 'none' } }, asRootSession())).status).toBe(400);
    expect((await post('/api/vault/setup', { url: REMOTE, passphrase: { mode: 'custom', value: '' } }, asRootSession())).status).toBe(400);
    expect((await post('/api/vault/join', { url: '-x', secret: { kind: 'phrase', value: 'a' } }, asRootSession())).status).toBe(400);
    expect((await post('/api/vault/join', { url: REMOTE, secret: { kind: 'key', value: 'a' } }, asRootSession())).status).toBe(400);
    expect(serviceMocks.setupVaultFromDashboard).not.toHaveBeenCalled();
    expect(serviceMocks.joinVaultFromDashboard).not.toHaveBeenCalled();
  });

  it('sync returns the fresh snapshot, 409 sync-not-running on a peer, and 500 with only the message on a throw', async () => {
    const ok = await post('/api/vault/sync', {}, asRootSession());
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ state: 'ready', running: true });

    serviceMocks.syncVaultNow.mockResolvedValue({ status: 'not-running' });
    const peer = await post('/api/vault/sync', {}, asRootSession());
    expect(peer.status).toBe(409);
    expect(peer.json).toEqual({ error: 'Background sync runs only in the primary dashboard.', code: 'sync-not-running' });

    serviceMocks.syncVaultNow.mockRejectedValue(new Error('disk full'));
    const failed = await post('/api/vault/sync', {}, asRootSession());
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({ error: 'disk full' });
    expect(failed.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/vault/sessions/by-conversation/:name/settle (PAN-4455)', () => {
  const PATH = '/api/vault/sessions/by-conversation/conv-1/settle';

  it('root session: returns the hand-off status and body with Cache-Control: no-store', async () => {
    const res = await post(PATH, {}, asRootSession());
    expect(res.status).toBe(200);
    expect(res.json).toEqual(HANDOFF_SAVED.body);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(handoffMock).toHaveBeenCalledWith('conv-1');
  });

  it('passes a non-200 hand-off outcome through unchanged', async () => {
    handoffMock.mockResolvedValue({ status: 409, body: { result: 'vault-unavailable', state: 'off', error: 'off' } });
    const res = await post(PATH, {}, asRootSession());
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ result: 'vault-unavailable', state: 'off', error: 'off' });
  });

  it('decodes a percent-encoded conversation name', async () => {
    await post('/api/vault/sessions/by-conversation/conv%20one/settle', {}, asRootSession());
    expect(handoffMock).toHaveBeenCalledWith('conv one');
  });

  it('a paired device cookie with CSRF reaches the hand-off service', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const res = await post(PATH, {}, { cookie: `overdeck_device=${token}`, 'x-overdeck-csrf-token': dashboardCsrfToken() });
    expect(res.status).toBe(200);
    expect(handoffMock).toHaveBeenCalledWith('conv-1');
  });

  it('a 100-character name reaches the service; a 101-character name never matches the route', async () => {
    const longest = 'a'.repeat(100);
    expect((await post(`/api/vault/sessions/by-conversation/${longest}/settle`, {}, asRootSession())).status).toBe(200);
    expect(handoffMock).toHaveBeenCalledWith(longest);
    handoffMock.mockClear();

    await expect(post(`/api/vault/sessions/by-conversation/${'a'.repeat(101)}/settle`, {}, asRootSession())).rejects.toThrow('RouteNotFound');
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it('a throw becomes 500 with only the message', async () => {
    handoffMock.mockRejectedValue(new Error('The settled record could not be read back.'));
    const res = await post(PATH, {}, asRootSession());
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: 'The settled record could not be read back.' });
  });
});
