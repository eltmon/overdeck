/**
 * Browser sign-in and the web session for the hosted viewer (PRD PAN-4481 WI-4; FR-5–FR-8, NFR-1, NFR-2, NFR-6).
 *
 * This Worker is the OAuth client (D-1): it generates the state and the PKCE verifier, keeps them in a
 * sealed `__Host-ods_signin` cookie, sends the browser to the account Worker's `/auth/start` with
 * `platform=web`, and redeems the returned code over the `ACCOUNT` service binding. The device token
 * then lives only inside the sealed `HttpOnly` `__Host-ods_session` cookie, so page JavaScript never
 * sees it. Sealed means AES-GCM with the `WEB_SESSION_KEY` secret (D-4). Web APIs only.
 */
import { verifyDeviceIdentity } from './account.ts';
import { normalizeShortCode, toHex } from './codes.ts';
import type { Deps, WebConfig } from './env.ts';
import { missingWebConfig } from './env.ts';
import { json, type Handler, type RequestContext } from './http.ts';
import { escapeHtml, messagePage } from './pages.ts';

export const SESSION_COOKIE = '__Host-ods_session';
export const SIGNIN_COOKIE = '__Host-ods_signin';
export const ENV_COOKIE = '__Host-ods_env';
/** D-6: 30 days; the sealed payload's issue time is checked against the same limit. */
export const SESSION_MAX_AGE_S = 2_592_000;
/** D-6: 10 minutes for the GitHub → account → share redirect chain. */
export const SIGNIN_MAX_AGE_S = 600;
/** D-6: 400 days, the browser maximum. The environment id is not secret. */
export const ENV_MAX_AGE_S = 34_560_000;

const DEVICE_TOKEN_RE = /^odd_[0-9a-f]{64}$/;
const ENVIRONMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IV_BYTES = 12;
/** AES-GCM's authentication tag. */
const TAG_BYTES = 16;

// ---- Sealing -------------------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

function importKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** `base64url(iv ‖ AES-GCM ciphertext)` of the JSON payload. */
export async function seal(keyHex: string, payload: object, deps: Pick<Deps, 'randomBytes'>): Promise<string> {
  const iv = Uint8Array.from(deps.randomBytes(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(keyHex), plaintext));
  const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(ciphertext, IV_BYTES);
  return base64url(out);
}

/** The sealed payload, or null for any decode, decrypt or parse failure. The caller validates its fields. */
export async function unseal<T>(keyHex: string, value: string): Promise<T | null> {
  const bytes = fromBase64url(value);
  if (!bytes || bytes.byteLength < IV_BYTES + TAG_BYTES) return null;
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) }, await importKey(keyHex), bytes.slice(IV_BYTES));
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

// ---- Cookies -------------------------------------------------------------------------------------

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** `__Host-` cookies: Secure, Path=/ and no Domain are required for the prefix. */
function cookie(name: string, value: string, sameSite: 'Strict' | 'Lax', maxAgeS: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=${sameSite}; Path=/; Max-Age=${maxAgeS}`;
}

const clearSession = (): string => cookie(SESSION_COOKIE, '', 'Strict', 0);
const clearSignin = (): string => cookie(SIGNIN_COOKIE, '', 'Lax', 0);

interface SessionPayload {
  v: 1;
  token: string;
  iat: number;
}

interface SigninPayload {
  v: 1;
  state: string;
  verifier: string;
  code: string;
  iat: number;
}

/** The device token from a valid session cookie issued less than 30 days ago, else null. */
export async function readWebSession(req: Request, rc: RequestContext): Promise<string | null> {
  const web = rc.config.web;
  const value = readCookie(req, SESSION_COOKIE);
  if (!web || !value) return null;
  const payload = await unseal<Partial<SessionPayload>>(web.sessionKeyHex, value);
  if (!payload || payload.v !== 1 || typeof payload.token !== 'string' || typeof payload.iat !== 'number') return null;
  if (!DEVICE_TOKEN_RE.test(payload.token)) return null;
  if (payload.iat + SESSION_MAX_AGE_S * 1000 <= rc.deps.now()) return null;
  return payload.token;
}

async function readSignin(req: Request, web: WebConfig): Promise<SigninPayload | null> {
  const value = readCookie(req, SIGNIN_COOKIE);
  if (!value) return null;
  const p = await unseal<Partial<SigninPayload>>(web.sessionKeyHex, value);
  if (!p || p.v !== 1 || typeof p.iat !== 'number') return null;
  if (typeof p.state !== 'string' || typeof p.verifier !== 'string' || typeof p.code !== 'string') return null;
  return p as SigninPayload;
}

// ---- Pages ---------------------------------------------------------------------------------------

function backLink(shortCode: string | null): string {
  return shortCode ? `<p><a href="/s/${escapeHtml(shortCode)}">Back to the shared conversation</a></p>` : '';
}

function outcomePage(title: string, text: string, status: number, shortCode: string | null): Response {
  return messagePage(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${backLink(shortCode)}`, status);
}

