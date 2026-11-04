/**
 * OAuth 2.1 protocol helpers for `/mcp` (PAN-4945, PAN-4927 D-15).
 *
 * Pure: no I/O, no clock and no randomness. Callers pass in the time, the
 * random bytes, the trusted origins and the request headers. This module
 * holds the access levels, the dynamic client registration rules, redirect
 * URI matching, authorize-request validation, PKCE S256, the approval code
 * format, issuer choice, both discovery metadata bodies, OAuth error bodies
 * and the authorize page HTML with its CSP.
 *
 * Every value it renders into HTML comes from anyone who can reach the port,
 * so `renderAuthorizePage` escapes all of them and keeps its one inline script
 * and style behind a per-response nonce.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { OAUTH_REFRESH_WINDOW_MS, type AccessTokenScope } from '../access-token-records.js';

export const OAUTH_LEVELS = ['read', 'message', 'operate', 'approve'] as const;
export type OAuthLevel = (typeof OAUTH_LEVELS)[number];

export const LEVEL_LABELS: Readonly<Record<OAuthLevel, string>> = {
  read: 'Read only',
  message: 'Can message',
  operate: 'Can operate',
  approve: 'Can approve',
};

export const LEVEL_SCOPES: Readonly<Record<OAuthLevel, readonly AccessTokenScope[]>> = {
  read: ['read:state', 'read:conversations'],
  message: ['read:state', 'read:conversations', 'tell'],
  operate: ['read:state', 'read:conversations', 'tell', 'operate'],
  approve: ['read:state', 'read:conversations', 'tell', 'operate', 'approve'],
};

export const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
export const REFRESH_TOKEN_TTL_MS = OAUTH_REFRESH_WINDOW_MS;
export const CODE_TTL_MS = 60_000;
export const APPROVAL_TTL_MS = 10 * 60_000;
export const REFRESH_TOKEN_PREFIX = 'odr_';
export const CLIENT_ID_PREFIX = 'odc_';

const DEFAULT_CLIENT_NAME = 'Unnamed MCP client';
const MAX_CLIENT_NAME = 100;
const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI_LENGTH = 2_000;
const MAX_STATE_LENGTH = 500;
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const APPROVAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function isOAuthLevel(value: unknown): value is OAuthLevel {
  return (OAUTH_LEVELS as readonly unknown[]).includes(value);
}

/** The lowest level named in a space-separated `scope`; `read` when none is named (D-5). */
export function requestedLevelFromScope(scope: string | null): OAuthLevel {
  const named = (scope ?? '').split(' ').filter(isOAuthLevel);
  if (named.length === 0) return 'read';
  return OAUTH_LEVELS[Math.min(...named.map((level) => OAUTH_LEVELS.indexOf(level)))]!;
}

export type RegistrationResult =
  | { ok: true; name: string; redirectUris: string[] }
  | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function redirectUriProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_REDIRECT_URI_LENGTH) return `each redirect URI must be a string of at most ${MAX_REDIRECT_URI_LENGTH} characters`;
  const url = parseUrl(value);
  if (!url) return 'each redirect URI must be an absolute URL';
  if (value.includes('#')) return 'a redirect URI must not carry a fragment';
  if (url.protocol !== 'https:' && !isLoopbackHttp(url)) return 'a redirect URI must use https, or http on 127.0.0.1, [::1] or localhost';
  return null;
}

function isSubsetOf(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === 'string' && allowed.includes(entry)));
}

/** Dynamic client registration field rules (D-4). Capacity is the service's concern. */
export function validateRegistration(body: unknown): RegistrationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'invalid_client_metadata', description: 'the body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: 'invalid_redirect_uri', description: `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs` };
  }
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem) return { ok: false, error: 'invalid_redirect_uri', description: problem };
  }
  let name = DEFAULT_CLIENT_NAME;
  if (b.client_name !== undefined) {
    const trimmed = typeof b.client_name === 'string' ? b.client_name.trim() : '';
    if (trimmed === '' || trimmed.length > MAX_CLIENT_NAME) {
      return { ok: false, error: 'invalid_client_metadata', description: `client_name must be 1 to ${MAX_CLIENT_NAME} characters` };
    }
    name = trimmed;
  }
  if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== 'none') {
    return { ok: false, error: 'invalid_client_metadata', description: 'token_endpoint_auth_method must be none' };
  }
  if (!isSubsetOf(b.grant_types, ['authorization_code', 'refresh_token'])) {
    return { ok: false, error: 'invalid_client_metadata', description: 'grant_types may list only authorization_code and refresh_token' };
  }
  if (!isSubsetOf(b.response_types, ['code'])) {
    return { ok: false, error: 'invalid_client_metadata', description: 'response_types may list only code' };
  }
  return { ok: true, name, redirectUris: uris as string[] };
}

/** Exact match, except that a registered http loopback URI matches on any port (D-5a, RFC 8252 §7.3). */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const want = parseUrl(requested);
  if (!want || !isLoopbackHttp(want)) return false;
  want.port = '';
  return registered.some((uri) => {
    const have = parseUrl(uri);
    if (!have || !isLoopbackHttp(have)) return false;
    have.port = '';
    return have.href === want.href;
  });
}

export type AuthorizeCheck =
  | { ok: true; codeChallenge: string; state?: string; requestedLevel: OAuthLevel }
  | { ok: false; error: 'invalid_request' | 'unsupported_response_type'; description: string };

