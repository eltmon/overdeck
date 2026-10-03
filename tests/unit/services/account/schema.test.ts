import { describe, expect, it } from 'vitest';
import { applyMigrations, createTestD1, dumpAllTables, listTables } from './helpers/d1.ts';

const TABLES = [
  'admin_sessions',
  'auth_codes',
  'auth_requests',
  'deletion_jobs',
  'device_grants',
  'devices',
  'grants',
  'pending_attempts',
  'rate_limits',
  'users',
];

function migrated() {
  const db = createTestD1();
  const files = applyMigrations(db);
  return { db, files };
}

async function seedUser(db: ReturnType<typeof createTestD1>, userId: string, githubId: number) {
  await db.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind(userId, githubId, `u${githubId}`, 1).run();
}

function deviceInsert(db: ReturnType<typeof createTestD1>, id: string, user: string, env: string, revokedAt: number | null) {
  return db
    .prepare(
      'INSERT INTO devices (device_id, user_id, token_hash, platform, label, environment_id, created_at, revoked_at, revoked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, user, `hash-${id}`, 'linux-x64', 'Linux device', env, 1, revokedAt, revokedAt === null ? null : 'user')
    .run();
}

describe('account service schema (PAN-4293 account-schema)', () => {
  it('applies the migrations on an empty database', () => {
    const { files } = migrated();
    expect(files).toEqual(['0001_init.sql']);
  });

  it('creates all ten tables', () => {
    const { db } = migrated();
    expect(listTables(db)).toEqual(TABLES);
  });

  it('allows only one active device per (user_id, environment_id) but any number of revoked ones', async () => {
    const { db } = migrated();
    await seedUser(db, 'u1', 10);
    const env = '11111111-2222-4333-8444-555555555555';
    await deviceInsert(db, 'd1', 'u1', env, null);
    await expect(deviceInsert(db, 'd2', 'u1', env, null)).rejects.toThrow(/UNIQUE constraint failed/);
    await deviceInsert(db, 'd3', 'u1', env, 1000);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').bind('u1').first<number>('n');
    expect(count).toBe(2);
  });

  it('devices reference an existing user', async () => {
    const { db } = migrated();
    await expect(deviceInsert(db, 'd1', 'ghost', '11111111-2222-4333-8444-555555555555', null)).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it('grants.granted_via rejects an unknown value and defaults entitlement to tester', async () => {
    const { db } = migrated();
    await expect(
      db.prepare('INSERT INTO grants (github_id, github_login, granted_at, granted_via) VALUES (?, ?, ?, ?)').bind(1, 'a', 1, 'cli').run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await db.prepare('INSERT INTO grants (github_id, github_login, granted_at, granted_via) VALUES (?, ?, ?, ?)').bind(1, 'a', 1, 'admin-add').run();
    const row = await db.prepare('SELECT entitlement, storage_cap_bytes, expires_at FROM grants WHERE github_id = ?').bind(1).first();
    expect(row).toEqual({ entitlement: 'tester', storage_cap_bytes: null, expires_at: null });
  });

  it('a failing statement inside batch rolls back the earlier ones', async () => {
    const { db } = migrated();
    await expect(
      db.batch([
        db.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u1', 1, 'a', 1),
        db.prepare('INSERT INTO pending_attempts (github_id, github_login, first_seen_at, last_seen_at, last_flow) VALUES (?, ?, ?, ?, ?)').bind(1, 'a', 1, 1, 'ssh'),
      ]),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM users').first<number>('n')).toBe(0);

    const results = await db.batch([
      db.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u1', 1, 'a', 1),
      db.prepare('UPDATE users SET github_login = ? WHERE user_id = ?').bind('b', 'u1'),
    ]);
    expect(results).toHaveLength(2);
    expect(results[1]?.meta.changes).toBe(1);
    expect(await db.prepare('SELECT github_login FROM users WHERE user_id = ?').bind('u1').first<string>('github_login')).toBe('b');
  });

  it('RETURNING works through the shim for INSERT and DELETE', async () => {
    const { db } = migrated();
    const inserted = await db
      .prepare('INSERT INTO auth_requests (state_hash, purpose, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?) RETURNING state_hash, purpose')
      .bind('h1', 'pkce', '{}', 1, 2)
      .all();
    expect(inserted.results).toEqual([{ state_hash: 'h1', purpose: 'pkce' }]);

    const deleted = await db.prepare('DELETE FROM auth_requests WHERE state_hash = ? RETURNING *').bind('h1').first();
    expect(deleted).toMatchObject({ state_hash: 'h1', purpose: 'pkce', payload: '{}' });
    expect(await db.prepare('DELETE FROM auth_requests WHERE state_hash = ? RETURNING *').bind('h1').first()).toBeNull();
  });

  it('first() returns null for a missing row or column and run() reports changes', async () => {
    const { db } = migrated();
    expect(await db.prepare('SELECT * FROM users WHERE user_id = ?').bind('nope').first()).toBeNull();
    const run = await db.prepare('INSERT INTO rate_limits (bucket, client_hash, window_start, count) VALUES (?, ?, ?, ?)').bind('token', 'c', 1, 1).run();
    expect(run.success).toBe(true);
    expect(run.meta.changes).toBe(1);
    expect(await db.prepare('SELECT count FROM rate_limits WHERE bucket = ?').bind('token').first<number>('count')).toBe(1);
    expect(await db.prepare('SELECT count FROM rate_limits WHERE bucket = ?').bind('token').first('missing_column')).toBeNull();
    expect(await db.prepare('SELECT ? AS n').bind(5 * 1024 ** 3).first<number>('n')).toBe(5368709120);
  });

  it('dumpAllTables covers every table', () => {
    const { db } = migrated();
    const dump = JSON.parse(dumpAllTables(db)) as Record<string, unknown[]>;
    expect(Object.keys(dump).sort()).toEqual(TABLES);
  });
});
