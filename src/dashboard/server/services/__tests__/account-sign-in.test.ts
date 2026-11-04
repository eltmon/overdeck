/**
 * PAN-4960 WI-5: the pending PKCE sign-in. Clock, fetch, account.json and the environment id are
 * injected, so no test touches the disk, the network or real time.
 */
import { describe, expect, it, vi } from 'vitest';

import { s256 } from '../../../../lib/account/pkce.js';
import type { AccountRecord } from '../../../../lib/account/store.js';
import {
  AccountSignInService,
  INVITE_ONLY_MESSAGE,
  NOT_LOOPBACK_BIND_MESSAGE,
  PENDING_SIGN_IN_TTL_MS,
  SIGN_IN_EXPIRED_MESSAGE,
  type AccountSignInDeps,
} from '../account-sign-in.js';

const BASE_URL = 'https://account.test';
const TOKEN = `odd_${'a'.repeat(64)}`;
const REDIRECT = 'http://127.0.0.1:3999/oauth/account/callback';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const ME = {
  userId: 'u1',
  githubId: 100,
  githubLogin: 'octocat',
  deviceId: 'device-1',
  entitlement: { plan: 'free', storageBytesCap: 5368709120, maxDevices: 3 },
  access: { status: 'active', expiresAt: null },
};