/** The authorize checks whose failure redirects to the client (D-5 step 2). */
export function validateAuthorizeParams(params: URLSearchParams): AuthorizeCheck {
  if (params.get('response_type') !== 'code') {
    return { ok: false, error: 'unsupported_response_type', description: 'response_type must be code' };
  }
  const codeChallenge = params.get('code_challenge');
  if (codeChallenge === null || !PKCE_VALUE.test(codeChallenge) || params.get('code_challenge_method') !== 'S256') {
    return { ok: false, error: 'invalid_request', description: 'an S256 code_challenge is required' };
  }
  const state = params.get('state');
  if (state !== null && state.length > MAX_STATE_LENGTH) {
    return { ok: false, error: 'invalid_request', description: `state must be at most ${MAX_STATE_LENGTH} characters` };
  }
  return { ok: true, codeChallenge, ...(state !== null ? { state } : {}), requestedLevel: requestedLevelFromScope(params.get('scope')) };
}

/** True when base64url(SHA-256(verifier)) equals `challenge`, compared in constant time. */
export function pkceS256Matches(verifier: string, challenge: string): boolean {
  if (!PKCE_VALUE.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** Eight bytes as an approval code such as `KQZT-MWRB` (no I, no O). */
export function formatApprovalCode(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error('An approval code needs 8 bytes');
  const letters = Array.from(bytes.slice(0, 8), (byte) => APPROVAL_ALPHABET[byte % APPROVAL_ALPHABET.length]!).join('');
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/**
 * The issuer for a request (D-2): the Funnel base for a Funnel request, else
 * the first trusted origin whose host equals a candidate host header (Host,
 * then X-Forwarded-Host; first comma-separated value, lowercased). Never the
 * raw header. Null when nothing matches.
 */
export function resolveIssuer(input: {
  funnel: boolean;
  hostHeaders: readonly (string | undefined)[];
  trustedOrigins: readonly string[];
  funnelBase: string | null;
}): string | null {
  if (input.funnel) return input.funnelBase;
  for (const header of input.hostHeaders) {
    const candidate = header?.split(',')[0]?.trim().toLowerCase();
    if (!candidate) continue;
    for (const origin of input.trustedOrigins) {
      const url = parseUrl(origin);
      if (url && url.host === candidate) return url.origin;
    }
  }
  return null;
}

/** RFC 9728 protected-resource metadata for `<issuer>/mcp`. */
export function protectedResourceMetadata(issuer: string): Record<string, unknown> {
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...OAUTH_LEVELS],
  };
}

/** RFC 8414 authorization-server metadata. */
export function authorizationServerMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/mcp/authorize`,
    token_endpoint: `${issuer}/oauth/mcp/token`,
    registration_endpoint: `${issuer}/oauth/mcp/register`,
    revocation_endpoint: `${issuer}/oauth/mcp/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...OAUTH_LEVELS],
  };
}

export function oauthErrorBody(error: string, description?: string): { error: string; error_description?: string } {
  return description === undefined ? { error } : { error, error_description: description };
}

/** `redirectUri` with each defined value set as a query parameter. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The `Content-Security-Policy` header value for the authorize page (D-11). */
export function authorizePageCsp(nonce: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
}

const PAGE_STYLE = `body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a;background:#fafafa}
h1{font-size:1.4rem}.code{font-family:ui-monospace,monospace;font-size:2.4rem;letter-spacing:.15em;margin:1.5rem 0}
@media (prefers-color-scheme:dark){body{color:#eee;background:#161616}}`;

/** The authorize page (D-11): who asks, where it returns, the approval code, and a 2 s status poll. */
export function renderAuthorizePage(input: { nonce: string; requestId: string; clientName: string; redirectHost: string; approvalCode: string }): string {
  const nonce = escapeHtml(input.nonce);
  // JSON inside a script: `<` is escaped so no value can close the tag.
  const requestId = JSON.stringify(input.requestId).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Overdeck</title>
<style nonce="${nonce}">${PAGE_STYLE}</style>
</head>
<body>
<h1>Sign in to Overdeck</h1>
<p>${escapeHtml(input.clientName)} wants access to this Overdeck.</p>
<p>It will send you back to ${escapeHtml(input.redirectHost)}.</p>
<p class="code">${escapeHtml(input.approvalCode)}</p>
<p id="status">Approve this in your Overdeck dashboard. Approve only if the dashboard shows this same code.</p>
<script nonce="${nonce}">
(function () {
  var requestId = ${requestId};
  function poll() {
    fetch('./authorize/status?request=' + encodeURIComponent(requestId), { cache: 'no-store' })
      .then(function (response) { return response.json(); })
      .then(function (body) {
        if ((body.status === 'approved' || body.status === 'denied') && typeof body.redirect === 'string') {
          location.replace(body.redirect);
          return;
        }
        if (body.status === 'expired') {
          document.getElementById('status').textContent = 'This sign-in expired. Start again from your app.';
          return;
        }
        setTimeout(poll, 2000);
      })
      .catch(function () { setTimeout(poll, 2000); });
  }
  setTimeout(poll, 2000);
})();
</script>
</body>
</html>
`;
}

/** A plain error page with no script, for authorize failures that must not redirect. */
export function renderOAuthErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Overdeck</title>
</head>
<body>
<h1>Sign in to Overdeck</h1>
<p>${escapeHtml(message)}</p>
</body>
</html>
`;
}
