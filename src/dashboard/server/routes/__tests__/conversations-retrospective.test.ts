/**
 * Route tests for POST /api/conversations/retrospective (PAN-3841).
 *
 * Mocks the conversation write door (handleConversationCreate) and the
 * heavyweight routes/conversations.js module body (it starts a model
 * backfill at load). The retrospective handler itself runs for real, so the
 * window validation and kickoff rendering are exercised end to end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../../http-helpers.js';
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_CSRF_HEADER,
  _resetDashboardSessionTokenForTests,
  dashboardCsrfToken,
  dashboardSessionCookieHeader,
} from '../dashboard-auth.js';
import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';

const handleConversationCreate = vi.fn(
  async () => jsonResponse({ name: 'conv-x', id: 1 }, { status: 201 }),
);

vi.mock('../../../../lib/overdeck/conversation-runtime.js', () => ({
  handleConversationCreate: (...args: unknown[]) => handleConversationCreate(...args),
}));

vi.mock('../conversations.js', () => ({
  conversationReadDependencies: {},
}));

function decodeTextResponse(response: { body: unknown }): string {
  const payload = response.body as { body: Uint8Array } | null;
  return payload?.body ? new TextDecoder().decode(payload.body) : '';
}

async function postRetrospective(
  body: unknown,
  options: { origin?: string; cookie?: string; csrf?: string; internal?: string } = {},
) {
  const { conversationsRetrospectiveRouteLayer } = await import('../conversations-retrospective.js');
  const origin = options.origin ?? 'http://localhost:3011';
  const headers: Record<string, string> = {
    Origin: origin,
    'Content-Type': 'application/json',
  };
  if (options.cookie) headers['Cookie'] = options.cookie;
  if (options.csrf) headers[DASHBOARD_CSRF_HEADER] = options.csrf;
  if (options.internal) headers['x-overdeck-internal-token'] = options.internal;
  const request = HttpServerRequest.fromWeb(
    new Request('http://localhost/api/conversations/retrospective', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationsRetrospectiveRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
}

function sessionCookie(): string {
  return dashboardSessionCookieHeader().split(';')[0] ?? `${DASHBOARD_SESSION_COOKIE}=`;
}

describe('POST /api/conversations/retrospective', () => {
  beforeEach(() => {
    handleConversationCreate.mockClear();
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-dashboard-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  it('creates the conversation for a valid window and forwards no projectKey', async () => {
    const response = await postRetrospective({ window: '7d', model: 'm' }, {
      cookie: sessionCookie(),
      csrf: dashboardCsrfToken(),
    });
    expect(response.status).toBe(201);
    expect(handleConversationCreate).toHaveBeenCalledTimes(1);
    const arg = handleConversationCreate.mock.calls[0][0] as Record<string, unknown>;
    expect((arg.message as string).startsWith('Pipeline retrospective: last 7 days')).toBe(true);
    expect(arg.model).toBe('m');
    expect(arg).not.toHaveProperty('projectKey');
    expect(arg).not.toHaveProperty('issueId');
  });

  it('returns 400 for an invalid window and never touches the write door', async () => {
    const response = await postRetrospective({ window: 'bad' }, {
      cookie: sessionCookie(),
      csrf: dashboardCsrfToken(),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(decodeTextResponse(response))).toEqual({ error: 'Invalid window' });
    expect(handleConversationCreate).not.toHaveBeenCalled();
  });

  it('returns 403 for a foreign Origin even with a valid session', async () => {
    const response = await postRetrospective(
      { window: '7d' },
      { origin: 'https://evil.example.com', cookie: sessionCookie(), csrf: dashboardCsrfToken() },
    );
    expect(response.status).toBe(403);
    expect(handleConversationCreate).not.toHaveBeenCalled();
  });

  it('rejects a trusted Origin without credentials (no session, no CSRF, no internal token)', async () => {
    const response = await postRetrospective({ window: '7d' }, { origin: 'http://localhost:3011' });
    expect(response.status).toBe(401);
    expect(JSON.parse(decodeTextResponse(response))).toEqual({ error: 'unauthorized' });
    expect(handleConversationCreate).not.toHaveBeenCalled();
  });

  it('rejects a trusted Origin with session cookie but no CSRF header', async () => {
    const response = await postRetrospective(
      { window: '7d' },
      { origin: 'http://localhost:3011', cookie: sessionCookie() },
    );
    expect(response.status).toBe(403);
    expect(JSON.parse(decodeTextResponse(response))).toEqual({ error: 'Invalid CSRF token' });
    expect(handleConversationCreate).not.toHaveBeenCalled();
  });

  it('accepts a trusted Origin with the internal token alone (no CSRF)', async () => {
    const response = await postRetrospective(
      { window: '24h' },
      { origin: 'http://localhost:3011', internal: 'test-dashboard-token' },
    );
    expect(response.status).toBe(201);
    expect(handleConversationCreate).toHaveBeenCalledTimes(1);
  });
});
