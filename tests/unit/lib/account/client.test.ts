import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountClientError,
  DEFAULT_ACCOUNT_BASE_URL,
  exchangeAuthorizationCode,
  getMe,
  platformString,
  pollForToken,
  resolveBaseUrl,
  revokeDevice,
  type DeviceCode,
} from '../../../../src/lib/account/client.js';

const BASE_URL = 'https://account.test';
const TOKEN = `odd_${'a'.repeat(64)}`;

function makeCode(overrides: Partial<DeviceCode> = {}): DeviceCode {
  return {
    deviceCode: 'oddc_code',
    userCode: 'ABCD-EFGH',
    verificationUri: `${BASE_URL}/activate`,
    verificationUriComplete: `${BASE_URL}/activate?user_code=ABCDEFGH`,
    expiresIn: 900,
    interval: 5,
    ...overrides,
  };
}

function errorResponse(error: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error, ...extra }), { status: 400 });
}

function rateLimitedResponse(retryAfterS: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': String(retryAfterS) } });
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'odd_tok', token_type: 'Bearer', device_id: 'device-1', label: 'Linux device' }), { status: 200 });
}

describe('pollForToken (D-5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits one interval before the first poll and resolves only after three intervals of fake time (ac1)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse('authorization_pending'))
      .mockResolvedValueOnce(errorResponse('authorization_pending'))
      .mockResolvedValueOnce(tokenResponse());
    const promise = pollForToken(BASE_URL, makeCode({ interval: 5 }), { fetch: fetchMock });

    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(promise).resolves.toEqual({ ok: true, accessToken: 'odd_tok', deviceId: 'device-1', label: 'Linux device' });
  });

  it('sends no poll before 10 seconds elapse after a slow_down with interval 10 (ac1)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse('slow_down', { interval: 10 }))
      .mockResolvedValueOnce(tokenResponse());
    const promise = pollForToken(BASE_URL, makeCode({ interval: 5 }), { fetch: fetchMock });

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toEqual({ ok: true, accessToken: 'odd_tok', deviceId: 'device-1', label: 'Linux device' });
  });

  it('waits the Retry-After seconds on a 429 before polling again (ac2)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(rateLimitedResponse(7)).mockResolvedValueOnce(tokenResponse());
    const promise = pollForToken(BASE_URL, makeCode({ interval: 5 }), { fetch: fetchMock });

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toEqual({ ok: true, accessToken: 'odd_tok', deviceId: 'device-1', label: 'Linux device' });
  });

  it('maps access_denied and expired_token to their reasons (ac2)', async () => {
    const deniedFetch = vi.fn().mockResolvedValueOnce(errorResponse('access_denied'));
    const deniedPromise = pollForToken(BASE_URL, makeCode({ interval: 5 }), { fetch: deniedFetch });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(deniedPromise).resolves.toEqual({ ok: false, reason: 'access_denied', detail: 'access_denied' });

    const expiredFetch = vi.fn().mockResolvedValueOnce(errorResponse('expired_token'));
    const expiredPromise = pollForToken(BASE_URL, makeCode({ interval: 5 }), { fetch: expiredFetch });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(expiredPromise).resolves.toEqual({ ok: false, reason: 'expired_token', detail: 'expired_token' });
  });

  it('returns the bare error code, not a prefixed message, for an unmapped error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errorResponse('invalid_request'));
    const promise = pollForToken(BASE_URL, makeCode({ interval: 5 }), { fetch: fetchMock });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ ok: false, reason: 'failed', detail: 'invalid_request' });
  });

  it('returns unreachable after three consecutive thrown fetches (ac2)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const promise = pollForToken(BASE_URL, makeCode({ interval: 5 }), { fetch: fetchMock });

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promise).resolves.toEqual({ ok: false, reason: 'unreachable', detail: 'network down' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops with expired_token once expiresIn seconds have elapsed locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse('authorization_pending'));
    const promise = pollForToken(BASE_URL, makeCode({ interval: 5, expiresIn: 8 }), { fetch: fetchMock });

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promise).resolves.toEqual({ ok: false, reason: 'expired_token', detail: 'The sign-in code expired.' });
  });
});

