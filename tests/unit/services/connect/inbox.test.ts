import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { INBOX_BODY_MAX_BYTES, INBOX_HOLD_MS } from '../../../../packages/contracts/src/connect.ts';
import type { AccountBinding } from '../../../../services/connect/src/account.ts';
import type { Deps, Env } from '../../../../services/connect/src/env.ts';
import { HDR_INBOX_HEADERS, HDR_INBOX_SECRET_HASH } from '../../../../services/connect/src/env.ts';
import { InboxStore, MAX_PENDING_PER_INBOX, sha256Hex } from '../../../../services/connect/src/inbox.ts';
import type { InboxSql } from '../../../../services/connect/src/inbox.ts';
import { EMPTY_DIRECTORY, reduce } from '../../../../services/connect/src/directory-state.ts';
import { handle } from '../../../../services/connect/src/routes.ts';
import { openSealed } from '../../../../src/lib/anywhere/sealed-box.ts';

interface Sodium {
  crypto_box_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
}
const sodium = createRequire(import.meta.url)('sodium-native') as Sodium;

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const ENV_A = '00000000-0000-4000-8000-000000000001';

/** Durable Object `SqlStorage.exec` over node:sqlite; ArrayBuffer bindings become Uint8Array. */
function sqlShim(): InboxSql & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query: string, ...bindings: unknown[]) {
      const args = bindings.map((b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : b)) as Array<string | number | null | Uint8Array>;
      const statement = db.prepare(query);
      const isRead = /^\s*SELECT/i.test(query);
      const rows = isRead ? statement.all(...args) : (statement.run(...args), []);
      return { toArray: () => rows as never[] };
    },
  };
}

function keyPair() {
  const publicKey = Buffer.alloc(32);
  const secretKey = Buffer.alloc(32);
  sodium.crypto_box_seed_keypair(publicKey, secretKey, Buffer.alloc(32, 5));
  return { publicKey, secretKey };
}

function setup() {
  let now = NOW;
  let seq = 0;
  const sql = sqlShim();
  const store = new InboxStore(sql, {
    now: () => now,
    randomBytes: (n) => {
      seq++;
      return Uint8Array.from({ length: n }, (_, i) => (seq * 31 + i) & 0xff);
    },
    randomUUID: () => `00000000-0000-4000-8000-${(seq++).toString(16).padStart(12, '0')}`,
  });
  const keys = keyPair();
  return {
    sql,
    store,
    keys,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    intake: (secretHash: string, body = 'hello', plan: 'tester' | 'free' = 'tester') =>
      store.intake({
        secretHash,
        headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
        body: new TextEncoder().encode(body),
        plan,
        publicKeyHexOf: (env) => (env === ENV_A ? keys.publicKey.toString('hex') : null),
      }),
  };
}

describe('inbox store (PAN-2356 WI-8)', () => {
  it('stores only the sealed event, which the machine opens to the original body and kept headers', async () => {
    const t = setup();
    const { inboxId, secret } = await t.store.create(ENV_A);
    expect(inboxId).toMatch(/^ib_[0-9a-f]{16}$/);
    expect(secret).toMatch(/^[0-9a-f]{32}$/);
    const result = t.intake(await sha256Hex(secret), '{"marker":"PLAINTEXT-MARKER-2356"}');
    expect(result.status).toBe(202);

    const dump = JSON.stringify(t.sql.db.prepare('SELECT * FROM inbox_events').all(), (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v));
    expect(dump).not.toContain('PLAINTEXT-MARKER-2356');
    expect(JSON.stringify(t.sql.db.prepare('SELECT * FROM inboxes').all())).not.toContain(secret);

    const [pending] = t.store.pendingFor(ENV_A);
    const opened = openSealed(Buffer.from(pending!.sealed), t.keys);
    const event = JSON.parse(opened!.toString('utf8')) as { v: number; inboxId: string; receivedAt: number; headers: Record<string, string>; body: string };
    expect(event).toMatchObject({ v: 1, inboxId, receivedAt: NOW, headers: { 'content-type': 'application/json', 'x-github-event': 'push' } });
    expect(Buffer.from(event.body, 'base64').toString('utf8')).toBe('{"marker":"PLAINTEXT-MARKER-2356"}');
  });

  it('removes an unacknowledged event 24 hours and 1 ms after it arrived', async () => {
    const t = setup();
    const { secret } = await t.store.create(ENV_A);
    t.intake(await sha256Hex(secret));
    expect(t.store.nextAlarm()).toBe(NOW + INBOX_HOLD_MS);
    t.advance(INBOX_HOLD_MS - 1);
    t.store.expire(t.now());
    expect(t.store.pendingFor(ENV_A)).toHaveLength(1);
    t.advance(2);
    t.store.expire(t.now());
    expect(t.store.pendingFor(ENV_A)).toHaveLength(0);
    expect(t.store.nextAlarm()).toBeNull();
  });

  it('re-sends a nacked event after max(retryAfter, 60 s)', async () => {
    const t = setup();
    const { secret } = await t.store.create(ENV_A);
    const result = t.intake(await sha256Hex(secret));
    const eventId = result.status === 202 ? result.event.eventId : '';
    t.store.markSent([eventId]);
    t.store.nack(eventId, ENV_A, 60);
    expect(t.store.dueRetries(t.now() + 59_999)).toEqual([]);
    expect(t.store.nextAlarm()).toBe(NOW + 60_000);
    expect(t.store.dueRetries(t.now() + 60_000).map((e) => e.eventId)).toEqual([eventId]);
    t.store.nack(eventId, ENV_A, 600);
    expect(t.store.nextAlarm()).toBe(NOW + 600_000);
    t.store.ack(eventId, ENV_A);
    expect(t.store.pendingFor(ENV_A)).toEqual([]);
  });

  it('refuses the free plan with 403 and the 201st pending event with 429', async () => {
    const t = setup();
    const { secret } = await t.store.create(ENV_A);
    const hash = await sha256Hex(secret);
    expect(t.intake(hash, 'x', 'free')).toEqual({ status: 403, body: { error: 'the inbox needs the Anywhere plan' } });
    for (let i = 0; i < MAX_PENDING_PER_INBOX; i++) expect(t.intake(hash).status).toBe(202);
    expect(t.intake(hash)).toEqual({ status: 429, body: { error: 'inbox full' }, retryAfter: 3600 });
  });

  it('answers a wrong secret with 404', async () => {
    const t = setup();
    await t.store.create(ENV_A);
    expect(t.intake(await sha256Hex('0'.repeat(32)))).toEqual({ status: 404, body: { error: 'not found' } });
  });

  it('deletes only the owner machine inbox, and forget deletes its events', async () => {
    const t = setup();
    const { inboxId, secret } = await t.store.create(ENV_A);
    t.intake(await sha256Hex(secret));
    expect(t.store.delete(inboxId, '00000000-0000-4000-8000-000000000002')).toBe(false);
    t.store.deleteForMachine(ENV_A);
    expect(t.store.pendingFor(ENV_A)).toEqual([]);
    expect(t.intake(await sha256Hex(secret)).status).toBe(404);
  });
});

