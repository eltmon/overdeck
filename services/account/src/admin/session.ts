/**
 * Admin sign-in and session (PRD PAN-4293 §7.12; D-19, D-20; FR-8).
 *
 * The admin screen has its own GitHub leg (purpose 'admin'). A session exists only for the GitHub id equal to
 * OWNER_GITHUB_ID; anyone else gets 403 and leaves no row behind. Every admin POST must carry the session's csrf
 * token and an Origin equal to PUBLIC_BASE_URL's origin.
 */
import { randomHex, sha256Hex } from '../crypto.ts';
import type { Handler, RequestContext } from '../env.ts';
import type { GitHubIdentity } from '../github.ts';
import { clearCookie, html, parseCookies, readForm, redirect, setCookie } from '../http.ts';
import { errorPage, escapeHtml, layout } from '../pages.ts';
import { startGitHubLeg, type Payload } from '../sign-in.ts';

export const ADMIN_COOKIE = '__Host-od_admin';
export const ADMIN_SESSION_TTL_MS = 43_200_000; // 12 hours
export const NOT_OPERATOR_MESSAGE = 'This page is for the Overdeck operator.';
export const REQUEST_REJECTED_MESSAGE = 'Request rejected.';
export const CANCELLED_MESSAGE = 'Sign-in was cancelled.';

export interface AdminSession {
  sessionHash: string;
  githubId: number;
  csrfToken: string;
  expiresAt: number;
}

interface SessionRow {
  session_hash: string;
  github_id: number;
  csrf_token: string;
  created_at: number;
  expires_at: number;
}

/** The sign-in page shown to anyone without a valid owner session. */
export function signInPage(message: string | null = null, status = 200): Response {
  const notice = message ? `<p class="warn">${escapeHtml(message)}</p>` : '';
  return html(
    layout(
      'Overdeck accounts',
      `<h1>Overdeck accounts (invite-only)</h1>
<p class="muted">Operator sign-in.</p>
${notice}
<form method="post" action="/admin/login"><button type="submit">Sign in with GitHub</button></form>`,
    ),
    status,
    { 'Set-Cookie': clearCookie(ADMIN_COOKIE) },
  );
}

/** POST /admin/login */
export const login: Handler = async (_req, rc) => startGitHubLeg(rc, 'admin', {});

/** GitHub leg continuation for purpose 'admin': only the owner gets a session. */
export async function onGitHubIdentity(rc: RequestContext, _payload: Payload, identity: GitHubIdentity): Promise<Response> {
  if (rc.config.ownerGithubId === null || identity.githubId !== rc.config.ownerGithubId) {
    return errorPage(403, NOT_OPERATOR_MESSAGE, 'Operator only');
  }
  const sessionId = randomHex(32);
  const now = rc.deps.now();
  await rc.env.DB.prepare('INSERT INTO admin_sessions (session_hash, github_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(sessionId), identity.githubId, randomHex(16), now, now + ADMIN_SESSION_TTL_MS)
    .run();
  return redirect('/admin', 302, { 'Set-Cookie': setCookie(ADMIN_COOKIE, sessionId, { maxAgeS: ADMIN_SESSION_TTL_MS / 1000 }) });
}

export async function onGitHubDenied(_rc: RequestContext, _payload: Payload): Promise<Response> {
  return signInPage(CANCELLED_MESSAGE);
}

export type OwnerSessionResult =
  | { ok: true; session: AdminSession; form: URLSearchParams | null }
  | { ok: false; response: Response };

/**
 * Requires an unexpired session whose GitHub id is still the owner's. For non-GET requests the form body must
 * carry `csrf` equal to the session's token and the Origin header must match PUBLIC_BASE_URL (D-20).
 * On success the parsed form (for POSTs) is returned so handlers do not read the body twice.
 */
export async function requireOwnerSession(req: Request, rc: RequestContext): Promise<OwnerSessionResult> {
  const cookie = parseCookies(req)[ADMIN_COOKIE];
  if (!cookie || !/^[0-9a-f]{64}$/.test(cookie) || rc.config.ownerGithubId === null) return { ok: false, response: signInPage() };
  const row = await rc.env.DB.prepare('SELECT * FROM admin_sessions WHERE session_hash = ? AND expires_at > ? AND github_id = ?')
    .bind(await sha256Hex(cookie), rc.deps.now(), rc.config.ownerGithubId)
    .first<SessionRow>();
  if (!row) return { ok: false, response: signInPage() };
  const session: AdminSession = { sessionHash: row.session_hash, githubId: row.github_id, csrfToken: row.csrf_token, expiresAt: row.expires_at };

  if (req.method === 'GET' || req.method === 'HEAD') return { ok: true, session, form: null };
  const form = await readForm(req);
  const origin = req.headers.get('Origin');
  if (!form || form.get('csrf') !== session.csrfToken || origin !== new URL(rc.config.publicBaseUrl).origin) {
    return { ok: false, response: errorPage(403, REQUEST_REJECTED_MESSAGE, 'Request rejected') };
  }
  return { ok: true, session, form };
}

/** POST /admin/logout */
export const logout: Handler = async (req, rc) => {
  const owner = await requireOwnerSession(req, rc);
  if (!owner.ok) return owner.response;
  await rc.env.DB.prepare('DELETE FROM admin_sessions WHERE session_hash = ?').bind(owner.session.sessionHash).run();
  return redirect('/admin', 302, { 'Set-Cookie': clearCookie(ADMIN_COOKIE) });
};
