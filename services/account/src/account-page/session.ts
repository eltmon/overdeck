/**
 * Account-page sign-in and web session (PRD PAN-4959 WI-4; FR-1, FR-2, FR-3; D-7, D-9; NFR-1, NFR-3).
 *
 * Mirrors admin/session.ts for an ordinary user. The GitHub leg runs with purpose 'account'. A session is
 * created for the owner, an active grant, or an existing user whose grant expired (D-9, as GET /v1/me
 * allows); anyone else gets the invite-only page and no pending-attempt row (D-7). Every POST that needs a
 * session must carry its csrf token and an Origin equal to PUBLIC_BASE_URL's origin.
 */
import { CANCELLED_MESSAGE, REQUEST_REJECTED_MESSAGE } from '../admin/session.ts';
import { randomHex, sha256Hex } from '../crypto.ts';
import type { Handler, RequestContext } from '../env.ts';
import type { GitHubIdentity } from '../github.ts';
import { getGrant, isOwner } from '../grants.ts';
import { clearCookie, html, parseCookies, readForm, redirect, setCookie } from '../http.ts';
import { errorPage, escapeHtml, inviteOnlyPage, layout } from '../pages.ts';
import { resolveSignIn, startGitHubLeg, type Payload } from '../sign-in.ts';

export const ACCOUNT_COOKIE = '__Host-od_account';
export const ACCOUNT_SESSION_TTL_MS = 43_200_000; // 12 hours
export const ACCOUNT_TITLE = 'Your Overdeck account';
export const DELETING_MESSAGE = 'This account is being deleted.';
export const ACCESS_REMOVED_MESSAGE = 'Access to this account was removed.';

export interface UserSession {
  sessionHash: string;
  userId: string;
  githubId: number;
  githubLogin: string;
  csrfToken: string;
}

interface SessionRow {
  session_hash: string;
  user_id: string;
  csrf_token: string;
  github_id: number;
  github_login: string;
}

/** The sign-in page shown to anyone without a valid web session; clears a stale cookie. */
export function signInPage(message: string | null = null, status = 200): Response {
  const notice = message ? `<p class="warn">${escapeHtml(message)}</p>` : '';
  return html(
    layout(
      ACCOUNT_TITLE,
      `<h1>${escapeHtml(ACCOUNT_TITLE)}</h1>
<p class="muted">Sign in to see your plan, relay use and machines.</p>
${notice}
<form method="post" action="/account/login"><button type="submit">Sign in with GitHub</button></form>`,
    ),
    status,
    { 'Set-Cookie': clearCookie(ACCOUNT_COOKIE) },
  );
}

/** POST /account/login — no session yet, so only the Origin half of NFR-1 applies. */
export const login: Handler = async (req, rc) => {
  if (req.headers.get('Origin') !== new URL(rc.config.publicBaseUrl).origin) {
    return errorPage(403, REQUEST_REJECTED_MESSAGE, 'Request rejected');
  }
  return startGitHubLeg(rc, 'account', {});
};

async function startSession(rc: RequestContext, userId: string): Promise<Response> {
  const sessionId = randomHex(32);
  const now = rc.deps.now();
  await rc.env.DB.prepare('INSERT INTO user_sessions (session_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(sessionId), userId, randomHex(16), now, now + ACCOUNT_SESSION_TTL_MS)
    .run();
  return redirect('/account', 302, { 'Set-Cookie': setCookie(ACCOUNT_COOKIE, sessionId, { maxAgeS: ACCOUNT_SESSION_TTL_MS / 1000 }) });
}

/**
 * GitHub leg continuation for purpose 'account' (FR-2, D-9), in order: an account being deleted → 403;
 * allowlisted → session (resolveSignIn upserts the user); an existing user whose grant expired → session;
 * anyone else → the invite-only page, recording nothing.
 */
export async function onGitHubIdentity(rc: RequestContext, _payload: Payload, identity: GitHubIdentity): Promise<Response> {
  const resolution = await resolveSignIn(rc, identity, null);
  if (resolution.allowed) return startSession(rc, resolution.userId);
  if (resolution.reason === 'account_deleting') return errorPage(403, DELETING_MESSAGE, 'Account being deleted');
  const user = await rc.env.DB.prepare('SELECT user_id FROM users WHERE github_id = ?').bind(identity.githubId).first<{ user_id: string }>();
  const grant = user ? await getGrant(rc, identity.githubId) : null;
  if (user && grant && grant.expires_at !== null && grant.expires_at <= rc.deps.now()) return startSession(rc, user.user_id);
  return inviteOnlyPage();
}

export async function onGitHubDenied(_rc: RequestContext, _payload: Payload): Promise<Response> {
  return signInPage(CANCELLED_MESSAGE);
}

export type UserSessionResult =
  | { ok: true; session: UserSession; form: URLSearchParams | null }
  | { ok: false; response: Response };

/**
 * Requires an unexpired session of a user who is not being deleted and still has access: the owner or any
 * grant row, expired or not (D-9). A session whose grant was revoked is deleted. For non-GET requests the
 * form must carry `csrf` equal to the session's token and the Origin header must match PUBLIC_BASE_URL
 * (NFR-1); the parsed form is returned so handlers do not read the body twice.
 */
export async function requireUserSession(req: Request, rc: RequestContext): Promise<UserSessionResult> {
  const cookie = parseCookies(req)[ACCOUNT_COOKIE];
  if (!cookie || !/^[0-9a-f]{64}$/.test(cookie)) return { ok: false, response: signInPage() };
  const row = await rc.env.DB.prepare(
    `SELECT s.session_hash, s.user_id, s.csrf_token, u.github_id, u.github_login
     FROM user_sessions s JOIN users u ON u.user_id = s.user_id
     WHERE s.session_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
  )
    .bind(await sha256Hex(cookie), rc.deps.now())
    .first<SessionRow>();
  if (!row) return { ok: false, response: signInPage() };
  if (!isOwner(rc, row.github_id) && (await getGrant(rc, row.github_id)) === null) {
    await rc.env.DB.prepare('DELETE FROM user_sessions WHERE session_hash = ?').bind(row.session_hash).run();
    return { ok: false, response: signInPage(ACCESS_REMOVED_MESSAGE) };
  }
  const session: UserSession = {
    sessionHash: row.session_hash,
    userId: row.user_id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    csrfToken: row.csrf_token,
  };

  if (req.method === 'GET' || req.method === 'HEAD') return { ok: true, session, form: null };
  const form = await readForm(req);
  const origin = req.headers.get('Origin');
  if (!form || form.get('csrf') !== session.csrfToken || origin !== new URL(rc.config.publicBaseUrl).origin) {
    return { ok: false, response: errorPage(403, REQUEST_REJECTED_MESSAGE, 'Request rejected') };
  }
  return { ok: true, session, form };
}

/** The signed-in identity and the Sign out form (FR-3); the top of the account page. */
export function identitySection(session: UserSession): string {
  return `<h1>${escapeHtml(ACCOUNT_TITLE)}</h1>
<p>Signed in as ${escapeHtml(session.githubLogin)} (GitHub id ${escapeHtml(session.githubId)})</p>
<form method="post" action="/account/logout"><input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}"><button type="submit">Sign out</button></form>`;
}

/** POST /account/logout */
export const logout: Handler = async (req, rc) => {
  const user = await requireUserSession(req, rc);
  if (!user.ok) return user.response;
  await rc.env.DB.prepare('DELETE FROM user_sessions WHERE session_hash = ?').bind(user.session.sessionHash).run();
  return redirect('/account', 302, { 'Set-Cookie': clearCookie(ACCOUNT_COOKIE) });
};
