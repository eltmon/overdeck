import { describe, expect, it } from 'vitest';
import { verifyDeviceToken } from '../../../../services/account/src/devices.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import type { GitHubIdentity } from '../../../../services/account/src/github.ts';
import { addGrant, getPendingAttempt, revokeGrant } from '../../../../services/account/src/grants.ts';
import { AUTH_CODE_TTL_MS, validateLoopbackRedirect } from '../../../../services/account/src/pkce.ts';
import { githubMock } from './helpers/github-mock.ts';
import { call, dbOf, form, makeDeps, makeEnv, makeRc, TEST_OWNER_GITHUB_ID, type TestDeps } from './helpers/harness.ts';

// RFC 7636 appendix B vector.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const ENV_ID = '11111111-2222-4333-8444-555555555555';
const REDIRECT = 'http://127.0.0.1:4567/callback';
const OWNER: GitHubIdentity = { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' };

function startQuery(overrides: Record<string, string | null> = {}): string {
  const params: Record<string, string | null> = {
    redirect_uri: REDIRECT,
    state: 'client-state-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    platform: 'linux-x64',
    environment_id: ENV_ID,
    ...overrides,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null) q.set(k, v);
  return `/auth/start?${q.toString()}`;
}

function setup(identity: GitHubIdentity = OWNER) {
  const env = makeEnv();
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12), fetch: githubMock({ identity }).fetch });
  return { env, deps, rc: makeRc({ env, deps }) };
}