describe('resolveBaseUrl (D-2, ac3)', () => {
  it('prefers the flag, then OVERDECK_ACCOUNT_URL, then the default', () => {
    expect(resolveBaseUrl('https://flag.example', { OVERDECK_ACCOUNT_URL: 'https://env.example' } as NodeJS.ProcessEnv)).toBe('https://flag.example');
    expect(resolveBaseUrl(undefined, { OVERDECK_ACCOUNT_URL: 'https://env.example' } as NodeJS.ProcessEnv)).toBe('https://env.example');
    expect(resolveBaseUrl(undefined, {} as NodeJS.ProcessEnv)).toBe(DEFAULT_ACCOUNT_BASE_URL);
  });

  it('accepts http://127.0.0.1:8787 for local dev', () => {
    expect(resolveBaseUrl('http://127.0.0.1:8787', {} as NodeJS.ProcessEnv)).toBe('http://127.0.0.1:8787');
  });

  it('accepts http://localhost:8787 and http://[::1]:8787 for local dev', () => {
    expect(resolveBaseUrl('http://localhost:8787', {} as NodeJS.ProcessEnv)).toBe('http://localhost:8787');
    expect(resolveBaseUrl('http://[::1]:8787', {} as NodeJS.ProcessEnv)).toBe('http://[::1]:8787');
  });

  it('rejects a non-loopback http URL, a URL with a path, and a URL with a query', () => {
    expect(() => resolveBaseUrl('http://example.com', {} as NodeJS.ProcessEnv)).toThrow(AccountClientError);
    expect(() => resolveBaseUrl('https://account.overdeck.ai/foo', {} as NodeJS.ProcessEnv)).toThrow(AccountClientError);
    expect(() => resolveBaseUrl('https://account.overdeck.ai/?x=1', {} as NodeJS.ProcessEnv)).toThrow(AccountClientError);
  });
});

describe('platformString (D-3, ac4)', () => {
  it('returns null for an unsupported platform', () => {
    expect(platformString('freebsd', 'x64')).toBeNull();
  });

  it('returns the joined string for a supported platform/arch', () => {
    expect(platformString('linux', 'x64')).toBe('linux-x64');
  });
});

describe('getMe (ac4)', () => {
  it('maps a 401 { error: "device_revoked" } to an unauthorized result', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'device_revoked' }), { status: 401 }));
    const result = await getMe(BASE_URL, TOKEN, { fetch: fetchMock });
    expect(result).toEqual({ ok: false, kind: 'unauthorized', error: 'device_revoked' });
  });

  it('returns the parsed Me on 200', async () => {
    const me = { userId: 'u1', githubId: 100, githubLogin: 'octocat', deviceId: 'device-1', access: { status: 'active', expiresAt: null } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(me), { status: 200 }));
    const result = await getMe(BASE_URL, TOKEN, { fetch: fetchMock });
    expect(result).toEqual({ ok: true, me });
  });

  it('surfaces the entitlement from the /v1/me body (PAN-4960 WI-1)', async () => {
    const me = {
      userId: 'u1',
      githubId: 100,
      githubLogin: 'octocat',
      deviceId: 'device-1',
      entitlement: { plan: 'free', storageBytesCap: 5368709120, maxDevices: 3 },
      access: { status: 'active', expiresAt: null },
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(me), { status: 200 }));
    const result = await getMe(BASE_URL, TOKEN, { fetch: fetchMock });
    expect(result.ok && result.me.entitlement.plan).toBe('free');
  });
});

