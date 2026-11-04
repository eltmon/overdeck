/**
 * PAN-4945 WI-2: the pure OAuth protocol helpers — registration rules (D-4),
 * redirect matching (D-5a), authorize params (D-5), PKCE S256, levels (D-3),
 * issuer choice (D-2), metadata bodies and the authorize page (D-11).
 */
import { describe, expect, it } from 'vitest';

import {
  authorizationServerMetadata,
  authorizePageCsp,
  formatApprovalCode,
  LEVEL_SCOPES,
  pkceS256Matches,
  protectedResourceMetadata,
  redirectUriMatches,
  redirectWith,
  renderAuthorizePage,
  renderOAuthErrorPage,
  requestedLevelFromScope,
  resolveIssuer,
  validateAuthorizeParams,
  validateRegistration,
} from '../../../../src/lib/mcp/oauth-flow.js';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('validateRegistration (D-4)', () => {
  it.each(['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:8123/cb', 'http://[::1]/cb', 'http://localhost/cb'])('accepts %s', (uri) => {
    expect(validateRegistration({ redirect_uris: [uri], client_name: 'Claude' })).toEqual({ ok: true, name: 'Claude', redirectUris: [uri] });
  });

  it.each([
    ['plain http on a public host', ['http://example.com/cb']],
    ['a javascript URI', ['javascript:alert(1)']],
    ['a fragment', ['https://app.example/cb#frag']],
    ['six URIs', Array.from({ length: 6 }, (_, i) => `https://app.example/cb${i}`)],
    ['no URIs', []],
  ])('refuses %s with invalid_redirect_uri', (_label, uris) => {
    expect(validateRegistration({ redirect_uris: uris })).toMatchObject({ ok: false, error: 'invalid_redirect_uri' });
  });

  it('refuses a 101-character name, an empty name and a client secret method', () => {
    const uris = ['https://app.example/cb'];
    expect(validateRegistration({ redirect_uris: uris, client_name: 'x'.repeat(101) })).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(validateRegistration({ redirect_uris: uris, client_name: '   ' })).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(validateRegistration({ redirect_uris: uris, token_endpoint_auth_method: 'client_secret_basic' })).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(validateRegistration({ redirect_uris: uris, grant_types: ['password'] })).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(validateRegistration({ redirect_uris: uris, response_types: ['token'] })).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(validateRegistration('nope')).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
  });

  it('defaults a missing name and ignores extra fields', () => {
    expect(
      validateRegistration({ redirect_uris: ['https://app.example/cb'], scope: 'admin', logo_uri: 'https://x', token_endpoint_auth_method: 'none', grant_types: ['authorization_code'] }),
    ).toEqual({ ok: true, name: 'Unnamed MCP client', redirectUris: ['https://app.example/cb'] });
  });
});

describe('redirectUriMatches (D-5a)', () => {
  it('accepts an exact match and a different loopback port', () => {
    expect(redirectUriMatches(['https://app.example/cb'], 'https://app.example/cb')).toBe(true);
    expect(redirectUriMatches(['http://127.0.0.1:8123/cb'], 'http://127.0.0.1:55001/cb')).toBe(true);
    expect(redirectUriMatches(['http://localhost/cb?x=1'], 'http://localhost:4000/cb?x=1')).toBe(true);
  });

  it('refuses a different path, host, query or https port', () => {
    expect(redirectUriMatches(['http://127.0.0.1:8123/cb'], 'http://127.0.0.1:8123/other')).toBe(false);
    expect(redirectUriMatches(['http://127.0.0.1:8123/cb'], 'http://localhost:8123/cb')).toBe(false);
    expect(redirectUriMatches(['http://127.0.0.1/cb?x=1'], 'http://127.0.0.1:9/cb?x=2')).toBe(false);
    expect(redirectUriMatches(['https://app.example/cb'], 'https://app.example:8443/cb')).toBe(false);
  });
});

