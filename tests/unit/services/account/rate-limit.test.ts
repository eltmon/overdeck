import { describe, expect, it } from 'vitest';
import { hit, LIMITS, type Bucket } from '../../../../services/account/src/rate-limit.ts';
import { call, dbOf, makeDeps, makeEnv, makeRc } from './helpers/harness.ts';

const BUCKETS = Object.keys(LIMITS) as Bucket[];

function setup(ip = '198.51.100.9') {
  const env = makeEnv();
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12) });
  const rc = makeRc({ env, deps, clientIp: ip });
  return { env, deps, rc, db: dbOf(env) };
}

describe('rate limiting (PAN-4293 account-rate-limit, D-12)', () => {
  it.each(BUCKETS)('%s: the limit passes, the next request is refused with the seconds to window end', async (bucket) => {
    const { rc, deps } = setup();
    const { limit, windowMs } = LIMITS[bucket];
    for (let i = 0; i < limit; i++) expect(await hit(rc, bucket)).toEqual({ ok: true });
    deps.clock.advance(1_500);
    expect(await hit(rc, bucket)).toEqual({ ok: false, retryAfterS: Math.ceil((windowMs - 1_500) / 1000) });
    expect(await hit(rc, bucket)).toEqual({ ok: false, retryAfterS: Math.ceil((windowMs - 1_500) / 1000) });
  });

  it('a new window resets the count', async () => {
    const { rc, deps } = setup();
    for (let i = 0; i < LIMITS['device-code'].limit; i++) await hit(rc, 'device-code');
    expect((await hit(rc, 'device-code')).ok).toBe(false);
    deps.clock.advance(LIMITS['device-code'].windowMs);
    expect(await hit(rc, 'device-code')).toEqual({ ok: true });
    expect((await hit(rc, 'device-code')).ok).toBe(true);
  });

  it('two IPs and two buckets count separately', async () => {
    const { env, deps } = setup();
    const a = makeRc({ env, deps, clientIp: '198.51.100.1' });
    const b = makeRc({ env, deps, clientIp: '198.51.100.2' });
    for (let i = 0; i < LIMITS['admin-login'].limit; i++) await hit(a, 'admin-login');
    expect((await hit(a, 'admin-login')).ok).toBe(false);
    expect((await hit(b, 'admin-login')).ok).toBe(true);
    expect((await hit(a, 'auth-start')).ok).toBe(true);
  });

  it('stores a hash of the client IP, never the raw IP', async () => {
    const { rc, db } = setup('203.0.113.77');
    await hit(rc, 'token');
    const rows = (await db.prepare('SELECT client_hash FROM rate_limits').all<{ client_hash: string }>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.77');
  });

  it('an unknown client IP is counted under one shared key', async () => {
    const { env, deps } = setup();
    const noIp = makeRc({ env, deps, clientIp: 'unknown' });
    const empty = makeRc({ env, deps, clientIp: '' });
    await hit(noIp, 'token');
    await hit(empty, 'token');
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM rate_limits').first<number>('n')).toBe(1);
  });

  it('through handle(): the 21st GET /auth/start from one IP is a 429 HTML page with Retry-After', async () => {
    const { env, deps } = setup();
    const ip = '192.0.2.10';
    for (let i = 0; i < 20; i++) expect((await call('GET', '/auth/start', { env, deps, ip })).status).toBe(501);
    const res = await call('GET', '/auth/start', { env, deps, ip });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('Too many requests');
    expect((await call('GET', '/auth/start', { env, deps, ip: '192.0.2.11' })).status).toBe(501);
  });

  it('through handle(): the 121st POST /oauth/token is 429 JSON rate_limited', async () => {
    const { env, deps } = setup();
    const ip = '192.0.2.20';
    const opts = { env, deps, ip, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=password' };
    for (let i = 0; i < 120; i++) expect((await call('POST', '/oauth/token', opts)).status).toBe(400);
    const res = await call('POST', '/oauth/token', opts);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });
});