describe('inbox-create in the reducer', () => {
  it('refuses the free plan with plan_required', () => {
    const state = { ...EMPTY_DIRECTORY, plan: 'free' as const };
    const { effects } = reduce(
      state,
      { kind: 'frame', registeredAs: ENV_A, frame: { type: 'inbox-create', requestId: 'r1' } },
      { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: 1, turnConfigured: false },
    );
    expect(effects[0]).toMatchObject({ kind: 'send', frame: { type: 'error', code: 'plan_required', requestId: 'r1' } });
  });
});

describe('POST /h/:id (PAN-2356 WI-8)', () => {
  const DO_ID = 'a'.repeat(64);
  const deps: Deps = { now: () => NOW, fetch: () => Promise.reject(new Error('no fetch')), randomBytes: (n) => new Uint8Array(n) };

  function env() {
    const calls: Array<{ headers: Headers; body: Uint8Array }> = [];
    const DIRECTORY = {
      idFromString: (id: string) => {
        if (id !== DO_ID) throw new TypeError('Invalid Durable Object ID');
        return { id };
      },
      get: () => ({
        fetch: async (_url: string, init: RequestInit) => {
          calls.push({ headers: new Headers(init.headers), body: new Uint8Array(init.body as Uint8Array) });
          return new Response(JSON.stringify({ queued: true }), { status: 202 });
        },
      }),
    } as unknown as DurableObjectNamespace;
    return { env: { DIRECTORY, ACCOUNT: {} as AccountBinding, PUBLIC_BASE_URL: 'https://c.test' } satisfies Env, calls };
  }

  const post = (id: string, body: BodyInit, headers: HeadersInit = {}) =>
    new Request(`https://c.test/h/${id}`, { method: 'POST', body, headers });

  it('answers a body of INBOX_BODY_MAX_BYTES + 1 with 413 and accepts exactly the cap', async () => {
    const { env: e, calls } = env();
    const big = await handle(post(`${DO_ID}.${'1'.repeat(32)}`, new Uint8Array(INBOX_BODY_MAX_BYTES + 1)), e, deps);
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'event too large for the directory inbox' });
    const ok = await handle(post(`${DO_ID}.${'1'.repeat(32)}`, new Uint8Array(INBOX_BODY_MAX_BYTES)), e, deps);
    expect(ok.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.byteLength).toBe(INBOX_BODY_MAX_BYTES);
  });

  it('passes only the secret hash and the kept headers to the Durable Object', async () => {
    const { env: e, calls } = env();
    const secret = '2'.repeat(32);
    await handle(post(`${DO_ID}.${secret}`, 'x', { 'X-GitHub-Event': 'push', Cookie: 'c=1', Authorization: 'Bearer t' }), e, deps);
    expect(calls[0]?.headers.get(HDR_INBOX_SECRET_HASH)).toBe(await sha256Hex(secret));
    expect(JSON.parse(calls[0]?.headers.get(HDR_INBOX_HEADERS) ?? '{}')).toEqual({ 'content-type': 'text/plain;charset=UTF-8', 'x-github-event': 'push' });
  });

  it('answers a malformed id and a non-Durable-Object id with the identical 404', async () => {
    const { env: e, calls } = env();
    const malformed = await handle(post('nope', 'x'), e, deps);
    const invalid = await handle(post(`${'b'.repeat(64)}.${'1'.repeat(32)}`, 'x'), e, deps);
    expect(malformed.status).toBe(404);
    expect(invalid.status).toBe(404);
    expect(await malformed.text()).toBe(await invalid.text());
    expect(calls).toEqual([]);
  });
});