const expiredPage = (code: string | null) => outcomePage('Sign-in expired', 'This sign-in link expired or was already used.', 400, code);
const inviteOnlyPage = (code: string | null) =>
  outcomePage(
    'Invite only',
    'Your GitHub account is not on the overdeck.ai invite list yet. Overdeck is invite-only for now. Ask the person who shared this link to get you added, then sign in again.',
    403,
    code,
  );
const deniedPage = (code: string | null) => outcomePage('Sign-in cancelled', 'GitHub sign-in was cancelled.', 400, code);
const deletingPage = (code: string | null) => outcomePage('Account being deleted', 'This overdeck.ai account is being deleted.', 403, code);
const unavailablePage = (code: string | null) =>
  outcomePage('Sign-in unavailable', 'overdeck.ai sign-in is unavailable right now. Try again in a few minutes.', 503, code);
const invalidLinkPage = () => outcomePage('Invalid share link', 'This share link is not valid.', 400, null);

function notConfigured(rc: RequestContext): Response {
  return json({ error: 'not_configured', missing: missingWebConfig(rc.env) }, 503);
}

/** Adds Set-Cookie headers to a response a page helper built. */
function withCookies(res: Response, cookies: string[]): Response {
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return res;
}

function redirectTo(location: string, status: 302 | 303, cookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status, headers });
}

// ---- Handlers ------------------------------------------------------------------------------------

