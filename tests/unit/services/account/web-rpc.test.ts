import { describe, expect, it } from 'vitest';
import { signOutDeviceToken, verifyDeviceToken } from '../../../../services/account/src/devices.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import type { GitHubIdentity } from '../../../../services/account/src/github.ts';
import { addGrant, revokeGrant } from '../../../../services/account/src/grants.ts';
import { AUTH_CODE_TTL_MS, redeemWebCode } from '../../../../services/account/src/pkce.ts';
import { githubMock } from './helpers/github-mock.ts';
import { call, dbOf, makeDeps, makeEnv, makeRc, TEST_OWNER_GITHUB_ID, type TestDeps } from './helpers/harness.ts';

// RFC 7636 appendix B vector.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const ENV_ID = '11111111-2222-4333-8444-555555555555';
const SHARE_REDIRECT = 'https://share.test/auth/callback';
const OWNER: GitHubIdentity = { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' };

function setup(identity: GitHubIdentity = OWNER) {
  const env = makeEnv({ SHARE_BASE_URL: 'https://share.test' });
  const deps = makeDeps({ now: Date.UTC(2026, 10, 3, 12), fetch: githubMock({ identity }).fetch });
  return { env, deps, rc: makeRc({ env, deps }) };
}

/** Runs the share-redirect PKCE leg (/auth/start → GitHub callback) and returns the issued authorization code. */
async function issueWebCode(env: Env, deps: TestDeps): Promise<string> {
  const q = new URLSearchParams({
    redirect_uri: SHARE_REDIRECT,
    state: 'share-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    platform: 'web',
    environment_id: ENV_ID,
  });
  const start = await call('GET', `/auth/start?${q.toString()}`, { env, deps, ip: '192.0.2.1' });
  expect(start.status).toBe(302);
  const state = /__Host-od_state=([0-9a-f]{64});/.exec(start.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  const cb = await call('GET', `/auth/github/callback?code=gh-code&state=${state}`, { env, deps, ip: '192.0.2.1', headers: { Cookie: `__Host-od_state=${state}` } });
  expect(cb.status).toBe(302);
  const back = new URL(cb.headers.get('Location') ?? '');
  expect(back.origin + back.pathname).toBe(SHARE_REDIRECT);
  return back.searchParams.get('code') ?? '';
}

describe('AccountRpc web sign-in (PAN-4481 account-web-rpc)', () => {
  it('redeemWebCode mints a web device; a second redeem of the same code is invalid_grant', async () => {
    const { env, deps, rc } = setup();
    const code = await issueWebCode(env, deps);

    const result = await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT });
    expect(result).toMatchObject({ ok: true, label: 'Web browser' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.accessToken).toMatch(/^odd_[0-9a-f]{64}$/);
    expect(await verifyDeviceToken(rc, result.accessToken)).toMatchObject({ ok: true, deviceId: result.deviceId, githubId: TEST_OWNER_GITHUB_ID });
    expect(await dbOf(env).prepare('SELECT platform, label, environment_id FROM devices').first()).toEqual({ platform: 'web', label: 'Web browser', environment_id: ENV_ID });

    expect(await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT })).toEqual({ ok: false, error: 'invalid_grant' });
  });

  it('a non-share redirectUri is invalid_request and leaves the code redeemable', async () => {
    const { env, deps, rc } = setup();
    const code = await issueWebCode(env, deps);
    expect(await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: 'http://127.0.0.1:4567/callback' })).toEqual({ ok: false, error: 'invalid_request' });
    expect(await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: 'https://share.test/auth/callback/' })).toEqual({ ok: false, error: 'invalid_request' });
    expect((await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT })).ok).toBe(true);
  });

  it('a wrong verifier is invalid_grant and kills the code', async () => {
    const { env, deps, rc } = setup();
    const code = await issueWebCode(env, deps);
    expect(await redeemWebCode(rc, { code, codeVerifier: 'wrong-wrong-wrong-wrong-wrong-wrong-wrong-wrong-1', redirectUri: SHARE_REDIRECT })).toEqual({ ok: false, error: 'invalid_grant' });
    expect(await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT })).toEqual({ ok: false, error: 'invalid_grant' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n')).toBe(0);
  });

  it('a code older than five minutes is invalid_grant', async () => {
    const { env, deps, rc } = setup();
    const code = await issueWebCode(env, deps);
    deps.clock.advance(AUTH_CODE_TTL_MS + 1_000);
    expect(await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT })).toEqual({ ok: false, error: 'invalid_grant' });
  });

  it('a grant revoked before the redeem is access_denied and mints nothing', async () => {
    const { env, deps, rc } = setup({ githubId: 100, login: 'alice' });
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    const code = await issueWebCode(env, deps);
    await revokeGrant(rc, 100);
    expect(await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT })).toEqual({ ok: false, error: 'access_denied' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n')).toBe(0);
  });

  it('signOutDeviceToken revokes the device as the user; an unknown token is invalid_token', async () => {
    const { env, deps, rc } = setup();
    const code = await issueWebCode(env, deps);
    const minted = await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT });
    if (!minted.ok) throw new Error('redeem failed');

    expect(await signOutDeviceToken(rc, minted.accessToken)).toEqual({ ok: true });
    expect(await verifyDeviceToken(rc, minted.accessToken)).toEqual({ ok: false, error: 'device_revoked' });
    expect(await dbOf(env).prepare('SELECT revoked_by FROM devices').first()).toEqual({ revoked_by: 'user' });
    expect(await signOutDeviceToken(rc, minted.accessToken)).toEqual({ ok: false, error: 'device_revoked' });

    expect(await signOutDeviceToken(rc, `odd_${'0'.repeat(64)}`)).toEqual({ ok: false, error: 'invalid_token' });
    expect(await signOutDeviceToken(rc, 'not-a-token')).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('a device whose grant lapsed still signs out', async () => {
    const { env, deps, rc } = setup({ githubId: 100, login: 'alice' });
    await addGrant(rc, 100, 'alice', { expiresAt: deps.now() + 60_000 }, 'admin-add');
    const code = await issueWebCode(env, deps);
    const minted = await redeemWebCode(rc, { code, codeVerifier: VERIFIER, redirectUri: SHARE_REDIRECT });
    if (!minted.ok) throw new Error('redeem failed');
    deps.clock.advance(120_000);
    expect(await verifyDeviceToken(rc, minted.accessToken)).toEqual({ ok: false, error: 'grant_expired' });

    expect(await signOutDeviceToken(rc, minted.accessToken)).toEqual({ ok: true });
    expect(await verifyDeviceToken(rc, minted.accessToken)).toEqual({ ok: false, error: 'device_revoked' });
  });
});
