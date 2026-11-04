/**
 * Webhook events the overdeck.ai directory inbox held for this machine (PRD PAN-2356 WI-19,
 * D-2356-15, D-2356-17).
 *
 * Each event arrives sealed to this machine's key. `handleInboxEvent` opens it, refuses one older
 * than 24 h 5 min or more than 5 min in the future, skips an event id it already delivered, finds
 * the trigger that owns the inbox and runs steps 2-6 of the trigger core. The answer tells the
 * directory to forget the event (`ack`) or to send it again later (`nack`).
 *
 * Delivered event ids are kept in `${OVERDECK_HOME}/inbox-delivered.json` (mode 0600, the last
 * 1000 ids within 48 h), so a redelivery after a lost acknowledgement does nothing. Logs name the
 * inbox, the trigger and the outcome, never the body.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { openSealed } from '../anywhere/sealed-box.js';
import type { MachineKeyPair } from '../anywhere/machine-key.js';
import { getOverdeckHome } from '../paths.js';
import { deliverInboxEvent, type TriggerDeliveryDeps } from './deliver.js';

export const INBOX_DELIVERED_FILENAME = 'inbox-delivered.json';
export const INBOX_MAX_AGE_MS = 24 * 3_600_000 + 5 * 60_000;
export const INBOX_MAX_FUTURE_MS = 5 * 60_000;
export const DEDUPE_MAX_IDS = 1_000;
export const DEDUPE_MAX_AGE_MS = 48 * 3_600_000;
const DEFAULT_RETRY_SECONDS = 300;

/** The sealed plaintext (D-2356-15). */
export interface InboxEventPlain {
  v: 1;
  eventId: string;
  inboxId: string;
  receivedAt: number;
  headers: Record<string, string>;
  /** Raw request bytes, base64. */
  body: string;
}

export type InboxAnswer = { kind: 'ack' } | { kind: 'nack'; retryAfterSeconds: number };

/** The sealed event, opened and shape-checked; null when it cannot be read. */
export function openInboxEvent(sealedBase64: string, keyPair: MachineKeyPair): InboxEventPlain | null {
  const opened = openSealed(Buffer.from(sealedBase64, 'base64'), keyPair);
  if (!opened) return null;
  let value: unknown;
  try {
    value = JSON.parse(opened.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const e = value as Record<string, unknown>;
  if (e.v !== 1 || typeof e.eventId !== 'string' || typeof e.inboxId !== 'string' || typeof e.body !== 'string') return null;
  if (typeof e.receivedAt !== 'number' || !Number.isFinite(e.receivedAt)) return null;
  if (typeof e.headers !== 'object' || e.headers === null) return null;
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(e.headers as Record<string, unknown>)) {
    if (typeof headerValue === 'string') headers[name.toLowerCase()] = headerValue;
  }
  return { v: 1, eventId: e.eventId, inboxId: e.inboxId, receivedAt: e.receivedAt, headers, body: e.body };
}

export function isFreshInboxEvent(receivedAt: number, now: number): boolean {
  return receivedAt >= now - INBOX_MAX_AGE_MS && receivedAt <= now + INBOX_MAX_FUTURE_MS;
}

interface DedupeFile {
  v: 1;
  delivered: Array<{ id: string; at: number }>;
}

/** Event ids already delivered, persisted so a restart does not deliver a held event twice. */
export class InboxDedupe {
  private entries: Array<{ id: string; at: number }> | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: () => string = () => join(getOverdeckHome(), INBOX_DELIVERED_FILENAME)) {}

  private async load(): Promise<Array<{ id: string; at: number }>> {
    if (this.entries) return this.entries;
    try {
      const file = JSON.parse(await readFile(this.path(), 'utf8')) as Partial<DedupeFile>;
      this.entries = Array.isArray(file.delivered)
        ? file.delivered.filter((e): e is { id: string; at: number } => typeof e?.id === 'string' && typeof e?.at === 'number')
        : [];
    } catch {
      this.entries = [];
    }
    return this.entries;
  }

  async has(eventId: string): Promise<boolean> {
    return (await this.load()).some((entry) => entry.id === eventId);
  }

  async add(eventId: string, now: number): Promise<void> {
    const kept = (await this.load()).filter((entry) => now - entry.at < DEDUPE_MAX_AGE_MS && entry.id !== eventId);
    kept.push({ id: eventId, at: now });
    this.entries = kept.slice(-DEDUPE_MAX_IDS);
    const body: DedupeFile = { v: 1, delivered: this.entries };
    const write = this.writes.then(async () => {
      const path = this.path();
      const home = join(path, '..');
      await mkdir(home, { recursive: true, mode: 0o700 });
      const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
    });
    this.writes = write.catch(() => undefined);
    await write;
  }
}

export interface InboxEventFrame {
  eventId: string;
  inboxId: string;
  sealed: string;
}

export interface InboxHandlerDeps {
  keyPair(): Promise<MachineKeyPair>;
  delivery: TriggerDeliveryDeps;
  dedupe: InboxDedupe;
}

/** Opens, checks and delivers one held event; the answer for the directory. */
export async function handleInboxEvent(frame: InboxEventFrame, deps: InboxHandlerDeps): Promise<InboxAnswer> {
  const log = deps.delivery.log ?? ((line: string) => console.log(line));
  const plain = openInboxEvent(frame.sealed, await deps.keyPair());
  if (!plain || plain.eventId !== frame.eventId || plain.inboxId !== frame.inboxId) {
    // It can never succeed: forget it.
    log(`[triggers] inbox ${frame.inboxId} unreadable`);
    return { kind: 'ack' };
  }
  if (await deps.dedupe.has(plain.eventId)) return { kind: 'ack' };
  const now = deps.delivery.now();
  if (!isFreshInboxEvent(plain.receivedAt, now)) {
    log(`[triggers] inbox ${plain.inboxId} stale 410`);
    return { kind: 'ack' };
  }
  const record = (await deps.delivery.readTriggers()).find((candidate) => candidate.inbox?.id === plain.inboxId);
  if (!record) {
    log(`[triggers] inbox ${plain.inboxId} not found 404`);
    return { kind: 'ack' };
  }
  const result = await deliverInboxEvent(
    record,
    { headers: plain.headers, rawBody: Buffer.from(plain.body, 'base64'), receivedAt: plain.receivedAt },
    deps.delivery,
  );
  if (result.status >= 200 && result.status < 300) {
    await deps.dedupe.add(plain.eventId, now);
    return { kind: 'ack' };
  }
  if (result.status === 429 || result.status >= 500) {
    const retry = result.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS;
    return { kind: 'nack', retryAfterSeconds: Math.min(3_600, Math.max(60, retry)) };
  }
  // 401, 404, 410, 413 and any other refusal can never succeed on a retry.
  return { kind: 'ack' };
}
