import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIceServers,
  TURN_FETCH_TIMEOUT_MS,
  TURN_TTL_SECONDS,
  turnCredentialsUrl,
} from '../../../../services/share/src/turn.ts';

const TURN = { keyId: 'key-123', apiToken: 'secret-api-token' };
const ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  {
    urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
    username: 'user',
    credential: 'cred',
  },
];

interface Recorded {
  url: string;
  init: RequestInit;
}

/** An injected fetch that records each request and answers with `respond()`. */
function fakeFetch(respond: () => Promise<Response>) {
  const calls: Recorded[] = [];
  const fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const respondJson = (body: unknown, status = 201) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('fetchIceServers (PAN-658 share-turn)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a null TURN config is not_configured and makes no request', async () => {
    const { fetch, calls } = fakeFetch(respondJson({ iceServers: ICE_SERVERS }));
    expect(await fetchIceServers(null, { fetch })).toEqual({ ok: false, reason: 'not_configured' });
    expect(calls).toEqual([]);
  });

  it('POSTs the credential API with the bearer token and a 3600 s TTL, and returns the parsed servers', async () => {
    const { fetch, calls } = fakeFetch(respondJson({ iceServers: ICE_SERVERS, extra: true }));
    expect(await fetchIceServers(TURN, { fetch })).toEqual({ ok: true, iceServers: ICE_SERVERS });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers');
    expect(calls[0]?.url).toBe(turnCredentialsUrl('key-123'));
    expect(calls[0]?.init.method).toBe('POST');
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer secret-api-token');
    expect(calls[0]?.init.body).toBe('{"ttl":3600}');
    expect(TURN_TTL_SECONDS).toBe(3600);
  });

  it('drops unknown keys from each ICE server entry', async () => {
    const { fetch } = fakeFetch(respondJson({ iceServers: [{ urls: ['stun:a'], junk: 1 }] }));
    expect(await fetchIceServers(TURN, { fetch })).toEqual({ ok: true, iceServers: [{ urls: ['stun:a'] }] });
  });

  it('a non-201 status is http_error', async () => {
    for (const status of [200, 401, 500]) {
      const { fetch } = fakeFetch(respondJson({ iceServers: ICE_SERVERS }, status));
      expect(await fetchIceServers(TURN, { fetch })).toEqual({ ok: false, reason: 'http_error' });
    }
  });

  it('a malformed body or a non-STUN/TURN url is bad_response', async () => {
    const bodies: unknown[] = [
      { iceServers: [{ urls: ['http://x'] }] },
      { iceServers: [{ urls: ['stun:a', 'https://evil'] }] },
      { iceServers: [{ urls: [] }] },
      { iceServers: [{ urls: 'stun:a' }] },
      { iceServers: [{ urls: ['turn:a'], username: 7 }] },
      { iceServers: [] },
      { iceServers: 'nope' },
      {},
      null,
    ];
    for (const body of bodies) {
      const { fetch } = fakeFetch(respondJson(body));
      expect(await fetchIceServers(TURN, { fetch }), JSON.stringify(body)).toEqual({ ok: false, reason: 'bad_response' });
    }
    const { fetch } = fakeFetch(() => Promise.resolve(new Response('not json', { status: 201 })));
    expect(await fetchIceServers(TURN, { fetch })).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('a rejected fetch is network_error', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('connection refused')));
    expect(await fetchIceServers(TURN, { fetch })).toEqual({ ok: false, reason: 'network_error' });
  });

  it('a fetch that never resolves is network_error after 5000 ms, and the request was aborted', async () => {
    const { fetch, calls } = fakeFetch(() => new Promise<Response>(() => {}));
    let settled = false;
    const pending = fetchIceServers(TURN, { fetch }).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(TURN_FETCH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, reason: 'network_error' });
    expect(TURN_FETCH_TIMEOUT_MS).toBe(5000);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer secret-api-token');
    expect(calls[0]?.init.body).toBe('{"ttl":3600}');
  });
});