function harness(over: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } & Partial<Omit<AccountSignInDeps, 'env' | 'fetch'>> = {}) {
  let now = 1_000_000;
  const writes: AccountRecord[] = [];
  const onSignedIn = vi.fn(async () => undefined);
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return json({ access_token: TOKEN, token_type: 'Bearer', device_id: 'device-1', label: 'Linux device' });
    if (url.endsWith('/v1/me')) return json(ME);
    return json({ error: 'not_found' }, 404);
  });
  const deps: AccountSignInDeps = {
    env: { OVERDECK_ACCOUNT_URL: BASE_URL, API_PORT: '3999', ...over.env },
    now: () => now,
    fetch: (over.fetch ?? fetchMock) as unknown as typeof fetch,
    readAccount: async () => null,
    writeAccount: async (record) => {
      writes.push(record);
    },
    environmentId: async () => 'env-1',
    platform: () => 'linux-x64',
    onSignedIn,
    ...Object.fromEntries(Object.entries(over).filter(([key]) => key !== 'env' && key !== 'fetch')),
  };
  return {
    service: new AccountSignInService(deps),
    fetchMock,
    writes,
    onSignedIn,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function begin(h: ReturnType<typeof harness>): Promise<{ url: URL; state: string }> {
  const result = await h.service.begin();
  if (!result.ok) throw new Error(result.error);
  const url = new URL(result.authorizeUrl);
  return { url, state: url.searchParams.get('state')! };
}

function callback(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe('AccountSignInService.begin (PAN-4960 WI-5)', () => {
  it('builds the authorize URL for 127.0.0.1:<API_PORT> with the S256 of a verifier it never reveals (ac1)', async () => {
    const h = harness();
    const result = await h.service.begin();
    if (!result.ok) throw new Error(result.error);
    const url = new URL(result.authorizeUrl);
    const state = url.searchParams.get('state')!;
    expect(url.origin + url.pathname).toBe(`${BASE_URL}/auth/start`);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('platform')).toBe('linux-x64');
    expect(url.searchParams.get('environment_id')).toBe('env-1');

    await h.service.complete(callback({ state, code: 'odc_code' }));
    const tokenCall = h.fetchMock.mock.calls.find(([input]) => String(input).endsWith('/oauth/token'))!;
    const verifier = new URLSearchParams((tokenCall[1] as RequestInit).body as string).get('code_verifier')!;
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toBe(s256(verifier));
    expect(url.toString()).not.toContain(verifier);
    expect(JSON.stringify(result)).not.toContain(verifier);
  });

  it('never shows the verifier in a pending view, and hides the URL from viewers who cannot sign in (ac1)', async () => {
    const h = harness();
    const { url } = await begin(h);
    expect(h.service.view(true)).toEqual({ state: 'pending', authorizeUrl: url.toString(), message: null });
    expect(h.service.view(false)).toEqual({ state: 'pending', authorizeUrl: null, message: null });
    expect(JSON.stringify(h.service.view(true))).not.toContain('code_verifier');
  });

  it('refuses a dashboard bound to a LAN address with 409, and accepts an unset HOST (ac5)', async () => {
    expect(await harness({ env: { HOST: '192.168.1.5' } }).service.begin()).toEqual({ ok: false, status: 409, error: NOT_LOOPBACK_BIND_MESSAGE });
    expect((await harness().service.begin()).ok).toBe(true);
    expect((await harness({ env: { HOST: '127.0.0.1' } }).service.begin()).ok).toBe(true);
  });

  it('answers 400 for an invalid account service URL and 409 for an unreadable account.json or unsupported platform', async () => {
    const bad = await harness({ env: { OVERDECK_ACCOUNT_URL: 'http://example.com' } }).service.begin();
    expect(bad).toMatchObject({ ok: false, status: 400, error: 'Invalid account service URL: http://example.com' });
    const unreadable = await harness({
      readAccount: async () => {
        throw new Error('Cannot read /h/account.json: unexpected shape. Delete it to sign out locally.');
      },
    }).service.begin();
    expect(unreadable).toEqual({ ok: false, status: 409, error: 'Cannot read /h/account.json: unexpected shape. Delete it to sign out locally.' });
    const platform = await harness({ platform: () => null }).service.begin();
    expect(platform).toMatchObject({ ok: false, status: 409 });
  });
});

describe('AccountSignInService.complete (PAN-4960 WI-5)', () => {
  it('answers expired for a wrong state and still completes the real one (ac2)', async () => {
    const h = harness();
    const { state } = await begin(h);
    expect(await h.service.complete(callback({ state: 'f'.repeat(32), code: 'odc_code' }))).toEqual({ kind: 'expired' });
    expect(h.service.view(true).state).toBe('pending');
    expect(await h.service.complete(callback({ state, code: 'odc_code' }))).toEqual({ kind: 'succeeded', githubLogin: 'octocat' });
  });

  it('answers expired for a replayed state (ac2)', async () => {
    const h = harness();
    const { state } = await begin(h);
    await h.service.complete(callback({ state, code: 'odc_code' }));
    expect(await h.service.complete(callback({ state, code: 'odc_code' }))).toEqual({ kind: 'expired' });
    expect(h.writes).toHaveLength(1);
  });

  it('answers expired for the first state once a second begin() replaced the slot (ac2)', async () => {
    const h = harness();
    const first = await begin(h);
    const second = await begin(h);
    expect(await h.service.complete(callback({ state: first.state, code: 'odc_code' }))).toEqual({ kind: 'expired' });
    expect((await h.service.complete(callback({ state: second.state, code: 'odc_code' }))).kind).toBe('succeeded');
  });

  it('answers expired at createdAt + 600 000 ms and reports the expiry in the view (ac2)', async () => {
    const h = harness();
    const { state } = await begin(h);
    h.advance(PENDING_SIGN_IN_TTL_MS);
    expect(await h.service.complete(callback({ state, code: 'odc_code' }))).toEqual({ kind: 'expired' });
    expect(h.service.view(true)).toEqual({ state: 'failed', authorizeUrl: null, message: SIGN_IN_EXPIRED_MESSAGE });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('reports an expired pending slot through view() without a callback', async () => {
    const h = harness();
    await begin(h);
    h.advance(PENDING_SIGN_IN_TTL_MS - 1);
    expect(h.service.view(true).state).toBe('pending');
    h.advance(1);
    expect(h.service.view(true)).toEqual({ state: 'failed', authorizeUrl: null, message: SIGN_IN_EXPIRED_MESSAGE });
  });

  it('exchanges with the stored verifier and exact redirect URI, writes account.json and calls onSignedIn once (ac3)', async () => {
    const h = harness();
    const { state } = await begin(h);
    expect(await h.service.complete(callback({ state, code: 'odc_code' }))).toEqual({ kind: 'succeeded', githubLogin: 'octocat' });
    const [tokenUrl, tokenInit] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe(`${BASE_URL}/oauth/token`);
    const form = new URLSearchParams(tokenInit.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('odc_code');
    expect(form.get('redirect_uri')).toBe(REDIRECT);
    expect(h.writes).toEqual([
      {
        v: 1,
        baseUrl: BASE_URL,
        accessToken: TOKEN,
        deviceId: 'device-1',
        label: 'Linux device',
        githubLogin: 'octocat',
        githubId: 100,
        signedInAt: new Date(1_000_000).toISOString(),
      },
    ]);
    expect(h.onSignedIn).toHaveBeenCalledTimes(1);
    expect(h.service.view(true)).toEqual({ state: 'succeeded', authorizeUrl: null, message: 'Signed in as octocat.' });
  });

  it('still writes account.json with a null login when /v1/me fails (ac3)', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/oauth/token') ? json({ access_token: TOKEN, device_id: 'device-1', label: 'L' }) : json({ error: 'boom' }, 503),
    );
    const h = harness({ fetch: fetchMock as unknown as typeof fetch });
    const { state } = await begin(h);
    expect(await h.service.complete(callback({ state, code: 'odc_code' }))).toEqual({ kind: 'succeeded', githubLogin: null });
    expect(h.writes[0]).toMatchObject({ githubLogin: null, githubId: null, accessToken: TOKEN });
    expect(h.service.view(true).message).toBe('Signed in.');
  });

  it('maps invite_only to the invite message without a token request (ac4)', async () => {
    const h = harness();
    const { state } = await begin(h);
    const result = await h.service.complete(callback({ state, error: 'access_denied', error_description: 'invite_only' }));
    expect(result).toEqual({ kind: 'failed', message: INVITE_ONLY_MESSAGE });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.service.view(true)).toEqual({ state: 'failed', authorizeUrl: null, message: INVITE_ONLY_MESSAGE });
  });

  it('maps the other callback and exchange failures to the D-16 messages', async () => {
    const cases: Array<[Record<string, string>, typeof fetch | undefined, string]> = [
      [{ error: 'access_denied', error_description: 'account_deleting' }, undefined, 'This overdeck.ai account is being deleted.'],
      [{ error: 'access_denied', error_description: 'github_denied' }, undefined, 'Sign-in was cancelled on GitHub.'],
      [{ error: 'server_error' }, undefined, 'overdeck.ai did not complete the sign-in (server_error).'],
      [{}, undefined, 'overdeck.ai sent no sign-in code.'],
      [{ code: 'odc_code' }, (async () => json({ error: 'access_denied' }, 400)) as unknown as typeof fetch, INVITE_ONLY_MESSAGE],
      [{ code: 'odc_code' }, (async () => json({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch, 'overdeck.ai refused the sign-in code (invalid_grant).'],
      [{ code: 'odc_code' }, (async () => json({}, 503)) as unknown as typeof fetch, `Cannot reach ${BASE_URL}: HTTP 503`],
    ];
    for (const [params, fetchImpl, message] of cases) {
      const h = harness(fetchImpl ? { fetch: fetchImpl } : {});
      const { state } = await begin(h);
      expect(await h.service.complete(callback({ state, ...params }))).toEqual({ kind: 'failed', message });
      expect(h.writes).toEqual([]);
    }
  });

  it('reports a failed account.json write', async () => {
    const h = harness({
      writeAccount: async () => {
        throw new Error('EACCES');
      },
    });
    const { state } = await begin(h);
    expect(await h.service.complete(callback({ state, code: 'odc_code' }))).toEqual({
      kind: 'failed',
      message: 'Signed in, but could not save account.json: EACCES',
    });
    expect(h.onSignedIn).not.toHaveBeenCalled();
  });

  it('answers expired with no sign-in pending', async () => {
    expect(await harness().service.complete(callback({ state: 'x', code: 'y' }))).toEqual({ kind: 'expired' });
  });
});
