import { describe, expect, it } from 'vitest';
import type { Deps, Env } from '../../../../services/share/src/env.ts';
import { parseConfig } from '../../../../services/share/src/env.ts';
import { guardBody, handle, MAX_BODY_BYTES } from '../../../../services/share/src/routes.ts';

const TEST_BASE_URL = 'https://share.test';

const deps: Deps = {
  now: () => 1_700_000_000_000,
  fetch: () => Promise.reject(new Error('unexpected outbound fetch')),
  randomBytes: (n) => new Uint8Array(n),
};

/** Fully configured Env. Pass `undefined` for a key to simulate an unset var or secret. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ROOMS: {} as DurableObjectNamespace,
    ACCOUNT: { verifyDevice: () => Promise.reject(new Error('unexpected verifyDevice')) },
    PUBLIC_BASE_URL: TEST_BASE_URL,
    TURN_KEY_ID: 'turn-key-id',
    TURN_KEY_API_TOKEN: 'turn-api-token',
    ...overrides,
  };
}

const seen: Response[] = [];
async function call(method: string, path: string, env: Env = makeEnv(), init: RequestInit = {}): Promise<Response> {
  const res = await handle(new Request(`${TEST_BASE_URL}${path}`, { method, ...init }), env, deps);
  seen.push(res);
  return res;
}

describe('share service route table (PAN-658 share-scaffold)', () => {
  it('GET /healthz reports configured=false and turn=false when PUBLIC_BASE_URL and TURN secrets are unset', async () => {
    const env = makeEnv({ PUBLIC_BASE_URL: undefined, TURN_KEY_ID: undefined, TURN_KEY_API_TOKEN: undefined });
    const res = await call('GET', '/healthz', env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: false, turn: false });
  });

  it('GET /healthz reports configured=true once PUBLIC_BASE_URL is set', async () => {
    const res = await call('GET', '/healthz', makeEnv({ TURN_KEY_ID: undefined }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: false });
  });

  it('GET /healthz reports turn=true only when both TURN secrets are set', async () => {
    const res = await call('GET', '/healthz');
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: true });

    const blank = await call('GET', '/healthz', makeEnv({ TURN_KEY_API_TOKEN: '  ' }));
    expect(await blank.json()).toEqual({ ok: true, configured: true, turn: false });
  });

  it('an unknown path returns 404 not_found', async () => {
    const res = await call('GET', '/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('a wrong method on a known path returns 405 with an Allow header', async () => {
    const res = await call('POST', '/healthz');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('GET /healthz stays 200 when PUBLIC_BASE_URL is missing (it is exempt from the config gate)', async () => {
    const res = await call('GET', '/healthz', makeEnv({ PUBLIC_BASE_URL: '' }));
    expect(res.status).toBe(200);
  });

  it('parseConfig requires only PUBLIC_BASE_URL, strips trailing slashes and leaves TURN optional', () => {
    expect(parseConfig(makeEnv({ PUBLIC_BASE_URL: undefined }))).toEqual({ ok: false, missing: ['PUBLIC_BASE_URL'] });
    expect(parseConfig(makeEnv({ PUBLIC_BASE_URL: 'https://share.test//', TURN_KEY_ID: undefined }))).toEqual({
      ok: true,
      config: { publicBaseUrl: 'https://share.test', turn: null },
    });
    expect(parseConfig(makeEnv())).toEqual({
      ok: true,
      config: { publicBaseUrl: TEST_BASE_URL, turn: { keyId: 'turn-key-id', apiToken: 'turn-api-token' } },
    });
  });

  it('the body guard refuses more than 16 KiB with 413 and passes smaller bodies through intact', async () => {
    const big = new Request(`${TEST_BASE_URL}/x`, { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES + 1) });
    const refused = await guardBody(big);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      seen.push(refused.response);
      expect(refused.response.status).toBe(413);
      expect(await refused.response.json()).toEqual({ error: 'payload_too_large', maxBytes: MAX_BODY_BYTES });
    }

    const small = await guardBody(new Request(`${TEST_BASE_URL}/x`, { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES) }));
    expect(small.ok).toBe(true);
    if (small.ok) expect((await small.req.text()).length).toBe(MAX_BODY_BYTES);
  });

  it('every response carries Cache-Control: no-store and X-Content-Type-Options: nosniff', () => {
    expect(seen.length).toBeGreaterThanOrEqual(8);
    for (const res of seen) {
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
    }
  });
});
