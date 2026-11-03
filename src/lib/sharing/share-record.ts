/**
 * Local share records at `${OVERDECK_HOME}/shared-sessions.json` (PRD PAN-4473 WI-2).
 *
 * The host's durable memory of the Shared Sessions rooms it created: one entry per
 * room, keyed by short code, holding the room's host token. The file is written
 * atomically (temp file in the same directory, then rename) with mode 0600, and
 * writes in this process go through one queue so concurrent changes never lose
 * each other. At most one record exists per (scopeKind, scopeId).
 *
 * A corrupt file is never silently replaced: reading it throws, naming the file and
 * telling the operator to delete it. Error messages never contain a host token.
 *
 * This module imports only Node built-ins and `../paths.js`, like `../account/store.ts`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';

export const SHARED_SESSIONS_FILENAME = 'shared-sessions.json';

export interface ShareRecord {
  scopeKind: 'conversation';
  /** The conversation name. */
  scopeId: string;
  /** `odh_` + 64 lowercase hex. Never leaves this machine except to the share service. */
  hostToken: string;
  joinUrl: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface ShareRecordFile {
  version: 1;
  /** Key = short code. */
  rooms: Record<string, ShareRecord>;
}

const SHORT_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/;
const HOST_TOKEN_RE = /^odh_[0-9a-f]{64}$/;

let writeQueue: Promise<unknown> = Promise.resolve();

/** Absolute path of the share record file under the current OVERDECK_HOME. */
export function sharedSessionsPath(): string {
  return join(getOverdeckHome(), SHARED_SESSIONS_FILENAME);
}

function unreadable(path: string, reason: string): Error {
  return new Error(`Cannot read ${path}: ${reason}. Delete it to forget local shares.`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseRecords(raw: string, path: string): Record<string, ShareRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser's message can quote file content, so it is not repeated here.
    throw unreadable(path, 'invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw unreadable(path, 'unexpected shape');
  const file = parsed as Record<string, unknown>;
  if (file.version !== 1) throw unreadable(path, 'unsupported version');
  if (typeof file.rooms !== 'object' || file.rooms === null || Array.isArray(file.rooms)) {
    throw unreadable(path, 'unexpected shape');
  }
  const rooms: Record<string, ShareRecord> = {};
  for (const [code, value] of Object.entries(file.rooms as Record<string, unknown>)) {
    if (!SHORT_CODE_RE.test(code)) throw unreadable(path, 'invalid short code');
    if (typeof value !== 'object' || value === null) throw unreadable(path, `room ${code} has an unexpected shape`);
    const entry = value as Record<string, unknown>;
    if (entry.scopeKind !== 'conversation') throw unreadable(path, `room ${code} has an unknown scope kind`);
    if (typeof entry.hostToken !== 'string' || !HOST_TOKEN_RE.test(entry.hostToken)) {
      throw unreadable(path, `room ${code} has a malformed host token`);
    }
    if (!isNonEmptyString(entry.scopeId) || !isNonEmptyString(entry.joinUrl) || !isNonEmptyString(entry.createdAt)) {
      throw unreadable(path, `room ${code} has an unexpected shape`);
    }
    rooms[code] = {
      scopeKind: 'conversation',
      scopeId: entry.scopeId,
      hostToken: entry.hostToken,
      joinUrl: entry.joinUrl,
      createdAt: entry.createdAt,
    };
  }
  return rooms;
}

/**
 * Read every share record. Returns `{}` when the file does not exist. Throws an
 * Error naming the file path when it exists but is unreadable or malformed.
 */
export async function readShareRecords(): Promise<Record<string, ShareRecord>> {
  const path = sharedSessionsPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw unreadable(path, (error as Error).message);
  }
  return parseRecords(raw, path);
}

async function writeShareRecords(rooms: Record<string, ShareRecord>): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${SHARED_SESSIONS_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: ShareRecordFile = { version: 1, rooms };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, sharedSessionsPath());
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Serialize read-modify-write cycles within this process. */
function mutate<T>(change: (rooms: Record<string, ShareRecord>) => { rooms: Record<string, ShareRecord> | null; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const { rooms, result } = change(await readShareRecords());
    if (rooms !== null) await writeShareRecords(rooms);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/**
 * Write or replace the record for `shortCode`. Throws when a different short code
 * already holds the same (scopeKind, scopeId).
 */
export async function putShareRecord(shortCode: string, record: ShareRecord): Promise<void> {
  await mutate((rooms) => {
    for (const [code, existing] of Object.entries(rooms)) {
      if (code !== shortCode && existing.scopeKind === record.scopeKind && existing.scopeId === record.scopeId) {
        throw new Error(`A share already exists for conversation ${record.scopeId} (${code})`);
      }
    }
    return { rooms: { ...rooms, [shortCode]: record }, result: undefined };
  });
}

/** Remove the record for `shortCode`. Returns `false` when there was none. */
export async function removeShareRecord(shortCode: string): Promise<boolean> {
  return mutate((rooms) => {
    if (!(shortCode in rooms)) return { rooms: null, result: false };
    const next = { ...rooms };
    delete next[shortCode];
    return { rooms: next, result: true };
  });
}

/** Find the record for one scope, or `null`. */
export async function findShareRecordByScope(
  scopeKind: 'conversation',
  scopeId: string,
): Promise<{ shortCode: string; record: ShareRecord } | null> {
  const rooms = await readShareRecords();
  for (const [shortCode, record] of Object.entries(rooms)) {
    if (record.scopeKind === scopeKind && record.scopeId === scopeId) return { shortCode, record };
  }
  return null;
}