/** A lowercase UUID v4 from the injected randomness. */
function newEnvironmentId(deps: Pick<Deps, 'randomBytes'>): string {
  const b = Uint8Array.from(deps.randomBytes(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** GET /auth/signin?code=<CODE>: starts the account Worker's PKCE flow with the share redirect. */
export const webSignIn: Handler = async (req, rc) => {
  const web = rc.config.web;
  if (!web) return notConfigured(rc);
  const shortCode = normalizeShortCode(new URL(req.url).searchParams.get('code') ?? '');
  if (!shortCode) return invalidLinkPage();

  const state = toHex(rc.deps.randomBytes(16));
  const verifier = toHex(rc.deps.randomBytes(32));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const existing = readCookie(req, ENV_COOKIE) ?? '';
  const environmentId = ENVIRONMENT_ID_RE.test(existing) ? existing : newEnvironmentId(rc.deps);

  const sealed = await seal(web.sessionKeyHex, { v: 1, state, verifier, code: shortCode, iat: rc.deps.now() } satisfies SigninPayload, rc.deps);
  const start = new URL(`${web.accountBaseUrl}/auth/start`);
  start.searchParams.set('redirect_uri', `${rc.config.publicBaseUrl}/auth/callback`);
  start.searchParams.set('state', state);
  start.searchParams.set('code_challenge', challenge);
  start.searchParams.set('code_challenge_method', 'S256');
  start.searchParams.set('platform', 'web');
  start.searchParams.set('environment_id', environmentId);
  return redirectTo(start.toString(), 302, [
    cookie(SIGNIN_COOKIE, sealed, 'Lax', SIGNIN_MAX_AGE_S),
    cookie(ENV_COOKIE, environmentId, 'Lax', ENV_MAX_AGE_S),
  ]);
};

/** GET /auth/callback: checks the state, redeems the code and sets the session cookie. */
export const webCallback: Handler = async (req, rc) => {
  const web = rc.config.web;
  if (!web) return notConfigured(rc);
  const query = new URL(req.url).searchParams;
  const signin = await readSignin(req, web);
  const shortCode = signin ? normalizeShortCode(signin.code) : null;
  const clear = [clearSignin()];

  const fresh = signin !== null && rc.deps.now() - signin.iat <= SIGNIN_MAX_AGE_S * 1000;
  if (!signin || !fresh || signin.state !== query.get('state') || !shortCode) return withCookies(expiredPage(shortCode), clear);

  if (query.has('error')) {
    const description = query.get('error') === 'access_denied' ? query.get('error_description') : null;
    if (description === 'invite_only') return withCookies(inviteOnlyPage(shortCode), clear);
    if (description === 'github_denied') return withCookies(deniedPage(shortCode), clear);
    if (description === 'account_deleting') return withCookies(deletingPage(shortCode), clear);
    return withCookies(expiredPage(shortCode), clear);
  }

  const code = query.get('code') ?? '';
  if (code === '') return withCookies(expiredPage(shortCode), clear);
  let redeemed;
  try {
    redeemed = await rc.env.ACCOUNT.redeemWebCode({ code, codeVerifier: signin.verifier, redirectUri: `${rc.config.publicBaseUrl}/auth/callback` });
  } catch {
    return withCookies(unavailablePage(shortCode), clear);
  }
  if (!redeemed.ok) return withCookies(redeemed.error === 'access_denied' ? inviteOnlyPage(shortCode) : expiredPage(shortCode), clear);

  const session = await seal(web.sessionKeyHex, { v: 1, token: redeemed.accessToken, iat: rc.deps.now() } satisfies SessionPayload, rc.deps);
  return redirectTo(`/s/${shortCode}`, 303, [cookie(SESSION_COOKIE, session, 'Strict', SESSION_MAX_AGE_S), ...clear]);
};

/** POST /auth/signout (form field `code`, same origin only): revokes the web device and clears the session. */
export const webSignOut: Handler = async (req, rc) => {
  if (!rc.config.web) return notConfigured(rc);
  if (req.headers.get('Origin') !== rc.config.publicBaseUrl) return json({ error: 'forbidden_origin' }, 403);

  let rawCode = '';
  try {
    const value = (await req.formData()).get('code');
    rawCode = typeof value === 'string' ? value : '';
  } catch {
    // Not a form: treated as an invalid code below.
  }
  const token = await readWebSession(req, rc);
  if (token) {
    try {
      await rc.env.ACCOUNT.signOutDevice(token);
    } catch {
      // The cookie is cleared regardless; an unreachable account service must not trap the browser signed in.
    }
  }
  const shortCode = normalizeShortCode(rawCode);
  if (!shortCode) return withCookies(invalidLinkPage(), [clearSession()]);
  return redirectTo(`/s/${shortCode}`, 303, [clearSession()]);
};

/** GET /v1/web/session: who this browser is signed in as, from the session cookie. */
export const webSession: Handler = async (req, rc) => {
  if (!rc.config.web) return notConfigured(rc);
  const token = await readWebSession(req, rc);
  if (!token) return json({ signedIn: false });
  const verified = await verifyDeviceIdentity(rc.env, token);
  if (verified.ok) {
    const { githubId, login, avatarUrl } = verified.identity;
    return json({ signedIn: true, githubId, login, avatarUrl });
  }
  if (verified.status === 503) return json({ error: verified.error }, 503);
  // A lapsed grant keeps the cookie: re-allowing the account restores access.
  if (verified.error === 'grant_expired') return json({ signedIn: false, reason: 'grant_expired' });
  return json({ signedIn: false }, 200, { 'Set-Cookie': clearSession() });
};
