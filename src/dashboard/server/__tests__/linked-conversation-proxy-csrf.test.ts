/**
 * PAN-4650 review: a cross-site browser write must not reach a linked
 * conversation, and Pull here / reclaim / open-in-editor refuse it too. A
 * loopback browser request passes the remote gate without a credential, so
 * these checks are the only defence against another web page.
 *
 * The proxy cases run the real middleware: a refused write answers 403; an
 * admitted one goes on to the link lookup, which answers 503 `no-link` here.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { _resetTrustedOriginsForTests } = await import('../routes/origin-validation.js');
const { crossSiteWriteRefusal, linkedConversationProxyLayer } = await import('../linked-conversation-proxy.js');
const { conversationPullRouteLayer } = await import('../routes/conversation-pull.js');
const { linkedOpenRouteLayer } = await import('../routes/linked-open.js');

const INTERNAL_TOKEN = 'linked-proxy-internal-token-0123456789';
const SESSION_TOKEN = 'linked-proxy-session-token-0123456789';
/** The dashboard session cookie a browser on this machine may still send. */
const SESSION = { cookie: `overdeck_session=${SESSION_TOKEN}` };
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN', 'OVERDECK_TRUSTED_ORIGINS', 'OVERDECK_TRAEFIK_ENABLED', 'DASHBOARD_URL'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

/** A stand-in route so the global proxy middleware has a router to wrap. */
const fallthrough = HttpRouter.add('POST', '/api/conversations/:name/message', Effect.succeed(HttpServerResponse.text('local route', { status: 299 })));

async function send(layer: Layer.Layer<never, never, never>, path: string, headers: Record<string, string>, method = 'POST') {
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1:3011${path}`, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: '{"message":"hello"}' }),
  })).modify({ remoteAddress: Option.some('127.0.0.1') }); // a browser on this machine is a loopback peer
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(layer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: raw.status, json };
}

const proxy = Layer.mergeAll(fallthrough, linkedConversationProxyLayer) as Layer.Layer<never, never, never>;
const MESSAGE = '/api/conversations/@desk/20261101-4426/message';

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-4650-csrf-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _resetInternalTokenCacheForTests();
  _resetTrustedOriginsForTests();
  await rm(home, { recursive: true, force: true });
});

describe('linked conversation proxy: cross-site writes', () => {
  it('refuses a text/plain POST from a foreign Origin with 403 and never forwards it', async () => {
    const answer = await send(proxy, MESSAGE, { origin: 'https://evil.example', 'content-type': 'text/plain' });
    expect(answer).toMatchObject({ status: 403, json: { error: 'Invalid origin' } });
  });

  it('refuses a POST with no Origin and no header-borne credential', async () => {
    const answer = await send(proxy, MESSAGE, { 'content-type': 'application/json' });
    expect(answer).toMatchObject({ status: 403, json: { error: 'Missing origin' } });
  });

  it('forwards the same POST with the internal token (pan tell @…) and with the dashboard Origin', async () => {
    const cli = await send(proxy, MESSAGE, { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN, 'content-type': 'application/json' });
    expect(cli).toMatchObject({ status: 503, json: { code: 'no-link' } });
    const browser = await send(proxy, MESSAGE, { origin: 'http://localhost:3011', 'content-type': 'application/json' });
    expect(browser).toMatchObject({ status: 503, json: { code: 'no-link' } });
  });

  it('lets reads through without an Origin', async () => {
    expect(crossSiteWriteRefusal({}, 'GET')).toBeNull();
    expect(crossSiteWriteRefusal({ origin: 'https://evil.example' }, 'HEAD')).toBeNull();
    expect(crossSiteWriteRefusal({ origin: 'https://evil.example' }, 'DELETE')).not.toBeNull();
  });
});

describe('Pull here, reclaim and open-in-editor: cross-site writes', () => {
  const routes = Layer.mergeAll(conversationPullRouteLayer, linkedOpenRouteLayer) as Layer.Layer<never, never, never>;

  it.each([
    '/api/linked-conversations/pull',
    '/api/conversations/conv-x/reclaim',
    '/api/linked-conversations/open-in-editor',
  ])('%s refuses a cross-site write even with the session cookie', async (path) => {
    const csrf = { 'x-overdeck-csrf-token': dashboardCsrfToken() };
    const foreign = await send(routes, path, { ...SESSION, ...csrf, origin: 'https://evil.example', 'content-type': 'application/json' });
    expect(foreign).toMatchObject({ status: 403, json: { error: 'Invalid origin' } });
    const noToken = await send(routes, path, { ...SESSION, origin: 'http://localhost:3011', 'content-type': 'application/json' });
    expect(noToken).toMatchObject({ status: 403, json: { error: 'Invalid CSRF token' } });
    const simple = await send(routes, path, { ...SESSION, ...csrf, origin: 'https://evil.example', 'content-type': 'text/plain' });
    expect(simple.status).toBe(400);
    const noCredential = await send(routes, path, { origin: 'https://evil.example', 'content-type': 'application/json' });
    expect(noCredential.status).toBe(401);
  });

  it('admits the CLI with the internal token (the pull then fails on the unknown conversation)', async () => {
    const answer = await send(routes, '/api/linked-conversations/pull', { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN, 'content-type': 'application/json' });
    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ error: 'conversation is required' });
  });
});
