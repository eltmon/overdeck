/**
 * The webhook inbox inside the account's Durable Object (PRD PAN-2356 WI-8, D-20, D-2356-13..18).
 *
 * An inbox is a public URL `<PUBLIC_BASE_URL>/h/<doId>.<secret>` bound to one machine. Each event is
 * sealed to that machine's current public key the moment it arrives; the stored row holds only ids,
 * times, the size and the sealed bytes. The plaintext exists only in `intake`'s memory.
 *
 * Rows wait until the machine acknowledges them or `INBOX_HOLD_MS` passes. `next_attempt_at` is the
 * time a re-send is due after a nack, or NULL while a delivery waits for its answer. A machine that
 * reconnects gets every pending event on its welcome.
 */
import { INBOX_HOLD_MS } from '../../../packages/contracts/src/connect.ts';
import type { ConnectPlan } from '../../../packages/contracts/src/connect.ts';
import { bytesToHex, hexToBytes } from './fingerprint.ts';
import { sealTo } from './seal.ts';

export const MAX_PENDING_PER_INBOX = 200;
export const MAX_SEALED_BYTES_PER_ACCOUNT = 64 * 1024 * 1024;
export const MIN_RETRY_SECONDS = 60;

/** The webhook headers kept in the sealed event (D-2356-15), lower-cased. */
export const KEPT_HEADERS = [
  'content-type',
  'user-agent',
  'x-github-event',
  'x-github-delivery',
  'x-hub-signature-256',
  'stripe-signature',
] as const;

