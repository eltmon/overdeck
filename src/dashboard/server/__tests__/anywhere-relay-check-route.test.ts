/**
 * PAN-5242 WI-8: POST /api/anywhere/relay-check answers whether this machine can gather a TURN
 * relay candidate right now, through the directory client's ice-servers request and
 * probeRelayCandidate. No route-scopes.ts row: only the internal token, the root session or an
 * admin-scoped credential may call it.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const directoryState = vi.hoisted(() => ({ current: null as { state: 'off' | 'connecting' | 'online' | 'refused' } | null }));
vi.mock(import('../../../lib/remote-access/anywhere-status.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  readDirectoryStatus: () => directoryState.current,
}));

const rtcState = vi.hoisted(() => ({ current: null as { iceServers: (relay: boolean) => Promise<unknown> } | null }));
vi.mock(import('../services/directory-rtc.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  currentDirectoryRtc: () => rtcState.current,
}));

const probe = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock(import('../../../lib/anywhere/channel/relay-probe.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  probeRelayCandidate: (...args: unknown[]) => probe.fn(...args),
}));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { IceServersRefusedError } = await import('../services/directory-rtc.js');
const { anywhereRouteLayer } = await import('../routes/anywhere.js');

const INTERNAL_TOKEN = 'anywhere-relay-check-internal-token-0123';

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function post(headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/anywhere/relay-check', { method: 'POST', headers }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(anywhereRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  directoryState.current = { state: 'online' };
  rtcState.current = { iceServers: vi.fn(async () => []) };
  probe.fn.mockReset();
  probe.fn.mockResolvedValue({ state: 'ok', relayCandidates: 1, turnUrl: 'turns:turn.example:443', elapsedMs: 10 });
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('POST /api/anywhere/relay-check (PAN-5242)', () => {
  it('returns skipped without calling the probe when the directory is not online', async () => {
    directoryState.current = { state: 'off' };
    const res = await post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ state: 'skipped', reason: 'directory-offline' });
    expect(probe.fn).not.toHaveBeenCalled();
  });

  it('returns skipped without calling the probe when there is no directory RTC', async () => {
    rtcState.current = null;
    const res = await post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.json).toMatchObject({ state: 'skipped', reason: 'directory-offline' });
    expect(probe.fn).not.toHaveBeenCalled();
  });

  it('returns refused when the directory refuses the ice-servers request', async () => {
    rtcState.current = { iceServers: vi.fn(async () => { throw new IceServersRefusedError('the relay needs the relay plan', 'relay_not_allowed'); }) };
    const res = await post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.json).toEqual({ state: 'refused', detail: 'the relay needs the relay plan' });
    expect(probe.fn).not.toHaveBeenCalled();
  });

  it('returns unanswered for any other ice-servers rejection', async () => {
    rtcState.current = { iceServers: vi.fn(async () => { throw new Error('the directory did not answer the ICE server request'); }) };
    const res = await post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.json).toEqual({ state: 'unanswered', detail: 'the directory did not answer the ICE server request' });
    expect(probe.fn).not.toHaveBeenCalled();
  });

  it('passes the probe result through unchanged for ok and failed results', async () => {
    const ok = await post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(ok.json).toEqual({ state: 'ok', relayCandidates: 1, turnUrl: 'turns:turn.example:443', elapsedMs: 10 });

    probe.fn.mockResolvedValue({ state: 'failed', relayCandidates: 0, turnUrl: null, elapsedMs: 0, detail: 'the relay list has no TURN server' });
    const failed = await post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(failed.json).toEqual({ state: 'failed', relayCandidates: 0, turnUrl: null, elapsedMs: 0, detail: 'the relay list has no TURN server' });
  });

  it('runs the probe once for two concurrent requests', async () => {
    let resolveIceServers: (servers: unknown[]) => void = () => undefined;
    rtcState.current = { iceServers: vi.fn(() => new Promise((resolve) => { resolveIceServers = resolve; })) };
    const first = post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    const second = post({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    resolveIceServers([]);
    const [a, b] = await Promise.all([first, second]);
    expect(a.json).toEqual(b.json);
    expect(probe.fn).toHaveBeenCalledTimes(1);
  });

  it('refuses a scoped token with only read:state, without calling the probe', async () => {
    const { token } = await createAccessToken({ name: 'reader', scopes: ['read:state'], kind: 'token' });
    const res = await post(bearer(token));
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'insufficient_scope', missingScope: 'admin' });
    expect(probe.fn).not.toHaveBeenCalled();
  });
});