describe('exchangeAuthorizationCode (PAN-4960 WI-2)', () => {
  const input = { code: 'odc_code', codeVerifier: 'v'.repeat(43), redirectUri: 'http://127.0.0.1:3011/oauth/account/callback' };

  it('posts the authorization_code form to /oauth/token and maps a 200', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse());
    const result = await exchangeAuthorizationCode(BASE_URL, input, { fetch: fetchMock });
    expect(result).toEqual({ ok: true, accessToken: 'odd_tok', deviceId: 'device-1', label: 'Linux device' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/oauth/token`);
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: 'authorization_code',
      code: 'odc_code',
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
  });

  it('maps 400 access_denied to access_denied', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errorResponse('access_denied'));
    expect(await exchangeAuthorizationCode(BASE_URL, input, { fetch: fetchMock })).toEqual({ ok: false, reason: 'access_denied', detail: 'access_denied' });
  });

  it('maps 400 invalid_grant to refused with the error code', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errorResponse('invalid_grant'));
    expect(await exchangeAuthorizationCode(BASE_URL, input, { fetch: fetchMock })).toEqual({ ok: false, reason: 'refused', detail: 'invalid_grant' });
  });

  it('maps a 503 and a thrown fetch to unreachable without leaking the code or verifier', async () => {
    const down = await exchangeAuthorizationCode(BASE_URL, input, { fetch: vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })) });
    expect(down).toEqual({ ok: false, reason: 'unreachable', detail: 'HTTP 503' });
    const thrown = await exchangeAuthorizationCode(BASE_URL, input, { fetch: vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')) });
    expect(thrown).toEqual({ ok: false, reason: 'unreachable', detail: 'ECONNREFUSED' });
    for (const result of [down, thrown]) {
      expect(JSON.stringify(result)).not.toContain(input.codeVerifier);
      expect(JSON.stringify(result)).not.toContain(input.code);
    }
  });
});

describe('revokeDevice', () => {
  it('treats 204, 401 and 404 as the device being gone or already invalid', async () => {
    for (const status of [204, 401, 404] as const) {
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status }));
      expect(await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: fetchMock })).toEqual({ ok: true, status });
    }
  });

  it('reports a network failure as not ok', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'));
    expect(await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: fetchMock })).toEqual({ ok: false, detail: 'offline' });
  });
});

describe('describeError via revokeDevice (PAN-5068)', () => {
  it('appends the cause code and message', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET', message: 'socket hang up' } }));
    expect(await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: fetchMock })).toEqual({
      ok: false,
      detail: 'fetch failed (ECONNRESET: socket hang up)',
    });
  });

  it('appends only the code when the cause has no message', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }));
    expect(await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: fetchMock })).toEqual({
      ok: false,
      detail: 'fetch failed (UND_ERR_CONNECT_TIMEOUT)',
    });
  });

  it('appends only the message when the cause has no code', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed', { cause: { message: 'socket hang up' } }));
    expect(await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: fetchMock })).toEqual({
      ok: false,
      detail: 'fetch failed (socket hang up)',
    });
  });

  it('drops an unusable cause (no string code, empty message)', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 42, message: '' } }));
    expect(await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: fetchMock })).toEqual({ ok: false, detail: 'fetch failed' });
  });

  it('leaves the message bare when there is no cause', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: fetchMock })).toEqual({ ok: false, detail: 'fetch failed' });
  });

  it('redacts the authorization code and PKCE verifier in exchangeAuthorizationCode, and the device token in revokeDevice', async () => {
    const input = { code: 'odc_code', codeVerifier: 'v'.repeat(43), redirectUri: 'http://127.0.0.1:3011/oauth/account/callback' };
    const codeFetch = vi.fn().mockRejectedValueOnce(
      new TypeError('fetch failed', {
        cause: { code: 'ECONNRESET', message: `request for ${input.code} with ${input.codeVerifier}` },
      }),
    );
    const codeResult = await exchangeAuthorizationCode(BASE_URL, input, { fetch: codeFetch });
    expect(codeResult.ok).toBe(false);
    expect((codeResult as { detail: string }).detail).toContain('ECONNRESET');
    expect((codeResult as { detail: string }).detail).toContain('[redacted]');
    expect((codeResult as { detail: string }).detail).not.toContain(input.code);
    expect((codeResult as { detail: string }).detail).not.toContain(input.codeVerifier);

    const tokenFetch = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed', { cause: { message: `rejected TOKEN ${TOKEN}` } }));
    const tokenResult = await revokeDevice(BASE_URL, TOKEN, 'device-1', { fetch: tokenFetch });
    expect(tokenResult).toEqual({ ok: false, detail: expect.stringContaining('[redacted]') });
    expect((tokenResult as { detail: string }).detail).not.toContain(TOKEN);
  });
});
