/**
 * PAN-5342: the safe-shutdown routes. The drain service, the preview and the
 * origin check are mocked; no test starts a real drain.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownSnapshot } from '@overdeck/contracts';

const mocks = vi.hoisted(() => ({
  startShutdown: vi.fn(),
  cancelShutdown: vi.fn(),
  forceStopSession: vi.fn(),
  forceAll: vi.fn(),
  getShutdownSnapshot: vi.fn(),
  getShutdownPreview: vi.fn(),
  validateOrigin: vi.fn(),
}));

vi.mock('../../services/shutdown/drain-service.js', () => ({
  startShutdown: mocks.startShutdown,
  cancelShutdown: mocks.cancelShutdown,
  forceStopSession: mocks.forceStopSession,
  forceAll: mocks.forceAll,
  getShutdownSnapshot: mocks.getShutdownSnapshot,
}));
vi.mock('../../services/shutdown/preview.js', () => ({
  getShutdownPreview: mocks.getShutdownPreview,
}));
vi.mock('../origin-validation.js', () => ({
  validateOrigin: mocks.validateOrigin,
}));

import { shutdownRouteLayer } from '../shutdown.js';
import { requiredScopeFor } from '../../route-scopes.js';

const SNAPSHOT: ShutdownSnapshot = {
  phase: 'draining',
  startedAt: '2026-11-15T10:00:00.000Z',
  deadlineAt: '2026-11-15T10:02:00.000Z',
  overdue: false,
  reboot: false,
  force: 'never',
  pending: [],
  writers: [],
  stoppedCount: 0,
  warnings: [],
};

async function call(method: 'GET' | 'POST', path: string, body?: unknown | string) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(shutdownRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateOrigin.mockReturnValue({ ok: true });
  mocks.getShutdownSnapshot.mockReturnValue(null);
  mocks.startShutdown.mockResolvedValue({ started: true, snapshot: SNAPSHOT });
  mocks.cancelShutdown.mockResolvedValue(true);
  mocks.forceStopSession.mockResolvedValue(true);
  mocks.forceAll.mockResolvedValue(true);
});

describe('GET /api/shutdown', () => {
  it('answers { shutdown: null } when no drain runs', async () => {
    const res = await call('GET', '/api/shutdown');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ shutdown: null });
  });

  it('answers the live snapshot while a drain runs', async () => {
    mocks.getShutdownSnapshot.mockReturnValue(SNAPSHOT);
    const res = await call('GET', '/api/shutdown');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ shutdown: SNAPSHOT });
  });
});

describe('GET /api/shutdown/preview', () => {
  it('answers the preview object, restartInProgress included', async () => {
    const preview = {
      agents: 3,
      conversations: 2,
      workingNow: 1,
      writers: [{ kind: 'auto-merge', label: 'Merging PAN-1' }],
      restartInProgress: { pid: 4242 },
    };
    mocks.getShutdownPreview.mockResolvedValue(preview);
    const res = await call('GET', '/api/shutdown/preview');
    expect(res.status).toBe(200);
    expect(res.json).toEqual(preview);
  });

  it('answers restartInProgress: null when no reload holds the lock', async () => {
    mocks.getShutdownPreview.mockResolvedValue({
      agents: 0, conversations: 0, workingNow: 0, writers: [], restartInProgress: null,
    });
    const res = await call('GET', '/api/shutdown/preview');
    expect(res.status).toBe(200);
    expect(res.json.restartInProgress).toBeNull();
  });
});

describe('POST /api/shutdown', () => {
  it('starts a drain with the defaults on an empty body and answers 202', async () => {
    const res = await call('POST', '/api/shutdown');
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ shutdown: SNAPSHOT });
    expect(mocks.startShutdown).toHaveBeenCalledWith({ deadlineSeconds: 120, reboot: false, force: false });
  });

  it('passes deadlineSeconds, reboot and force through', async () => {
    const res = await call('POST', '/api/shutdown', { deadlineSeconds: 600, reboot: true, force: true });
    expect(res.status).toBe(202);
    expect(mocks.startShutdown).toHaveBeenCalledWith({ deadlineSeconds: 600, reboot: true, force: true });
  });

  it('accepts the bounds 10 and 3600', async () => {
    expect((await call('POST', '/api/shutdown', { deadlineSeconds: 10 })).status).toBe(202);
    expect((await call('POST', '/api/shutdown', { deadlineSeconds: 3600 })).status).toBe(202);
  });

  it.each([
    ['deadlineSeconds below 10', { deadlineSeconds: 5 }],
    ['deadlineSeconds above 3600', { deadlineSeconds: 3601 }],
    ['deadlineSeconds as a string', { deadlineSeconds: '120' }],
    ['reboot as a string', { reboot: 'yes' }],
    ['force as a number', { force: 1 }],
    ['an array body', [1, 2]],
  ])('answers 400 for %s without starting a drain', async (_label, body) => {
    const res = await call('POST', '/api/shutdown', body);
    expect(res.status).toBe(400);
    expect(typeof res.json.error).toBe('string');
    expect(mocks.startShutdown).not.toHaveBeenCalled();
  });

  it('answers 400 for malformed JSON', async () => {
    const res = await call('POST', '/api/shutdown', '{not json');
    expect(res.status).toBe(400);
    expect(mocks.startShutdown).not.toHaveBeenCalled();
  });

  it('answers 409 already-running when a drain runs', async () => {
    mocks.startShutdown.mockResolvedValue({ started: false, reason: 'already-running' });
    const res = await call('POST', '/api/shutdown', {});
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('already-running');
    expect(typeof res.json.error).toBe('string');
  });

  it('answers 409 restart-in-progress with the D-11 text', async () => {
    mocks.startShutdown.mockResolvedValue({ started: false, reason: 'restart-in-progress', pid: 4242 });
    const res = await call('POST', '/api/shutdown', {});
    expect(res.status).toBe(409);
    expect(res.json).toEqual({
      error: 'A pan reload or pan restart is in progress (pid 4242). Wait for it to finish, then shut down.',
      code: 'restart-in-progress',
    });
  });
});

describe('POST /api/shutdown/cancel', () => {
  it('answers 200 when the drain is cancelled', async () => {
    const res = await call('POST', '/api/shutdown/cancel');
    expect(res.status).toBe(200);
    expect(mocks.cancelShutdown).toHaveBeenCalledTimes(1);
  });

  it('answers 409 complete once the drain has completed', async () => {
    mocks.cancelShutdown.mockResolvedValue(false);
    const res = await call('POST', '/api/shutdown/cancel');
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('complete');
  });
});

describe('POST /api/shutdown/force-stop', () => {
  it('force-stops the named pending session and answers 200', async () => {
    const res = await call('POST', '/api/shutdown/force-stop', { id: 'agent-pan-1' });
    expect(res.status).toBe(200);
    expect(mocks.forceStopSession).toHaveBeenCalledWith('agent-pan-1');
  });

  it('answers 404 when the session is not pending', async () => {
    mocks.forceStopSession.mockResolvedValue(false);
    const res = await call('POST', '/api/shutdown/force-stop', { id: 'agent-pan-9' });
    expect(res.status).toBe(404);
  });

  it.each([
    ['no body', undefined],
    ['a missing id', {}],
    ['a numeric id', { id: 7 }],
    ['an empty id', { id: '' }],
  ])('answers 400 for %s', async (_label, body) => {
    const res = await call('POST', '/api/shutdown/force-stop', body);
    expect(res.status).toBe(400);
    expect(mocks.forceStopSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/shutdown/force-all', () => {
  it('answers 200 while a drain runs', async () => {
    const res = await call('POST', '/api/shutdown/force-all');
    expect(res.status).toBe(200);
    expect(mocks.forceAll).toHaveBeenCalledTimes(1);
  });

  it('answers 409 not-running when no drain runs', async () => {
    mocks.forceAll.mockResolvedValue(false);
    const res = await call('POST', '/api/shutdown/force-all');
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('not-running');
  });
});

describe('origin check', () => {
  it.each([
    ['/api/shutdown', { deadlineSeconds: 120 }],
    ['/api/shutdown/cancel', undefined],
    ['/api/shutdown/force-stop', { id: 'agent-pan-1' }],
    ['/api/shutdown/force-all', undefined],
  ])('POST %s answers 403 for an untrusted origin and calls nothing', async (path, body) => {
    mocks.validateOrigin.mockReturnValue({ ok: false, error: 'Forbidden origin' });
    const res = await call('POST', path, body);
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Forbidden origin' });
    expect(mocks.startShutdown).not.toHaveBeenCalled();
    expect(mocks.cancelShutdown).not.toHaveBeenCalled();
    expect(mocks.forceStopSession).not.toHaveBeenCalled();
    expect(mocks.forceAll).not.toHaveBeenCalled();
  });
});

describe('route scopes', () => {
  it('lets read:state read the snapshot and the preview, and needs admin for every POST', () => {
    expect(requiredScopeFor('GET', '/api/shutdown')).toBe('read:state');
    expect(requiredScopeFor('GET', '/api/shutdown/preview')).toBe('read:state');
    for (const path of ['/api/shutdown', '/api/shutdown/cancel', '/api/shutdown/force-stop', '/api/shutdown/force-all']) {
      expect(requiredScopeFor('POST', path), path).toBe('admin');
    }
  });
});
