/**
 * PAN-2351 W9: end-to-end acceptance for scoped access tokens, with the real
 * remote request gate, the real `/events/stream` route (and its event store,
 * under a temporary OVERDECK_HOME) and the real `/api/access-tokens` routes.
 * `POST /api/agents/:id/tell` is a stub route: only the gate's decision on it
 * matters here.
 *
 * A `read:events` token from a LAN peer streams SSE, is refused on tell and on
 * the terminal upgrade, and is 401 after revocation: at once through the
 * DELETE route (its open stream ends), and within 5 s through a direct
 * registry write (the cross-process path `pan token revoke` takes with the
 * dashboard down).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Fiber, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(import('../../../lib/activity-logger.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  emitActivityEntry: vi.fn(),
}));

const LAN_PEER = '192.0.2.44';
const INTERNAL_TOKEN = 'acceptance-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
const originalEventsToken = process.env.OVERDECK_EVENTS_TOKEN;
const home = mkdtempSync(join(tmpdir(), 'pan-2351-acceptance-'));
process.env.OVERDECK_HOME = home;

const {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  createAccessToken,
  startAccessTokenRefresh,
} = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { closeOverdeckDatabase } = await import('../../../lib/overdeck/infra.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { _deviceConnectionCountForTests } = await import('../device-connections.js');
const { initEventStore } = await import('../event-store.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { WS_TERMINAL_SCOPE } = await import('../route-scopes.js');
const { accessTokensRouteLayer } = await import('../routes/access-tokens.js');
const { eventsRouteLayer } = await import('../routes/events.js');
const { authorizeDashboardUpgrade } = await import('../ws-auth.js');

const tellStub = HttpRouter.add('POST', '/api/agents/:id/tell', Effect.succeed(HttpServerResponse.text('told')));
const app = Layer.mergeAll(remoteRequestGateLayer, eventsRouteLayer, tellStub, accessTokensRouteLayer);
// Any type filter that excludes agent.output_received keeps the output-interest service out of the test.
const STREAM_PATH = '/events/stream?types=issue.created';
const REGISTRY = join(home, 'access-tokens.json');

interface SentResponse {
  status: number;
  contentType: string | undefined;
  json: unknown;
  stream: Stream.Stream<Uint8Array, unknown> | null;
}

async function send(method: string, path: string, headers: Record<string, string>): Promise<SentResponse> {
  const request = HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method, headers }))
    .modify({ remoteAddress: Option.some(LAN_PEER) });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as {
    status: number;
    headers: Record<string, string>;
    body: { _tag: string; body?: Uint8Array; stream?: Stream.Stream<Uint8Array, unknown>; contentType?: string };
  };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  return {
    status: raw.status,
    contentType: raw.headers['content-type'] ?? raw.body.contentType,
    json: text && raw.body.contentType?.includes('json') ? JSON.parse(text) : text,
    stream: raw.body._tag === 'Stream' && raw.body.stream ? raw.body.stream : null,
  };
}

/** Open an SSE response and keep draining it; interrupting the fiber runs the route's cleanup. */
async function openStream(headers: Record<string, string>) {
  const response = await send('GET', STREAM_PATH, headers);
  expect(response.status).toBe(200);
  expect(response.contentType).toContain('text/event-stream');
  return Effect.runFork(Stream.runDrain(response.stream!));
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await initEventStore();
});

afterAll(() => {
  closeOverdeckDatabase();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  delete process.env.OVERDECK_EVENTS_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  rmSync(REGISTRY, { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalEventsToken === undefined) delete process.env.OVERDECK_EVENTS_TOKEN;
  else process.env.OVERDECK_EVENTS_TOKEN = originalEventsToken;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('scoped token acceptance (PAN-2351)', () => {
  it('streams SSE for a read:events token, refuses tell and the terminal, and ends the stream on revocation', async () => {
    const { token, record } = await createAccessToken({ name: 'sidecar', scopes: ['read:events'], kind: 'token' });
    const headers = bearer(token);

    const fiber = await openStream(headers);
    await vi.waitFor(() => expect(_deviceConnectionCountForTests(record.id)).toBe(1));

    const tell = await send('POST', '/api/agents/x/tell', headers);
    expect(tell.status).toBe(403);
    expect(tell.json).toEqual({ error: 'insufficient_scope', missingScope: 'tell' });
    expect(authorizeDashboardUpgrade(headers, 'GET', WS_TERMINAL_SCOPE)).toMatchObject({ ok: false, status: 403 });

    const revoked = await send('DELETE', `/api/access-tokens/${record.id}`, {
      [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
      'content-type': 'application/json',
    });
    expect(revoked.status).toBe(200);
    expect(revoked.json).toMatchObject({ ok: true, closedConnections: 1 });

    await Effect.runPromise(Fiber.join(fiber));
    expect(_deviceConnectionCountForTests(record.id)).toBe(0);
    expect((await send('GET', STREAM_PATH, headers)).status).toBe(401);
  });

  it('streams for both a read:events token and OVERDECK_EVENTS_TOKEN when that variable is set', async () => {
    process.env.OVERDECK_EVENTS_TOKEN = 'events-secret';
    const { token } = await createAccessToken({ name: 'sidecar', scopes: ['read:events'], kind: 'token' });
    const narrow = await createAccessToken({ name: 'teller', scopes: ['tell'], kind: 'token' });

    for (const headers of [bearer(token), bearer('events-secret')]) {
      const fiber = await openStream(headers);
      await Effect.runPromise(Fiber.interrupt(fiber));
    }
    expect((await send('GET', STREAM_PATH, bearer(narrow.token))).status).toBe(403);
  });
});

describe('cross-process revocation (PAN-2351 FR-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a token revoked straight in the registry file within 5 s', async () => {
    const { token, record } = await createAccessToken({ name: 'sidecar', scopes: ['read:events'], kind: 'token' });
    expect((await send('GET', '/events/version', bearer(token))).status).toBe(200);
    // Let the lastUsedAt write land first, so it cannot overwrite the revocation below.
    await _settleAccessTokenWritesForTests();
    startAccessTokenRefresh();

    const file = JSON.parse(readFileSync(REGISTRY, 'utf8')) as { tokens: Array<{ id: string; revokedAt?: string }> };
    file.tokens.find((entry) => entry.id === record.id)!.revokedAt = new Date().toISOString();
    writeFileSync(REGISTRY, JSON.stringify(file), { mode: 0o600 });
    expect((await send('GET', '/events/version', bearer(token))).status).toBe(200);

    await vi.advanceTimersByTimeAsync(5_000);
    // The gate refuses the revoked token before the route opens a stream.
    await vi.waitFor(async () => expect((await send('GET', STREAM_PATH, bearer(token))).status).toBe(401));
  });
});
