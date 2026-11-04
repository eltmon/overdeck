import { describe, expect, it } from 'vitest';
import { authorizeUrl, createPkcePair, createSignInState, s256 } from '../../../../src/lib/account/pkce.js';

describe('pkce (PAN-4960 WI-2)', () => {
  it('produces the RFC 7636 Appendix B S256 challenge', () => {
    expect(s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('creates a 43-char base64url verifier whose challenge is its S256', () => {
    const pair = createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.challenge).toBe(s256(pair.verifier));
    expect(createPkcePair().verifier).not.toBe(pair.verifier);
  });

  it('creates a 32-char hex state', () => {
    expect(createSignInState()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('builds the /auth/start URL with all six params and S256', () => {
    const url = new URL(
      authorizeUrl('https://account.test', {
        redirectUri: 'http://127.0.0.1:3011/oauth/account/callback',
        state: 'st',
        challenge: 'ch',
        platform: 'linux-x64',
        environmentId: 'env-1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://account.test/auth/start');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      redirect_uri: 'http://127.0.0.1:3011/oauth/account/callback',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      platform: 'linux-x64',
      environment_id: 'env-1',
    });
  });
});