export const INBOX_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inboxes (
    inbox_id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL UNIQUE,
    environment_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inbox_events (
    event_id TEXT PRIMARY KEY,
    inbox_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    size INTEGER NOT NULL,
    next_attempt_at INTEGER,
    sealed BLOB NOT NULL
  )`,
];

/** The part of Durable Object `SqlStorage` the inbox uses; unit tests supply a node:sqlite shim. */
export interface InboxSql {
  exec<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): { toArray(): T[] };
}

export interface InboxDeps {
  now(): number;
  randomBytes(n: number): Uint8Array;
  randomUUID(): string;
}

/** A held event as delivered in an `inbox-event` frame. */
export interface PendingEvent {
  eventId: string;
  inboxId: string;
  environmentId: string;
  receivedAt: number;
  sealed: Uint8Array;
}

export type IntakeResult =
  | { status: 202; body: { queued: true }; event: PendingEvent }
  | { status: 403; body: { error: string } }
  | { status: 404; body: { error: string } }
  | { status: 429; body: { error: string }; retryAfter: number };

export const NOT_FOUND = { error: 'not found' } as const;

interface EventSqlRow {
  event_id: string;
  inbox_id: string;
  environment_id: string;
  received_at: number;
  /** ArrayBuffer from Durable Object SQLite; the node:sqlite test shim may hand back a Uint8Array. */
  sealed: ArrayBuffer;
  [key: string]: SqlStorageValue;
}

export async function sha256Hex(input: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function toBytes(value: ArrayBuffer): Uint8Array {
  return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
}

export class InboxStore {
  constructor(
    private readonly sql: InboxSql,
    private readonly deps: InboxDeps,
  ) {
    for (const statement of INBOX_SCHEMA) sql.exec(statement);
  }

  /** A new inbox for `environmentId`; the secret is returned once and only its hash is stored. */
  async create(environmentId: string): Promise<{ inboxId: string; secret: string }> {
    const inboxId = 'ib_' + bytesToHex(this.deps.randomBytes(8));
    const secret = bytesToHex(this.deps.randomBytes(16));
    this.sql.exec(
      'INSERT INTO inboxes (inbox_id, secret_hash, environment_id, created_at) VALUES (?, ?, ?, ?)',
      inboxId, await sha256Hex(secret), environmentId, this.deps.now(),
    );
    return { inboxId, secret };
  }

  /** Only the owning machine may delete its inbox; pending events go with it. */
  delete(inboxId: string, environmentId: string): boolean {
    const owned = this.sql
      .exec<{ inbox_id: string }>('SELECT inbox_id FROM inboxes WHERE inbox_id = ? AND environment_id = ?', inboxId, environmentId)
      .toArray();
    if (owned.length === 0) return false;
    this.sql.exec('DELETE FROM inbox_events WHERE inbox_id = ?', inboxId);
    this.sql.exec('DELETE FROM inboxes WHERE inbox_id = ?', inboxId);
    return true;
  }

  /** A forgotten machine's inboxes and their events, so nothing waits 24 hours for it. */
  deleteForMachine(environmentId: string): void {
    this.sql.exec('DELETE FROM inbox_events WHERE environment_id = ?', environmentId);
    this.sql.exec('DELETE FROM inboxes WHERE environment_id = ?', environmentId);
  }

  /** Finds the inbox by comparing the presented secret's hash with every stored hash in constant time. */
  private inboxFor(secretHash: string): { inboxId: string; environmentId: string } | null {
    let found: { inboxId: string; environmentId: string } | null = null;
    const rows = this.sql
      .exec<{ inbox_id: string; secret_hash: string; environment_id: string }>('SELECT inbox_id, secret_hash, environment_id FROM inboxes')
      .toArray();
    for (const row of rows) {
      if (timingSafeEqualHex(row.secret_hash, secretHash)) found = { inboxId: row.inbox_id, environmentId: row.environment_id };
    }
    return found;
  }

  /**
   * D-2356-13..15: authenticate the secret, apply the plan and queue caps, seal the event to the
   * owning machine's key and store only the sealed copy.
   */
  intake(input: {
    secretHash: string;
    headers: Record<string, string>;
    body: Uint8Array;
    plan: ConnectPlan | null;
    publicKeyHexOf(environmentId: string): string | null;
  }): IntakeResult {
    const inbox = this.inboxFor(input.secretHash);
    if (!inbox) return { status: 404, body: NOT_FOUND };
    if (input.plan !== 'tester') return { status: 403, body: { error: 'the inbox needs the Anywhere plan' } };
    const publicKeyHex = input.publicKeyHexOf(inbox.environmentId);
    if (!publicKeyHex) return { status: 404, body: NOT_FOUND };

    const pending = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM inbox_events WHERE inbox_id = ?', inbox.inboxId)
      .toArray()[0]?.n ?? 0;
    const sealedBytes = this.sql.exec<{ total: number | null }>('SELECT SUM(size) AS total FROM inbox_events').toArray()[0]?.total ?? 0;

    const eventId = this.deps.randomUUID();
    const receivedAt = this.deps.now();
    const headers: Record<string, string> = {};
    for (const name of KEPT_HEADERS) {
      const value = input.headers[name];
      if (value !== undefined) headers[name] = value;
    }
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ v: 1, eventId, inboxId: inbox.inboxId, receivedAt, headers, body: bytesToBase64(input.body) }),
    );
    const sealed = sealTo(hexToBytes(publicKeyHex), plaintext);
    plaintext.fill(0);

    if (pending >= MAX_PENDING_PER_INBOX || sealedBytes + sealed.byteLength > MAX_SEALED_BYTES_PER_ACCOUNT) {
      return { status: 429, body: { error: 'inbox full' }, retryAfter: 3600 };
    }
    this.sql.exec(
      `INSERT INTO inbox_events (event_id, inbox_id, environment_id, received_at, size, next_attempt_at, sealed)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      eventId, inbox.inboxId, inbox.environmentId, receivedAt, sealed.byteLength,
      // Durable Object SQLite binds a BLOB from an ArrayBuffer.
      sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength),
    );
    return {
      status: 202,
      body: { queued: true },
      event: { eventId, inboxId: inbox.inboxId, environmentId: inbox.environmentId, receivedAt, sealed },
    };
  }

  /** Every held event for a machine, oldest first. */
  pendingFor(environmentId: string): PendingEvent[] {
    return this.sql
      .exec<EventSqlRow>(
        'SELECT event_id, inbox_id, environment_id, received_at, sealed FROM inbox_events WHERE environment_id = ? ORDER BY received_at, event_id',
        environmentId,
      )
      .toArray()
      .map((r) => ({ eventId: r.event_id, inboxId: r.inbox_id, environmentId: r.environment_id, receivedAt: r.received_at, sealed: toBytes(r.sealed) }));
  }

  /** Events whose nack delay has passed, oldest first. */
  dueRetries(now: number): PendingEvent[] {
    return this.sql
      .exec<EventSqlRow>(
        `SELECT event_id, inbox_id, environment_id, received_at, sealed FROM inbox_events
         WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= ? ORDER BY received_at, event_id`,
        now,
      )
      .toArray()
      .map((r) => ({ eventId: r.event_id, inboxId: r.inbox_id, environmentId: r.environment_id, receivedAt: r.received_at, sealed: toBytes(r.sealed) }));
  }

  /** Marks events as sent and waiting for an answer. */
  markSent(eventIds: readonly string[]): void {
    for (const id of eventIds) this.sql.exec('UPDATE inbox_events SET next_attempt_at = NULL WHERE event_id = ?', id);
  }

  ack(eventId: string, environmentId: string): void {
    this.sql.exec('DELETE FROM inbox_events WHERE event_id = ? AND environment_id = ?', eventId, environmentId);
  }

  /** D-2356-17: the directory re-sends at `max(retryAfter, 60 s)`. */
  nack(eventId: string, environmentId: string, retryAfterSeconds: number): void {
    const at = this.deps.now() + Math.max(retryAfterSeconds, MIN_RETRY_SECONDS) * 1000;
    this.sql.exec('UPDATE inbox_events SET next_attempt_at = ? WHERE event_id = ? AND environment_id = ?', at, eventId, environmentId);
  }

  /** D-2356-18: deletes every event held for `INBOX_HOLD_MS` or longer. */
  expire(now: number): void {
    this.sql.exec('DELETE FROM inbox_events WHERE received_at + ? <= ?', INBOX_HOLD_MS, now);
  }

  /** When the alarm should next fire: the oldest expiry or the earliest due retry; null when nothing waits. */
  nextAlarm(): number | null {
    const row = this.sql
      .exec<{ oldest: number | null; retry: number | null }>(
        'SELECT MIN(received_at) AS oldest, MIN(next_attempt_at) AS retry FROM inbox_events',
      )
      .toArray()[0];
    const times = [row?.oldest == null ? null : row.oldest + INBOX_HOLD_MS, row?.retry ?? null].filter((t): t is number => t !== null);
    return times.length === 0 ? null : Math.min(...times);
  }
}
