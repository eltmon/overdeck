/**
 * The invite-only allowlist (PRD PAN-4293 §7.12, D-1, D-10, D-11, D-15, D-22).
 *
 * The `grants` table IS the allowlist; only the admin screen writes it. isAllowed() is the gate every
 * sign-in and every token exchange passes before anything is minted. The owner (OWNER_GITHUB_ID) has no
 * grant row and is always allowed.
 */
import type { RequestContext } from './env.ts';

/** What the allowlist needs from the request: the database, the clock and the owner id. */
export type GrantsContext = Pick<RequestContext, 'env' | 'deps' | 'config'>;

export type GrantedVia = 'admin-add' | 'admin-allow-pending';
export type SignInFlow = 'pkce' | 'device';

export interface GrantRow {
  github_id: number;
  github_login: string;
  entitlement: string;
  storage_cap_bytes: number | null;
  note: string | null;
  granted_at: number;
  expires_at: number | null;
  granted_via: GrantedVia;
}

export interface GrantWithStats extends GrantRow {
  active_devices: number;
  last_seen_at: number | null;
}

export interface PendingAttemptRow {
  github_id: number;
  github_login: string;
  first_seen_at: number;
  last_seen_at: number;
  attempts: number;
  last_flow: SignInFlow;
}

export interface GrantOptions {
  note?: string | null;
  expiresAt?: number | null;
  storageCapBytes?: number | null;
}

export function isOwner(rc: Pick<RequestContext, 'config'>, githubId: number): boolean {
  return rc.config.ownerGithubId !== null && rc.config.ownerGithubId === githubId;
}

/** The unexpired grant for a GitHub id, or null. */
export async function getActiveGrant(rc: GrantsContext, githubId: number): Promise<GrantRow | null> {
  return rc.env.DB.prepare('SELECT * FROM grants WHERE github_id = ? AND (expires_at IS NULL OR expires_at > ?)')
    .bind(githubId, rc.deps.now())
    .first<GrantRow>();
}

/** D-22: the owner, or anyone holding an unexpired grant. */
export async function isAllowed(rc: GrantsContext, githubId: number): Promise<boolean> {
  if (isOwner(rc, githubId)) return true;
  return (await getActiveGrant(rc, githubId)) !== null;
}

/** Upsert: re-adding an account updates its login, note, expiry and cap and drops any pending attempt (§7.12). */
export async function addGrant(
  rc: GrantsContext,
  githubId: number,
  login: string,
  opts: GrantOptions,
  grantedVia: GrantedVia,
): Promise<GrantRow> {
  const now = rc.deps.now();
  const results = await rc.env.DB.batch([
    rc.env.DB.prepare(
      `INSERT INTO grants (github_id, github_login, storage_cap_bytes, note, granted_at, expires_at, granted_via)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (github_id) DO UPDATE SET
         github_login = excluded.github_login,
         storage_cap_bytes = excluded.storage_cap_bytes,
         note = excluded.note,
         granted_at = excluded.granted_at,
         expires_at = excluded.expires_at,
         granted_via = excluded.granted_via
       RETURNING *`,
    ).bind(githubId, login, opts.storageCapBytes ?? null, opts.note ?? null, now, opts.expiresAt ?? null, grantedVia),
    rc.env.DB.prepare('DELETE FROM pending_attempts WHERE github_id = ?').bind(githubId),
  ]);
  const row = results[0]?.results[0] as GrantRow | undefined;
  if (!row) throw new Error('addGrant: upsert returned no row');
  return row;
}

/**
 * D-15 operator revoke: delete the grant and revoke every active device of that account
 * (`revoked_by = 'operator'`). The users row stays. Returns true when a grant existed.
 */
export async function revokeGrant(rc: GrantsContext, githubId: number): Promise<boolean> {
  const now = rc.deps.now();
  const results = await rc.env.DB.batch([
    rc.env.DB.prepare('DELETE FROM grants WHERE github_id = ? RETURNING github_id').bind(githubId),
    rc.env.DB.prepare(
      `UPDATE devices SET revoked_at = ?, revoked_by = 'operator'
       WHERE revoked_at IS NULL AND user_id IN (SELECT user_id FROM users WHERE github_id = ?)`,
    ).bind(now, githubId),
  ]);
  return (results[0]?.results.length ?? 0) > 0;
}

/** D-10: one bounded row per GitHub id; each completed sign-in by a non-allowlisted account bumps it. */
export async function recordPendingAttempt(rc: GrantsContext, githubId: number, login: string, flow: SignInFlow): Promise<void> {
  const now = rc.deps.now();
  await rc.env.DB.prepare(
    `INSERT INTO pending_attempts (github_id, github_login, first_seen_at, last_seen_at, attempts, last_flow)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT (github_id) DO UPDATE SET
       github_login = excluded.github_login,
       last_seen_at = excluded.last_seen_at,
       attempts = pending_attempts.attempts + 1,
       last_flow = excluded.last_flow`,
  )
    .bind(githubId, login, now, now, flow)
    .run();
}

export async function getPendingAttempt(rc: GrantsContext, githubId: number): Promise<PendingAttemptRow | null> {
  return rc.env.DB.prepare('SELECT * FROM pending_attempts WHERE github_id = ?').bind(githubId).first<PendingAttemptRow>();
}

/** Grants newest first, each with its account's active device count and last activity (§7.12 part 3). */
export async function listGrantsWithDeviceStats(rc: GrantsContext): Promise<GrantWithStats[]> {
  const { results } = await rc.env.DB.prepare(
    `SELECT g.*,
            (SELECT COUNT(*) FROM devices d JOIN users u ON u.user_id = d.user_id
              WHERE u.github_id = g.github_id AND d.revoked_at IS NULL) AS active_devices,
            (SELECT MAX(d.last_used_at) FROM devices d JOIN users u ON u.user_id = d.user_id
              WHERE u.github_id = g.github_id AND d.revoked_at IS NULL) AS last_seen_at
     FROM grants g
     ORDER BY g.granted_at DESC, g.github_id ASC`,
  ).all<GrantWithStats>();
  return results;
}

export async function listPendingAttempts(rc: GrantsContext): Promise<PendingAttemptRow[]> {
  const { results } = await rc.env.DB.prepare('SELECT * FROM pending_attempts ORDER BY last_seen_at DESC, github_id ASC').all<PendingAttemptRow>();
  return results;
}
