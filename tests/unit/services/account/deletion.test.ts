import { describe, expect, it, vi } from 'vitest';
import { boundHolders, requestDeletion, runDeletionJob, type DeletionJobRow } from '../../../../services/account/src/deletion.ts';
import { mintDevice, verifyDeviceToken } from '../../../../services/account/src/devices.ts';
import type { AccountDataHolder, Env } from '../../../../services/account/src/env.ts';
import { addGrant, getActiveGrant, getPendingAttempt, recordPendingAttempt } from '../../../../services/account/src/grants.ts';
import { call, dbOf, fakeCtx, makeDeps, makeEnv, makeRc, type TestDeps } from './helpers/harness.ts';

const ENV_A = '11111111-2222-4333-8444-555555555555';
const ENV_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';

async function setup(vault?: AccountDataHolder) {
  const env = makeEnv(vault ? { VAULT: vault } : {});
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12) });
  const ctx = fakeCtx();
  const rc = makeRc({ env, deps, ctx });
  await env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)')
    .bind('u-alice', 100, 'alice', deps.now(), 'u-bob', 200, 'bob', deps.now())
    .run();
  await addGrant(rc, 100, 'alice', {}, 'admin-add');
  await addGrant(rc, 200, 'bob', {}, 'admin-add');
  await recordPendingAttempt(rc, 100, 'alice', 'pkce');
  const alice = await mintDevice(rc, 'u-alice', 'linux-x64', ENV_A);
  const alice2 = await mintDevice(rc, 'u-alice', 'linux-x64', ENV_B);
  const bob = await mintDevice(rc, 'u-bob', 'linux-x64', ENV_A);
  return { env, deps, ctx, rc, alice, alice2, bob };
}

function del(env: Env, deps: TestDeps, ctx: ReturnType<typeof fakeCtx>, token: string) {
  return call('DELETE', '/v1/account', { env, deps, ctx, headers: { Authorization: `Bearer ${token}` } });
}

async function job(env: Env, userId: string) {
  return dbOf(env).prepare('SELECT * FROM deletion_jobs WHERE user_id = ?').bind(userId).first<DeletionJobRow>();
}

async function count(env: Env, table: string, where = '1=1') {
  return dbOf(env).prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<number>('n');
}

