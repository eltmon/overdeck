/**
 * Account deletion with data-holder fan-out (PRD PAN-4293 §7.10; D-15, D-16; FR-7).
 *
 * DELETE /v1/account revokes every device, removes the grant and pending row and opens a deletion job in one
 * batch, then runs the job via ctx.waitUntil. The job asks each bound data holder (today only the optional VAULT
 * binding) to deleteAccountData(userId); once every holder acked, the user's device and user rows are deleted.
 * The hourly cron (maintenance.ts) retries jobs that are still open.
 */
import { authenticateRequest } from './devices.ts';
import type { AccountDataHolder, Env, Handler, RequestContext } from './env.ts';
import { json } from './http.ts';

export type DeletionContext = Pick<RequestContext, 'env' | 'deps'>;

export interface DeletionJobRow {
  user_id: string;
  requested_at: number;
  holders_pending: string;
  attempts: number;
  last_error: string | null;
  completed_at: number | null;
}

export const HOLDER_NAMES = ['vault'] as const;
export type HolderName = (typeof HOLDER_NAMES)[number];

/** Names of the data holders bound in this deployment. */
export function boundHolders(env: Env): HolderName[] {
  return env.VAULT ? ['vault'] : [];
}

function holderFor(env: Env, name: string): AccountDataHolder | undefined {
  return name === 'vault' ? env.VAULT : undefined;
}

function parseHolders(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Marks the account for deletion (idempotent) and returns the job's requested_at. */
export async function requestDeletion(rc: DeletionContext, userId: string): Promise<number> {
  const db = rc.env.DB;
  const now = rc.deps.now();
  const user = await db.prepare('SELECT github_id FROM users WHERE user_id = ?').bind(userId).first<{ github_id: number }>();
  if (!user) throw new Error(`requestDeletion: unknown user ${userId}`);
  await db.batch([
    db.prepare('UPDATE users SET deleted_at = ? WHERE user_id = ? AND deleted_at IS NULL').bind(now, userId),
    db.prepare("UPDATE devices SET revoked_at = ?, revoked_by = 'account-deletion' WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId),
    db.prepare('DELETE FROM grants WHERE github_id = ?').bind(user.github_id),
    db.prepare('DELETE FROM pending_attempts WHERE github_id = ?').bind(user.github_id),
    db.prepare('INSERT OR IGNORE INTO deletion_jobs (user_id, requested_at, holders_pending) VALUES (?, ?, ?)').bind(userId, now, JSON.stringify(boundHolders(rc.env))),
  ]);
  const job = await db.prepare('SELECT requested_at FROM deletion_jobs WHERE user_id = ?').bind(userId).first<number>('requested_at');
  if (job === null) throw new Error('requestDeletion: job row missing after insert');
  return job;
}

/** One pass over a job: ask each pending holder; when none remain, delete the user's rows and complete the job. */
export async function runDeletionJob(rc: DeletionContext, userId: string): Promise<DeletionJobRow | null> {
  const db = rc.env.DB;
  const job = await db.prepare('SELECT * FROM deletion_jobs WHERE user_id = ?').bind(userId).first<DeletionJobRow>();
  if (!job || job.completed_at !== null) return job;

  const remaining: string[] = [];
  let attempts = job.attempts;
  let lastError = job.last_error;
  for (const name of parseHolders(job.holders_pending)) {
    const holder = holderFor(rc.env, name);
    if (!holder) {
      remaining.push(name);
      lastError = `holder ${name} not bound`;
      continue;
    }
    try {
      await holder.deleteAccountData(userId);
    } catch (error) {
      remaining.push(name);
      attempts += 1;
      lastError = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    }
  }

  if (remaining.length > 0) {
    await db.prepare('UPDATE deletion_jobs SET holders_pending = ?, attempts = ?, last_error = ? WHERE user_id = ?')
      .bind(JSON.stringify(remaining), attempts, lastError, userId)
      .run();
  } else {
    await db.batch([
      db.prepare('DELETE FROM devices WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM users WHERE user_id = ?').bind(userId),
      db.prepare("UPDATE deletion_jobs SET completed_at = ?, holders_pending = '[]', attempts = ?, last_error = ? WHERE user_id = ?").bind(rc.deps.now(), attempts, lastError, userId),
    ]);
  }
  return db.prepare('SELECT * FROM deletion_jobs WHERE user_id = ?').bind(userId).first<DeletionJobRow>();
}

/** DELETE /v1/account (expired grants allowed: a lapsed tester can still delete their account). */
export const requestDeletionHandler: Handler = async (req, rc) => {
  const result = await authenticateRequest(req, rc, { allowExpiredGrant: true });
  if (!result.ok) return result.response;
  const requestedAt = await requestDeletion(rc, result.auth.userId);
  rc.ctx.waitUntil(runDeletionJob(rc, result.auth.userId));
  return json({ deletionRequestedAt: requestedAt }, 202);
};
