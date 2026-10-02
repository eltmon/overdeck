/**
 * PKCE loopback flow for the local dashboard (PRD PAN-4293 §7.6; D-7, D-11, D-13; RFC 7636, RFC 8252 §7.3).
 *
 * GET /auth/start validates everything before any redirect; the GitHub leg continuation issues a single-use
 * 5-minute authorization code only after resolveSignIn() allowed the identity; POST /oauth/token exchanges it
 * with the identical redirect_uri and a matching S256 verifier, re-checking the allowlist before minting (D-11).
 */
import { randomHex, s256Challenge, sha256Hex } from './crypto.ts';
import { isValidEnvironmentId, isValidPlatform, mintDevice } from './devices.ts';
import type { Handler, RequestContext } from './env.ts';
import type { GitHubIdentity } from './github.ts';
import { isAllowed } from './grants.ts';
import { json, redirect } from './http.ts';
import { errorPage } from './pages.ts';
import { resolveSignIn, startGitHubLeg, type Payload } from './sign-in.ts';

export const AUTH_CODE_TTL_MS = 300_000;
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** D-7: http, loopback host, any port, no userinfo, no fragment. Returns the normalized string or null. */
export function validateLoopbackRedirect(raw: string | null): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.hash !== '' || raw.includes('#')) return null;
  return raw;
}

interface StartParams {
  redirectUri: string;
  clientState: string;
  codeChallenge: string;
  platform: string;
  environmentId: string;
}

function parseStart(url: URL): { ok: true; params: StartParams } | { ok: false; param: string } {
  const redirectUri = validateLoopbackRedirect(url.searchParams.get('redirect_uri'));
  if (!redirectUri) return { ok: false, param: 'redirect_uri' };
  const clientState = url.searchParams.get('state') ?? '';
  if (clientState.length < 1 || clientState.length > 256) return { ok: false, param: 'state' };
  const codeChallenge = url.searchParams.get('code_challenge') ?? '';
  if (!CODE_CHALLENGE_RE.test(codeChallenge)) return { ok: false, param: 'code_challenge' };
  if (url.searchParams.get('code_challenge_method') !== 'S256') return { ok: false, param: 'code_challenge_method' };
  const platform = url.searchParams.get('platform') ?? '';
  if (!isValidPlatform(platform)) return { ok: false, param: 'platform' };
  const environmentId = url.searchParams.get('environment_id') ?? '';
  if (!isValidEnvironmentId(environmentId)) return { ok: false, param: 'environment_id' };
  return { ok: true, params: { redirectUri, clientState, codeChallenge, platform, environmentId } };
}

/** GET /auth/start */
export const start: Handler = async (req, rc) => {
  const parsed = parseStart(new URL(req.url));
  if (!parsed.ok) {
    return errorPage(400, `The sign-in request has an invalid or missing ${parsed.param} parameter. Start again from Overdeck.`, 'Invalid sign-in request');
  }
  return startGitHubLeg(rc, 'pkce', { ...parsed.params });
};

function readPayload(payload: Payload): StartParams | null {
  const { redirectUri, clientState, codeChallenge, platform, environmentId } = payload;
  if ([redirectUri, clientState, codeChallenge, platform, environmentId].some((v) => typeof v !== 'string')) return null;
  if (!validateLoopbackRedirect(redirectUri as string)) return null;
  return { redirectUri, clientState, codeChallenge, platform, environmentId } as StartParams;
}

function redirectToClient(redirectUri: string, params: Record<string, string>): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return redirect(url.toString(), 302);
}

/** GitHub leg continuation for purpose 'pkce' (§7.6 step 2). */
export async function onGitHubIdentity(rc: RequestContext, payload: Payload, identity: GitHubIdentity): Promise<Response> {
  const params = readPayload(payload);
  if (!params) return errorPage(400, 'This sign-in link is malformed. Start again from Overdeck.', 'Invalid sign-in request');

  const resolution = await resolveSignIn(rc, identity, 'pkce');
  if (!resolution.allowed) {
    return redirectToClient(params.redirectUri, { error: 'access_denied', error_description: resolution.reason, state: params.clientState });
  }

  const code = `odc_${randomHex(32)}`;
  await rc.env.DB.prepare(
    'INSERT INTO auth_codes (code_hash, user_id, code_challenge, redirect_uri, platform, environment_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(await sha256Hex(code), resolution.userId, params.codeChallenge, params.redirectUri, params.platform, params.environmentId, rc.deps.now() + AUTH_CODE_TTL_MS)
    .run();
  return redirectToClient(params.redirectUri, { code, state: params.clientState });
}

/** The user cancelled on github.com. */
export async function onGitHubDenied(_rc: RequestContext, payload: Payload): Promise<Response> {
  const params = readPayload(payload);
  if (!params) return errorPage(400, 'This sign-in link is malformed. Start again from Overdeck.', 'Invalid sign-in request');
  return redirectToClient(params.redirectUri, { error: 'access_denied', error_description: 'github_denied', state: params.clientState });
}

interface AuthCodeRow {
  code_hash: string;
  user_id: string;
  code_challenge: string;
  redirect_uri: string;
  platform: string;
  environment_id: string;
  expires_at: number;
}

/** POST /oauth/token with grant_type=authorization_code (§7.6 step 3). */
export async function exchangeAuthorizationCode(rc: RequestContext, form: URLSearchParams): Promise<Response> {
  const code = form.get('code') ?? '';
  const verifier = form.get('code_verifier') ?? '';
  const redirectUri = form.get('redirect_uri') ?? '';
  if (code === '' || redirectUri === '' || !CODE_VERIFIER_RE.test(verifier)) return json({ error: 'invalid_request' }, 400);

  // Single use even when the exchange then fails: the row is gone before any check runs.
  const row = await rc.env.DB.prepare('DELETE FROM auth_codes WHERE code_hash = ? RETURNING *').bind(await sha256Hex(code)).first<AuthCodeRow>();
  if (!row || row.expires_at <= rc.deps.now() || row.redirect_uri !== redirectUri) return json({ error: 'invalid_grant' }, 400);
  if ((await s256Challenge(verifier)) !== row.code_challenge) return json({ error: 'invalid_grant' }, 400);

  const user = await rc.env.DB.prepare('SELECT github_id, deleted_at FROM users WHERE user_id = ?').bind(row.user_id).first<{ github_id: number; deleted_at: number | null }>();
  if (!user || user.deleted_at !== null || !(await isAllowed(rc, user.github_id))) return json({ error: 'access_denied' }, 400);

  const minted = await mintDevice(rc, row.user_id, row.platform, row.environment_id);
  return json({ access_token: minted.token, token_type: 'Bearer', device_id: minted.deviceId, label: minted.label });
}
