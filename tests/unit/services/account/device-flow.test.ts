import { describe, expect, it } from 'vitest';
import { DEVICE_GRANT_TTL_MS, DEVICE_CONNECTED_MESSAGE, INVALID_CODE_MESSAGE, TOO_MANY_WRONG_CODES_MESSAGE } from '../../../../services/account/src/device-flow.ts';
import { verifyDeviceToken } from '../../../../services/account/src/devices.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import type { GitHubIdentity } from '../../../../services/account/src/github.ts';
import { addGrant, getPendingAttempt } from '../../../../services/account/src/grants.ts';
import { githubMock } from './helpers/github-mock.ts';
import { call, dbOf, form, makeDeps, makeEnv, makeRc, TEST_BASE_URL, TEST_OWNER_GITHUB_ID, type TestDeps } from './helpers/harness.ts';

const ENV_ID = '11111111-2222-4333-8444-555555555555';
const OWNER: GitHubIdentity = { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' };
const CLI_IP = '192.0.2.50';
const BROWSER_IP = '198.51.100.50';

interface CodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

function setup(identity: GitHubIdentity = OWNER) {
  const env = makeEnv();
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12), fetch: githubMock({ identity }).fetch });
  return { env, deps, rc: makeRc({ env, deps }) };
}

async function issue(env: Env, deps: TestDeps, platform = 'linux-x64'): Promise<CodeResponse> {
  const res = await call('POST', '/oauth/device/code', { env, deps, ip: CLI_IP, ...form({ platform, environment_id: ENV_ID }) });
  expect(res.status).toBe(200);
  return (await res.json()) as CodeResponse;
}

function poll(env: Env, deps: TestDeps, deviceCode: string) {
  return call('POST', '/oauth/token', { env, deps, ip: CLI_IP, ...form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode }) });
}

