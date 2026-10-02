/**
 * Hourly cron (`0 * * * *`): retry open deletion jobs, then purge expired short-lived rows (PRD PAN-4293 §7.10, FR-13).
 * Retention boundaries are measured with deps.now(), so tests drive them with an injected clock.
 */
import { runDeletionJob } from './deletion.ts';
import type { Deps, Env } from './env.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const RETENTION = {
  deviceGrantsAfterExpiryMs: HOUR_MS,
  pendingAttemptsMs: 30 * DAY_MS,
  revokedDevicesMs: 90 * DAY_MS,
  rateLimitWindowsMs: HOUR_MS,
  completedDeletionJobsMs: 30 * DAY_MS,
} as const;

export interface MaintenanceReport {
  deletionJobsRun: number;
  purged: Record<'auth_requests' | 'auth_codes' | 'admin_sessions' | 'device_grants' | 'pending_attempts' | 'devices' | 'rate_limits' | 'deletion_jobs', number>;
}

export async function runMaintenance(env: Env, deps: Deps): Promise<MaintenanceReport> {
  const db = env.DB;
  const now = deps.now();
  const rc = { env, deps };

  const open = await db.prepare('SELECT user_id FROM deletion_jobs WHERE completed_at IS NULL ORDER BY requested_at ASC').all<{ user_id: string }>();
  for (const job of open.results) await runDeletionJob(rc, job.user_id);

  const purge = async (sql: string, ...values: number[]) => (await db.prepare(sql).bind(...values).run()).meta.changes;
  const purged: MaintenanceReport['purged'] = {
    auth_requests: await purge('DELETE FROM auth_requests WHERE expires_at < ?', now),
    auth_codes: await purge('DELETE FROM auth_codes WHERE expires_at < ?', now),
    admin_sessions: await purge('DELETE FROM admin_sessions WHERE expires_at < ?', now),
    device_grants: await purge('DELETE FROM device_grants WHERE expires_at < ?', now - RETENTION.deviceGrantsAfterExpiryMs),
    pending_attempts: await purge('DELETE FROM pending_attempts WHERE last_seen_at < ?', now - RETENTION.pendingAttemptsMs),
    devices: await purge('DELETE FROM devices WHERE revoked_at IS NOT NULL AND revoked_at < ?', now - RETENTION.revokedDevicesMs),
    rate_limits: await purge('DELETE FROM rate_limits WHERE window_start < ?', now - RETENTION.rateLimitWindowsMs),
    deletion_jobs: await purge('DELETE FROM deletion_jobs WHERE completed_at IS NOT NULL AND completed_at < ?', now - RETENTION.completedDeletionJobsMs),
  };
  return { deletionJobsRun: open.results.length, purged };
}