describe('account deletion (PAN-4293 account-deletion)', () => {
  it('with no VAULT bound: 202, and once the job has run the user and device rows are gone and the job is completed', async () => {
    const { env, deps, ctx, rc, alice, bob } = await setup();
    expect(boundHolders(env)).toEqual([]);
    const res = await del(env, deps, ctx, alice.token);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ deletionRequestedAt: deps.now() });
    expect(ctx.pending.length + 1).toBeGreaterThan(0); // the job was handed to waitUntil
    await ctx.drain();

    expect(await count(env, 'users', "user_id = 'u-alice'")).toBe(0);
    expect(await count(env, 'devices', "user_id = 'u-alice'")).toBe(0);
    expect(await getActiveGrant(rc, 100)).toBeNull();
    expect(await getPendingAttempt(rc, 100)).toBeNull();
    expect(await job(env, 'u-alice')).toMatchObject({ requested_at: deps.now(), completed_at: deps.now(), holders_pending: '[]', attempts: 0, last_error: null });
    expect(await verifyDeviceToken(rc, alice.token)).toEqual({ ok: false, error: 'invalid_token' });

    // Bob is untouched.
    expect(await verifyDeviceToken(rc, bob.token)).toMatchObject({ ok: true });
    expect(await getActiveGrant(rc, 200)).not.toBeNull();
  });

  it('a succeeding VAULT holder receives the userId and the job completes', async () => {
    const vault: AccountDataHolder = { deleteAccountData: vi.fn(async () => ({ deleted: true as const })) };
    const { env, deps, ctx, alice } = await setup(vault);
    expect(boundHolders(env)).toEqual(['vault']);
    expect((await del(env, deps, ctx, alice.token)).status).toBe(202);
    await ctx.drain();
    expect(vault.deleteAccountData).toHaveBeenCalledTimes(1);
    expect(vault.deleteAccountData).toHaveBeenCalledWith('u-alice');
    expect(await job(env, 'u-alice')).toMatchObject({ completed_at: deps.now(), holders_pending: '[]', attempts: 0 });
    expect(await count(env, 'users', "user_id = 'u-alice'")).toBe(0);
  });

  it('a failing VAULT holder leaves devices revoked, the user row present, attempts = 1 and last_error set; a retry completes it', async () => {
    let fail = true;
    const vault: AccountDataHolder = {
      async deleteAccountData() {
        if (fail) throw new Error('vault unavailable: ' + 'x'.repeat(300));
        return { deleted: true };
      },
    };
    const { env, deps, ctx, rc, alice } = await setup(vault);
    expect((await del(env, deps, ctx, alice.token)).status).toBe(202);
    await ctx.drain();
    const pending = await job(env, 'u-alice');
    expect(pending).toMatchObject({ holders_pending: '["vault"]', attempts: 1, completed_at: null });
    expect(pending?.last_error).toMatch(/^vault unavailable: x+$/);
    expect(pending?.last_error).toHaveLength(200);
    expect(await count(env, 'users', "user_id = 'u-alice' AND deleted_at IS NOT NULL")).toBe(1);
    expect(await count(env, 'devices', "user_id = 'u-alice' AND revoked_by = 'account-deletion'")).toBe(2);
    expect(await count(env, 'devices', "user_id = 'u-alice' AND revoked_at IS NULL")).toBe(0);
    expect(await getActiveGrant(rc, 100)).toBeNull();
    expect(await getPendingAttempt(rc, 100)).toBeNull();
    expect(await verifyDeviceToken(rc, alice.token)).toEqual({ ok: false, error: 'account_deleted' });

    fail = false;
    deps.clock.advance(3_600_000);
    const done = await runDeletionJob(rc, 'u-alice');
    expect(done).toMatchObject({ completed_at: deps.now(), holders_pending: '[]', attempts: 1 });
    expect(await count(env, 'users', "user_id = 'u-alice'")).toBe(0);
    expect(await runDeletionJob(rc, 'u-alice')).toMatchObject({ completed_at: deps.now() });
  });

  it('a holder named in the job but not bound in this deployment stays pending with last_error', async () => {
    const { env, deps, rc } = await setup();
    await env.DB.prepare('INSERT INTO deletion_jobs (user_id, requested_at, holders_pending) VALUES (?, ?, ?)').bind('u-alice', deps.now(), '["vault"]').run();
    expect(await runDeletionJob(rc, 'u-alice')).toMatchObject({ holders_pending: '["vault"]', attempts: 0, last_error: 'holder vault not bound', completed_at: null });
    expect(await count(env, 'users', "user_id = 'u-alice'")).toBe(1);
    expect(await runDeletionJob(rc, 'nobody')).toBeNull();
  });

  it('a repeated request returns the original timestamp and an expired grant may still delete', async () => {
    const vault: AccountDataHolder = {
      async deleteAccountData() {
        throw new Error('still down');
      },
    };
    const { env, deps, ctx, rc, alice, alice2 } = await setup(vault);
    const t0 = deps.now();
    expect(await (await del(env, deps, ctx, alice.token)).json()).toEqual({ deletionRequestedAt: t0 });
    await ctx.drain();
    deps.clock.advance(60_000);
    // Every device token of a deleting account is refused, so the HTTP repeat is 401 account_deleted...
    const again = await del(env, deps, ctx, alice2.token);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: 'account_deleted' });
    // ...and requestDeletion itself is idempotent: the original timestamp is kept.
    expect(await requestDeletion(rc, 'u-alice')).toBe(t0);
    expect(await rc.env.DB.prepare('SELECT deleted_at FROM users WHERE user_id = ?').bind('u-alice').first<number>('deleted_at')).toBe(t0);
    await runDeletionJob(rc, 'u-alice');
    expect(await job(env, 'u-alice')).toMatchObject({ requested_at: t0, attempts: 2, last_error: 'still down' });

    const expiredEnv = makeEnv();
    const expiredRc = makeRc({ env: expiredEnv, deps, ctx });
    await expiredEnv.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u-old', 300, 'old', deps.now()).run();
    await addGrant(expiredRc, 300, 'old', { expiresAt: deps.now() - 1 }, 'admin-add');
    const old = await mintDevice(expiredRc, 'u-old', 'linux-x64', ENV_A);
    expect((await call('GET', '/v1/devices', { env: expiredEnv, deps, headers: { Authorization: `Bearer ${old.token}` } })).status).toBe(403);
    expect((await del(expiredEnv, deps, ctx, old.token)).status).toBe(202);
  });

  it('unauthenticated DELETE /v1/account is 401', async () => {
    const { env, deps, ctx } = await setup();
    expect((await call('DELETE', '/v1/account', { env, deps, ctx })).status).toBe(401);
    expect(await count(env, 'deletion_jobs')).toBe(0);
  });
});
