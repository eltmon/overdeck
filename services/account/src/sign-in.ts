/**
 * Starting a GitHub leg and the allowlist gate every sign-in passes (PRD PAN-4293 §7.5 steps 1 and 3; D-11, D-21).
 *
 * Lives apart from github-callback.ts so the flow modules (pkce, device-flow, admin/session) can import it
 * while the callback dispatcher imports them, without a cycle.
 */
import { randomHex, sha256Hex } from './crypto.ts';
import type { RequestContext } from './env.ts';
import { authorizeUrl, type GitHubIdentity } from './github.ts';
import { isAllowed, recordPendingAttempt, type SignInFlow } from './grants.ts';
import { redirect, setCookie } from './http.ts';

export type Purpose = 'pkce' | 'device' | 'admin';
export const STATE_COOKIE = '__Host-od_state';
export const AUTH_REQUEST_TTL_MS = 600_000;

export type Payload = Record<string, unknown>;

export interface AuthRequestRow {
  state_hash: string;
  purpose: Purpose;
  payload: string;
  created_at: number;
  expires_at: number;
}

/** D-21: writes the browser-bound continuation and redirects to GitHub. */
export async function startGitHubLeg(rc: RequestContext, purpose: Purpose, payload: Payload): Promise<Response> {
  const state = randomHex(32);
  const now = rc.deps.now();
  await rc.env.DB.prepare('INSERT INTO auth_requests (state_hash, purpose, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(state), purpose, JSON.stringify(payload), now, now + AUTH_REQUEST_TTL_MS)
    .run();
  return redirect(authorizeUrl(rc.config, state), 302, {
    'Set-Cookie': setCookie(STATE_COOKIE, state, { maxAgeS: AUTH_REQUEST_TTL_MS / 1000 }),
  });
}

export type SignInResolution =
  | { allowed: true; userId: string }
  | { allowed: false; reason: 'invite_only' | 'account_deleting' };

/**
 * D-11: the only path to minting. Not allowlisted → pending attempt, no users row.
 * Allowed → upsert the user (login refreshed) unless the account is mid-deletion.
 */
export async function resolveSignIn(rc: RequestContext, identity: GitHubIdentity, flow: SignInFlow): Promise<SignInResolution> {
  // A deleting account has already lost its grant; refuse it as such instead of recording a pending attempt.
  const existing = await rc.env.DB.prepare('SELECT deleted_at FROM users WHERE github_id = ?').bind(identity.githubId).first<{ deleted_at: number | null }>();
  if (existing?.deleted_at != null) return { allowed: false, reason: 'account_deleting' };
  if (!(await isAllowed(rc, identity.githubId))) {
    await recordPendingAttempt(rc, identity.githubId, identity.login, flow);
    return { allowed: false, reason: 'invite_only' };
  }
  const row = await rc.env.DB.prepare(
    `INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET github_login = excluded.github_login
     RETURNING user_id, deleted_at`,
  )
    .bind(crypto.randomUUID(), identity.githubId, identity.login, rc.deps.now())
    .first<{ user_id: string; deleted_at: number | null }>();
  if (!row) throw new Error('resolveSignIn: users upsert returned no row');
  if (row.deleted_at !== null) return { allowed: false, reason: 'account_deleting' };
  return { allowed: true, userId: row.user_id };
}
