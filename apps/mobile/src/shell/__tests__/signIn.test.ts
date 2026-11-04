import { sha256 } from '@noble/hashes/sha2.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ request: vi.fn() }));
const browser = vi.hoisted(() => ({ open: vi.fn(async () => undefined), close: vi.fn(async () => undefined) }));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  CapacitorHttp: http,
}));
vi.mock('@capacitor/browser', () => ({ Browser: browser }));

import { OverdeckKeysWeb } from '../../native/keys-web';
import { ACCOUNT_BASE_URL, NATIVE_REDIRECT } from '../config';
import { beginSignIn, completeSignIn, PKCE_KEY, PKCE_MAX_AGE_MS, startSignIn } from '../signIn';
import { readAccount, setKeysPlugin } from '../store';

const IDENTITY = { clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9', pushPublicKeyHex: 'cd'.repeat(32) };

const base64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pending(): { state: string; verifier: string } {
  return JSON.parse(localStorage.getItem(PKCE_KEY) ?? 'null') as { state: string; verifier: string };
}

beforeEach(() => {
  localStorage.clear();
  http.request.mockReset();
  browser.open.mockClear();
  browser.close.mockClear();
  setKeysPlugin(new OverdeckKeysWeb());
});

describe('beginSignIn', () => {
  it('builds the /auth/start URL with every PKCE parameter', () => {
    const url = new URL(beginSignIn(IDENTITY, 'android'));
    expect(`${url.origin}${url.pathname}`).toBe(`${ACCOUNT_BASE_URL}/auth/start`);
    const params = url.searchParams;
    const { state, verifier } = pending();
    expect(params.get('redirect_uri')).toBe('ai.overdeck.app:/oauth/callback');
    expect(params.get('state')).toBe(state);
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('platform')).toBe('android-arm64');
    expect(params.get('environment_id')).toBe(IDENTITY.clientId);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const challenge = params.get('code_challenge');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(base64url(sha256(new TextEncoder().encode(verifier))));
  });

  it('opens the start URL in the system browser with the ios-arm64 platform', async () => {
    await startSignIn(IDENTITY, 'ios');
    const [{ url }] = browser.open.mock.calls[0] as unknown as [{ url: string }];
    expect(new URL(url).searchParams.get('platform')).toBe('ios-arm64');
  });
});

describe('completeSignIn', () => {
  it('refuses a callback whose state does not match', async () => {
    beginSignIn(IDENTITY, 'android');
    await expect(completeSignIn(`${NATIVE_REDIRECT}?code=odc_x&state=${'0'.repeat(32)}`)).rejects.toThrow(
      'This sign-in did not start on this phone, or it expired. Sign in again.',
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  it('refuses a callback after the 10-minute window', async () => {
    const now = Date.now();
    beginSignIn(IDENTITY, 'android', now);
    const { state } = pending();
    await expect(completeSignIn(`${NATIVE_REDIRECT}?code=odc_x&state=${state}`, now + PKCE_MAX_AGE_MS + 1)).rejects.toThrow(
      'expired',
    );
  });

  it('surfaces the error description of an access_denied callback', async () => {
    beginSignIn(IDENTITY, 'android');
    const { state } = pending();
    const url = `${NATIVE_REDIRECT}?error=access_denied&error_description=${encodeURIComponent('You declined the sign-in.')}&state=${state}`;
    await expect(completeSignIn(url)).rejects.toThrow('You declined the sign-in.');
    expect(localStorage.getItem(PKCE_KEY)).toBeNull();
  });

  it('posts the exact token form and stores the account secret', async () => {
    beginSignIn(IDENTITY, 'android');
    const { state, verifier } = pending();
    http.request.mockResolvedValue({
      status: 200,
      headers: {},
      url: '',
      data: { access_token: 'odd_token', token_type: 'Bearer', device_id: 'dev-1', label: 'Pixel 9' },
    });

    const account = await completeSignIn(`${NATIVE_REDIRECT}?code=odc_abc&state=${state}`);

    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      url: `${ACCOUNT_BASE_URL}/oauth/token`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'odc_abc',
        code_verifier: verifier,
        redirect_uri: 'ai.overdeck.app:/oauth/callback',
      }).toString(),
    });
    expect(account).toEqual({ token: 'odd_token', deviceId: 'dev-1', label: 'Pixel 9' });
    expect(await readAccount()).toEqual(account);
    expect(localStorage.getItem(PKCE_KEY)).toBeNull();
    expect(browser.close).toHaveBeenCalled();
  });

  it('reports a refused exchange with its HTTP status and stores nothing', async () => {
    beginSignIn(IDENTITY, 'android');
    const { state } = pending();
    http.request.mockResolvedValue({ status: 400, headers: {}, url: '', data: '{"error":"invalid_grant"}' });
    await expect(completeSignIn(`${NATIVE_REDIRECT}?code=odc_abc&state=${state}`)).rejects.toThrow('HTTP 400');
    expect(await readAccount()).toBeNull();
  });
});