async function approveInBrowser(env: Env, deps: TestDeps, userCode: string) {
  const submit = await call('POST', '/activate', { env, deps, ip: BROWSER_IP, ...form({ user_code: userCode }) });
  expect(submit.status).toBe(200);
  const confirm = await call('POST', '/activate/confirm', { env, deps, ip: BROWSER_IP, ...form({ user_code: userCode }) });
  expect(confirm.status).toBe(302);
  expect(confirm.headers.get('Location')).toContain('https://github.com/login/oauth/authorize');
  const state = /__Host-od_state=([0-9a-f]{64});/.exec(confirm.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  return call('GET', `/auth/github/callback?code=gh&state=${state}`, { env, deps, ip: BROWSER_IP, headers: { Cookie: `__Host-od_state=${state}` } });
}

describe('device flow (PAN-4293 account-device-flow, RFC 8628)', () => {
  it('POST /oauth/device/code returns the RFC fields with an XXXX-XXXX user code and stores only hashes', async () => {
    const { env, deps } = setup();
    const code = await issue(env, deps);
    expect(code.device_code).toMatch(/^oddc_[0-9a-f]{64}$/);
    expect(code.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(code.verification_uri).toBe(`${TEST_BASE_URL}/activate`);
    expect(code.verification_uri_complete).toBe(`${TEST_BASE_URL}/activate?user_code=${code.user_code.replace('-', '')}`);
    expect(code.expires_in).toBe(900);
    expect(code.interval).toBe(5);
    const row = await dbOf(env).prepare('SELECT * FROM device_grants').first<Record<string, unknown>>();
    expect(row).toMatchObject({ status: 'pending', platform: 'linux-x64', environment_id: ENV_ID, interval_s: 5, user_id: null, last_polled_at: null });
    expect(JSON.stringify(row)).not.toContain(code.device_code);
    expect(JSON.stringify(row)).not.toContain(code.user_code.replace('-', ''));

    const bad = await call('POST', '/oauth/device/code', { env, deps, ...form({ platform: 'plan9-x64', environment_id: ENV_ID }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_request' });
  });

  it('a pending poll is authorization_pending; polling faster than the interval is slow_down with interval 10', async () => {
    const { env, deps } = setup();
    const code = await issue(env, deps);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'authorization_pending' });
    deps.clock.advance(1_000);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'slow_down', interval: 10 });
    deps.clock.advance(6_000);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'slow_down', interval: 15 });
    deps.clock.advance(15_000);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'authorization_pending' });
    expect(await (await poll(env, deps, 'oddc_unknown')).json()).toEqual({ error: 'invalid_grant' });
    expect(await (await poll(env, deps, '')).json()).toEqual({ error: 'invalid_request' });
  });

  it('approval via /activate → /activate/confirm → GitHub callback makes the next poll return a token', async () => {
    const { env, deps, rc } = setup();
    const code = await issue(env, deps, 'win32-arm64');
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'authorization_pending' });

    const page = await call('GET', `/activate?user_code=${code.user_code.replace('-', '').toLowerCase()}`, { env, deps });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`value="${code.user_code}"`);

    const submit = await call('POST', '/activate', { env, deps, ip: BROWSER_IP, ...form({ user_code: code.user_code }) });
    expect(await submit.text()).toContain('Connect a <strong>Windows device</strong>');

    const done = await approveInBrowser(env, deps, code.user_code);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain(DEVICE_CONNECTED_MESSAGE);

    deps.clock.advance(5_000);
    const tokenRes = await poll(env, deps, code.device_code);
    expect(tokenRes.status).toBe(200);
    const body = (await tokenRes.json()) as { access_token: string; label: string; device_id: string };
    expect(body.access_token).toMatch(/^odd_[0-9a-f]{64}$/);
    expect(body.label).toBe('Windows device');
    expect(await verifyDeviceToken(rc, body.access_token)).toMatchObject({ ok: true, deviceId: body.device_id });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM device_grants').first<number>('n')).toBe(0);
    deps.clock.advance(5_000);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'invalid_grant' });
  });

  it('lowercase and dashed or spaced codes are accepted', async () => {
    const { env, deps } = setup();
    const code = await issue(env, deps);
    const letters = code.user_code.replace('-', '');
    for (const variant of [letters.toLowerCase(), `${letters.slice(0, 4)} ${letters.slice(4)}`.toLowerCase(), `${letters.slice(0, 2)}-${letters.slice(2)}`]) {
      const res = await call('POST', '/activate', { env, deps, ip: BROWSER_IP, ...form({ user_code: variant }) });
      expect(res.status, variant).toBe(200);
      expect(await res.text()).toContain('Linux device');
    }
  });

  it('a non-allowlisted account gets the invite-only page, a pending row, and the CLI gets access_denied', async () => {
    const { env, deps, rc } = setup({ githubId: 9001, login: 'stranger' });
    const code = await issue(env, deps);
    const done = await approveInBrowser(env, deps, code.user_code);
    expect(done.status).toBe(403);
    expect(await done.text()).toContain('Overdeck accounts are invite-only right now.');
    expect(await getPendingAttempt(rc, 9001)).toMatchObject({ github_login: 'stranger', last_flow: 'device' });
    deps.clock.advance(5_000);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'access_denied' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM device_grants').first<number>('n')).toBe(0);
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n')).toBe(0);
  });

  it('a grant approved for an account whose allowlist entry was removed before the poll is access_denied', async () => {
    const { env, deps, rc } = setup({ githubId: 100, login: 'alice' });
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    const code = await issue(env, deps);
    expect((await approveInBrowser(env, deps, code.user_code)).status).toBe(200);
    await dbOf(env).prepare('DELETE FROM grants WHERE github_id = 100').run();
    deps.clock.advance(5_000);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'access_denied' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n')).toBe(0);
  });

  it('a 15-minute-old grant is expired_token on poll and an expired code at /activate', async () => {
    const { env, deps } = setup();
    const code = await issue(env, deps);
    deps.clock.advance(DEVICE_GRANT_TTL_MS);
    const res = await call('POST', '/activate', { env, deps, ip: BROWSER_IP, ...form({ user_code: code.user_code }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(INVALID_CODE_MESSAGE);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'expired_token' });
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM device_grants').first<number>('n')).toBe(0);
  });

  it('cancelling on GitHub marks the grant denied', async () => {
    const { env, deps } = setup();
    const code = await issue(env, deps);
    await call('POST', '/activate', { env, deps, ip: BROWSER_IP, ...form({ user_code: code.user_code }) });
    const confirm = await call('POST', '/activate/confirm', { env, deps, ip: BROWSER_IP, ...form({ user_code: code.user_code }) });
    const state = /__Host-od_state=([0-9a-f]{64});/.exec(confirm.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
    const cb = await call('GET', `/auth/github/callback?error=access_denied&state=${state}`, { env, deps, headers: { Cookie: `__Host-od_state=${state}` } });
    expect(cb.status).toBe(400);
    expect(await cb.text()).toContain('cancelled');
    deps.clock.advance(5_000);
    expect(await (await poll(env, deps, code.device_code)).json()).toEqual({ error: 'access_denied' });
  });

  it('the 11th wrong code from one IP in 15 minutes is 429, and a new window accepts again', async () => {
    const { env, deps } = setup();
    const wrong = () => call('POST', '/activate', { env, deps, ip: BROWSER_IP, ...form({ user_code: 'BBBB-BBBB' }) });
    for (let i = 0; i < 10; i++) {
      const res = await wrong();
      expect(res.status, `attempt ${i + 1}`).toBe(400);
      expect(await res.text()).toContain(INVALID_CODE_MESSAGE);
    }
    const limited = await wrong();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('900');
    expect(await limited.text()).toContain(TOO_MANY_WRONG_CODES_MESSAGE);
    expect((await call('POST', '/activate', { env, deps, ip: '198.51.100.51', ...form({ user_code: 'BBBB-BBBB' }) })).status).toBe(400);

    deps.clock.advance(15 * 60_000);
    expect((await wrong()).status).toBe(400);
    const code = await issue(env, deps);
    expect((await call('POST', '/activate', { env, deps, ip: BROWSER_IP, ...form({ user_code: code.user_code }) })).status).toBe(200);
  });
});