describe('validateAuthorizeParams and requestedLevelFromScope (D-5)', () => {
  const base = { response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' };

  it('accepts a request with no state', () => {
    expect(validateAuthorizeParams(new URLSearchParams(base))).toEqual({ ok: true, codeChallenge: CHALLENGE, requestedLevel: 'read' });
  });

  it('keeps a state and reads the requested level from scope', () => {
    expect(validateAuthorizeParams(new URLSearchParams({ ...base, state: 's1', scope: 'operate approve' }))).toEqual({
      ok: true, codeChallenge: CHALLENGE, state: 's1', requestedLevel: 'operate',
    });
  });

  it('refuses plain, a 42-character challenge, response_type=token and a long state', () => {
    expect(validateAuthorizeParams(new URLSearchParams({ ...base, code_challenge_method: 'plain' }))).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(validateAuthorizeParams(new URLSearchParams({ ...base, code_challenge: 'a'.repeat(42) }))).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(validateAuthorizeParams(new URLSearchParams({ ...base, response_type: 'token' }))).toMatchObject({ ok: false, error: 'unsupported_response_type' });
    const longState = validateAuthorizeParams(new URLSearchParams({ ...base, state: 'x'.repeat(501) }));
    expect(longState).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(JSON.stringify(longState)).not.toContain('x'.repeat(501));
  });

  it('picks the lowest level named and defaults to read', () => {
    expect(requestedLevelFromScope('read message operate approve')).toBe('read');
    expect(requestedLevelFromScope('operate approve')).toBe('operate');
    expect(requestedLevelFromScope('openid foo')).toBe('read');
    expect(requestedLevelFromScope(null)).toBe('read');
  });

  it('maps levels to scopes without admin, forward or the excluded reads', () => {
    expect(LEVEL_SCOPES.operate).toEqual(['read:state', 'read:conversations', 'tell', 'operate']);
    for (const scopes of Object.values(LEVEL_SCOPES)) {
      expect(scopes.some((s) => ['admin', 'forward', 'read:settings', 'read:costs', 'read:events'].includes(s))).toBe(false);
    }
  });
});

describe('pkceS256Matches', () => {
  it('accepts the RFC 7636 appendix B pair and refuses one changed character', () => {
    expect(pkceS256Matches(VERIFIER, CHALLENGE)).toBe(true);
    expect(pkceS256Matches(`${VERIFIER.slice(0, -1)}l`, CHALLENGE)).toBe(false);
    expect(pkceS256Matches(VERIFIER, `${CHALLENGE.slice(0, -1)}N`)).toBe(false);
    expect(pkceS256Matches('short', CHALLENGE)).toBe(false);
  });
});

describe('formatApprovalCode', () => {
  it('formats eight bytes as XXXX-XXXX without I or O', () => {
    const code = formatApprovalCode(Uint8Array.from([0, 1, 2, 3, 23, 24, 200, 255]));
    expect(code).toBe('ABCD-ZAJR');
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}-[A-HJ-NP-Z]{4}$/);
  });
});

describe('resolveIssuer (D-2)', () => {
  const trustedOrigins = ['http://localhost:3011', 'http://127.0.0.1:3011', 'https://desk.tailnet.ts.net'];

  it('returns the trusted origin whose host equals Host', () => {
    expect(resolveIssuer({ funnel: false, hostHeaders: ['localhost:3011', undefined], trustedOrigins, funnelBase: null })).toBe('http://localhost:3011');
    expect(resolveIssuer({ funnel: false, hostHeaders: ['127.0.0.1:3011', undefined], trustedOrigins, funnelBase: null })).toBe('http://127.0.0.1:3011');
  });

  it('falls back to the first X-Forwarded-Host value when Host does not match', () => {
    expect(
      resolveIssuer({ funnel: false, hostHeaders: ['10.0.0.5:3011', 'Desk.Tailnet.ts.net, proxy.internal'], trustedOrigins, funnelBase: null }),
    ).toBe('https://desk.tailnet.ts.net');
  });

  it('returns funnelBase for a Funnel request and null for an unknown host', () => {
    expect(resolveIssuer({ funnel: true, hostHeaders: ['localhost:3011'], trustedOrigins, funnelBase: 'https://desk.tailnet.ts.net:8443' })).toBe(
      'https://desk.tailnet.ts.net:8443',
    );
    expect(resolveIssuer({ funnel: true, hostHeaders: ['localhost:3011'], trustedOrigins, funnelBase: null })).toBeNull();
    expect(resolveIssuer({ funnel: false, hostHeaders: ['evil.example', undefined], trustedOrigins, funnelBase: null })).toBeNull();
  });
});

describe('metadata bodies', () => {
  it('builds both bodies from the issuer', () => {
    expect(protectedResourceMetadata('http://localhost:3011')).toEqual({
      resource: 'http://localhost:3011/mcp',
      authorization_servers: ['http://localhost:3011'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'message', 'operate', 'approve'],
    });
    expect(authorizationServerMetadata('http://localhost:3011')).toMatchObject({
      issuer: 'http://localhost:3011',
      token_endpoint: 'http://localhost:3011/oauth/mcp/token',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  it('redirectWith sets only defined values', () => {
    expect(redirectWith('http://127.0.0.1:9/cb?x=1', { code: 'abc', state: undefined })).toBe('http://127.0.0.1:9/cb?x=1&code=abc');
  });
});

describe('the authorize page (D-11)', () => {
  it('escapes the client name and puts the nonce on every script and style tag', () => {
    const html = renderAuthorizePage({
      nonce: 'bm9uY2U=', requestId: 'a'.repeat(32), clientName: '<img src=x onerror=alert(1)>', redirectHost: 'claude.ai', approvalCode: 'KQZT-MWRB',
    });
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).toContain('KQZT-MWRB');
    const tags = html.match(/<(script|style)\b[^>]*>/g) ?? [];
    expect(tags.length).toBe(2);
    for (const tag of tags) expect(tag).toContain('nonce="bm9uY2U="');
  });

  it('keeps a hostile request id from closing the script', () => {
    const html = renderAuthorizePage({ nonce: 'n', requestId: '</script><script>alert(1)</script>', clientName: 'c', redirectHost: 'h', approvalCode: 'AAAA-AAAA' });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('sends a CSP that allows the status poll and forbids framing', () => {
    const csp = authorizePageCsp('n1');
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'nonce-n1'");
  });

  it('renders an escaped error page with no script', () => {
    const html = renderOAuthErrorPage('<b>bad</b>');
    expect(html).toContain('&lt;b&gt;bad');
    expect(html).not.toContain('<script');
  });
});
