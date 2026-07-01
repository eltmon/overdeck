import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import {
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardSessionCookieHeader,
} from '../dashboard-auth.js';
import { uatStackActionRouteLayer } from '../workspaces/uat-stack-actions.js';

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: childProcess.spawn,
  };
});

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
}));

interface RouteResult {
  status: number;
  body: unknown;
}

async function requestUatStackRoute(path: string, init: RequestInit = {}): Promise<RouteResult> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(uatStackActionRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

function sessionCookie(): string {
  return dashboardSessionCookieHeader().split(';')[0] ?? `${DASHBOARD_SESSION_COOKIE}=`;
}

describe('UAT stack action route auth', () => {
  beforeEach(() => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-dashboard-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    childProcess.spawn.mockReset();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  it('rejects stack log reads without dashboard auth', async () => {
    await expect(requestUatStackRoute('/api/workspaces/PAN-1894/stack-logs')).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('rejects stack mutations without dashboard auth before spawning docker', async () => {
    await expect(requestUatStackRoute('/api/workspaces/PAN-1894/stack/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('rejects cookie-authenticated stack mutations without a CSRF token before spawning docker', async () => {
    await expect(requestUatStackRoute('/api/workspaces/PAN-1894/stack/restart', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: '{}',
    })).resolves.toEqual({
      status: 403,
      body: { error: 'Invalid CSRF token' },
    });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('rejects cookie-authenticated reap mutations without a CSRF token before teardown', async () => {
    await expect(requestUatStackRoute('/api/workspaces/PAN-1894/reap', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: '{}',
    })).resolves.toEqual({
      status: 403,
      body: { error: 'Invalid CSRF token' },
    });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});
