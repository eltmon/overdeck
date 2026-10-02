import { describe, expect, it } from 'vitest';
import { requestDeletion } from '../../../../services/account/src/deletion.ts';
import type { AccountDataHolder } from '../../../../services/account/src/env.ts';
import { RETENTION, runMaintenance } from '../../../../services/account/src/maintenance.ts';
import { dbOf, makeDeps, makeEnv, makeRc } from './helpers/harness.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('hourly maintenance (PAN-4293 account-maintenance)', () => {
  it('completes a pending deletion job once its holder succeeds', async () => {
    let fail = true;
    const vault: AccountDataHolder = {
      async deleteAccountData() {
        if (fail) throw new Error('down');
        return { deleted: true };
      },
    };
    const env = makeEnv({ VAULT: vault });
    const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12) });
    const rc = makeRc({ env, deps });
    await env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u1', 100, 'alice', deps.now()).run();
    await requestDeletion(rc, 'u1');

    const first = await runMaintenance(env, deps);
    expect(first.deletionJobsRun).toBe(1);
    expect(await dbOf(env).prepare('SELECT attempts, completed_at FROM deletion_jobs WHERE user_id = ?').bind('u1').first()).toEqual({ attempts: 1, completed_at: null });

    fail = false;
    deps.clock.advance(HOUR);
    const second = await runMaintenance(env, deps);
    expect(second.deletionJobsRun).toBe(1);
    expect(await dbOf(env).prepare('SELECT completed_at FROM deletion_jobs WHERE user_id = ?').bind('u1').first<number>('completed_at')).toBe(deps.now());
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM users').first<number>('n')).toBe(0);

    deps.clock.advance(HOUR);
    expect((await runMaintenance(env, deps)).deletionJobsRun).toBe(0);
  });

  it('purges rows past each retention boundary and keeps rows inside it', async () => {
    const env = makeEnv();
    const now = Date.UTC(2026, 9, 1, 12);
    const deps = makeDeps({ now });
    const db = dbOf(env);
    const ins = (sql: string, ...v: Array<string | number | null>) => db.prepare(sql).bind(...v).run();

    // Expiry-bounded tables: expires_at < now goes, expires_at >= now stays.
    await ins('INSERT INTO auth_requests (state_hash, purpose, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)', 'old', 'pkce', '{}', 0, now - 1, 'new', 'pkce', '{}', 0, now);
    await ins('INSERT INTO auth_codes (code_hash, user_id, code_challenge, redirect_uri, platform, environment_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)', 'old', 'u', 'c', 'r', 'p', 'e', now - 1, 'new', 'u', 'c', 'r', 'p', 'e', now + 1);
    await ins('INSERT INTO admin_sessions (session_hash, github_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)', 'old', 1, 'x', 0, now - 1, 'new', 1, 'x', 0, now + 1);
    // device_grants: one hour of grace after expiry.
    await ins(
      "INSERT INTO device_grants (device_code_hash, user_code_hash, platform, environment_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?), (?, ?, ?, ?, 'pending', ?, ?)",
      'old', 'uo', 'p', 'e', 0, now - RETENTION.deviceGrantsAfterExpiryMs - 1, 'new', 'un', 'p', 'e', 0, now - RETENTION.deviceGrantsAfterExpiryMs,
    );
    // pending_attempts: 30 days after last_seen_at.
    await ins("INSERT INTO pending_attempts (github_id, github_login, first_seen_at, last_seen_at, last_flow) VALUES (?, ?, ?, ?, 'pkce'), (?, ?, ?, ?, 'pkce')", 1, 'old', 0, now - 30 * DAY - 1, 2, 'new', 0, now - 30 * DAY);
    // devices: revoked 90 days ago go; revoked more recently or still active stay.
    await ins('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)', 'u', 7, 'u', 0);
    await ins(
      "INSERT INTO devices (device_id, user_id, token_hash, platform, label, environment_id, created_at, revoked_at, revoked_by) VALUES ('old', 'u', 'h1', 'p', 'l', 'e1', 0, ?, 'user'), ('new', 'u', 'h2', 'p', 'l', 'e2', 0, ?, 'user'), ('active', 'u', 'h3', 'p', 'l', 'e3', 0, NULL, NULL)",
      now - 90 * DAY - 1, now - 90 * DAY,
    );
    // rate_limits: one hour after window_start.
    await ins('INSERT INTO rate_limits (bucket, client_hash, window_start, count) VALUES (?, ?, ?, 1), (?, ?, ?, 1)', 'token', 'old', now - HOUR - 1, 'token', 'new', now - HOUR);
    // deletion_jobs: completed 30 days ago go; open or recent stay.
    await ins(
      "INSERT INTO deletion_jobs (user_id, requested_at, holders_pending, completed_at) VALUES ('old', 0, '[]', ?), ('new', 0, '[]', ?), ('open', 0, '[]', NULL)",
      now - 30 * DAY - 1, now - 30 * DAY,
    );

    const report = await runMaintenance(env, deps);
    expect(report.purged).toEqual({ auth_requests: 1, auth_codes: 1, admin_sessions: 1, device_grants: 1, pending_attempts: 1, devices: 1, rate_limits: 1, deletion_jobs: 1 });
    // The open job was retried and, with no holders pending, completed; the user row it referenced ('open') never existed.
    expect(report.deletionJobsRun).toBe(1);

    const survivors = async (table: string, key: string) => (await db.prepare(`SELECT ${key} AS k FROM ${table} ORDER BY k`).all<{ k: string | number }>()).results.map((r) => r.k);
    expect(await survivors('auth_requests', 'state_hash')).toEqual(['new']);
    expect(await survivors('auth_codes', 'code_hash')).toEqual(['new']);
    expect(await survivors('admin_sessions', 'session_hash')).toEqual(['new']);
    expect(await survivors('device_grants', 'device_code_hash')).toEqual(['new']);
    expect(await survivors('pending_attempts', 'github_id')).toEqual([2]);
    expect(await survivors('devices', 'device_id')).toEqual(['active', 'new']);
    expect(await survivors('rate_limits', 'client_hash')).toEqual(['new']);
    expect(await survivors('deletion_jobs', 'user_id')).toEqual(['new', 'open']);

    // One millisecond later every 'new' row that sat exactly on its boundary crosses it, except the two with expires_at = now + 1.
    deps.clock.advance(1);
    expect((await runMaintenance(env, deps)).purged).toEqual({ auth_requests: 1, auth_codes: 0, admin_sessions: 0, device_grants: 1, pending_attempts: 1, devices: 1, rate_limits: 1, deletion_jobs: 1 });
  });
});