/** GET /auth/start then the GitHub callback; returns the redirect back to the loopback client. */
async function signIn(env: Env, deps: TestDeps, overrides: Record<string, string | null> = {}) {
  const start = await call('GET', startQuery(overrides), { env, deps, ip: '192.0.2.1' });
  expect(start.status).toBe(302);
  const state = /__Host-od_state=([0-9a-f]{64});/.exec(start.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  const cb = await call('GET', `/auth/github/callback?code=gh-code&state=${state}`, { env, deps, ip: '192.0.2.1', headers: { Cookie: `__Host-od_state=${state}` } });
  expect(cb.status).toBe(302);
  return new URL(cb.headers.get('Location') ?? '');
}

function exchange(env: Env, deps: TestDeps, fields: Record<string, string>) {
  return call('POST', '/oauth/token', { env, deps, ip: '192.0.2.1', ...form({ grant_type: 'authorization_code', redirect_uri: REDIRECT, code_verifier: VERIFIER, ...fields }) });
}

describe('PKCE loopback flow (PAN-4293 account-pkce-flow)', () => {
  it('happy path: /auth/start → GitHub → loopback redirect with code → token response and a devices row', async () => {
    const { env, deps, rc } = setup();
    const back = await signIn(env, deps);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('client-state-123');
    const code = back.searchParams.get('code') ?? '';
    expect(code).toMatch(/^odc_[0-9a-f]{64}$/);
    expect(back.searchParams.get('error')).toBeNull();

    const res = await exchange(env, deps, { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; token_type: string; device_id: string; label: string };
    expect(body.access_token).toMatch(/^odd_[0-9a-f]{64}$/);
    expect(body.token_type).toBe('Bearer');
    expect(body.label).toBe('Linux device');
    expect(await verifyDeviceToken(rc, body.access_token)).toMatchObject({ ok: true, deviceId: body.device_id, githubId: TEST_OWNER_GITHUB_ID });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM auth_codes').first<number>('n')).toBe(0);
    expect(await dbOf(env).prepare('SELECT platform, environment_id FROM devices').first()).toEqual({ platform: 'linux-x64', environment_id: ENV_ID });
  });

  it('rejects non-loopback redirect_uri values with 400 and no Location; accepts localhost and [::1]', async () => {
    const { env, deps } = setup();
    const bad = ['https://127.0.0.1/cb', 'http://example.com/cb', 'http://127.0.0.2/cb', 'http://user@127.0.0.1/cb', 'http://127.0.0.1/cb#frag', 'http://127.0.0.1/cb#', 'not a url', 'http://[::2]/cb'];
    for (const redirect_uri of bad) {
      const res = await call('GET', startQuery({ redirect_uri }), { env, deps });
      expect(res.status, redirect_uri).toBe(400);
      expect(res.headers.get('Location'), redirect_uri).toBeNull();
      expect(await res.text()).toContain('redirect_uri');
    }
    expect(validateLoopbackRedirect('http://localhost:9999/x')).toBe('http://localhost:9999/x');
    expect(validateLoopbackRedirect('http://[::1]:8080/x')).toBe('http://[::1]:8080/x');
    expect(validateLoopbackRedirect('http://127.0.0.1/cb?keep=1')).toBe('http://127.0.0.1/cb?keep=1');
    expect((await call('GET', startQuery({ redirect_uri: 'http://localhost:9999/x' }), { env, deps })).status).toBe(302);
  });

  it('rejects code_challenge_method=plain, a bad challenge, a missing state, a bad platform and a bad environment_id', async () => {
    const { env, deps } = setup();
    const cases: Array<[Record<string, string | null>, string]> = [
      [{ code_challenge_method: 'plain' }, 'code_challenge_method'],
      [{ code_challenge_method: null }, 'code_challenge_method'],
      [{ code_challenge: 'short' }, 'code_challenge'],
      [{ state: null }, 'state'],
      [{ state: 'x'.repeat(257) }, 'state'],
      [{ platform: 'freebsd-x64' }, 'platform'],
      [{ environment_id: 'nope' }, 'environment_id'],
    ];
    for (const [overrides, param] of cases) {
      const res = await call('GET', startQuery(overrides), { env, deps });
      expect(res.status, param).toBe(400);
      expect(res.headers.get('Location')).toBeNull();
      expect(await res.text()).toContain(param);
    }
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM auth_requests').first<number>('n')).toBe(0);
  });

  it('a wrong verifier is invalid_grant and kills the code; a reused code is invalid_grant', async () => {
    const { env, deps } = setup();
    const code = (await signIn(env, deps)).searchParams.get('code') ?? '';
    const wrong = await exchange(env, deps, { code, code_verifier: 'wrong-wrong-wrong-wrong-wrong-wrong-wrong-wrong-1' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'invalid_grant' });
    const retry = await exchange(env, deps, { code });
    expect(await retry.json()).toEqual({ error: 'invalid_grant' });

    const code2 = (await signIn(env, deps)).searchParams.get('code') ?? '';
    expect((await exchange(env, deps, { code: code2 })).status).toBe(200);
    expect(await (await exchange(env, deps, { code: code2 })).json()).toEqual({ error: 'invalid_grant' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n')).toBe(1);
  });

  it('a 301-second-old code or a different redirect_uri is invalid_grant; a malformed verifier is invalid_request', async () => {
    const { env, deps } = setup();
    const code = (await signIn(env, deps)).searchParams.get('code') ?? '';
    expect(await (await exchange(env, deps, { code, redirect_uri: 'http://127.0.0.1:4567/callback/' })).json()).toEqual({ error: 'invalid_grant' });

    const code2 = (await signIn(env, deps)).searchParams.get('code') ?? '';
    deps.clock.advance(AUTH_CODE_TTL_MS + 1_000);
    expect(await (await exchange(env, deps, { code: code2 })).json()).toEqual({ error: 'invalid_grant' });

    expect(await (await exchange(env, deps, { code: 'odc_x', code_verifier: 'too-short' })).json()).toEqual({ error: 'invalid_request' });
    expect(await (await exchange(env, deps, { code: '' })).json()).toEqual({ error: 'invalid_request' });
    expect(await (await exchange(env, deps, { code: 'odc_unknown' })).json()).toEqual({ error: 'invalid_grant' });
  });

  it('a non-allowlisted identity is redirected with error=access_denied&error_description=invite_only, leaving a pending row and no code', async () => {
    const { env, deps, rc } = setup({ githubId: 4242, login: 'stranger' });
    const back = await signIn(env, deps);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('error_description')).toBe('invite_only');
    expect(back.searchParams.get('state')).toBe('client-state-123');
    expect(back.searchParams.get('code')).toBeNull();
    expect(await getPendingAttempt(rc, 4242)).toMatchObject({ github_login: 'stranger', attempts: 1, last_flow: 'pkce' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM auth_codes').first<number>('n')).toBe(0);
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM users').first<number>('n')).toBe(0);
  });

  it('a grant revoked between callback and exchange yields access_denied and no devices row', async () => {
    const { env, deps, rc } = setup({ githubId: 100, login: 'alice' });
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    const code = (await signIn(env, deps)).searchParams.get('code') ?? '';
    expect(code).toMatch(/^odc_/);
    await revokeGrant(rc, 100);
    const res = await exchange(env, deps, { code });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'access_denied' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n')).toBe(0);
  });

  it('cancelling on GitHub redirects with error_description=github_denied', async () => {
    const { env, deps } = setup();
    const start = await call('GET', startQuery(), { env, deps });
    const state = /__Host-od_state=([0-9a-f]{64});/.exec(start.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
    const cb = await call('GET', `/auth/github/callback?error=access_denied&state=${state}`, { env, deps, headers: { Cookie: `__Host-od_state=${state}` } });
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get('Location') ?? '');
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('error_description')).toBe('github_denied');
    expect(back.searchParams.get('state')).toBe('client-state-123');
  });
});
