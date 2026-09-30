/**
 * Access-token registry (PAN-2351 W1, adopted by PAN-3762 for device sessions).
 *
 * The single read/write door for `${OVERDECK_HOME}/access-tokens.json`. Each
 * record is one revocable credential: a paired device (`kind: 'device'`) or an
 * API token (`kind: 'token'`). A record with no `kind` is a device. Tokens are
 * `odk_<64 hex>`; only their SHA-256 hex digest is stored, and comparison is
 * constant-time.
 *
 * Every record carries scopes from `ACCESS_TOKEN_SCOPES`. `admin` satisfies
 * every scope, `operate` satisfies `tell`, and the three `read:*` scopes are
 * independent grants (`scopeSatisfies`). Pairing always grants `['admin']`.
 * `createAccessToken` accepts only known scopes, but a record read from the
 * file may hold any string: an unknown scope parses and satisfies nothing.
 *
 * The file is written atomically (temp file in the same directory, then
 * rename) with mode 0600. It is a file, not a database table, because the
 * SQLite database is a rebuildable cache and credentials must survive a
 * rebuild.
 *
 * Verification is synchronous against an in-memory snapshot, because
 * `hasDashboardAuthHeaders` is synchronous. The dashboard loads the snapshot at
 * boot and refreshes it every 5 s (`startAccessTokenRefresh`), so a revocation
 * written by another process is honored within 5 s; in-process create/revoke
 * update the snapshot immediately. A corrupt or unreadable file means zero
 * valid tokens plus a loud error — never a permissive parse.
 *
 * This module imports only Node built-ins and `./paths.js` so the CLI can load
 * it without the dashboard or Effect runtime layers.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from './paths.js';

export const ACCESS_TOKENS_FILENAME = 'access-tokens.json';
export const ACCESS_TOKEN_PREFIX = 'odk_';
export const ACCESS_TOKEN_REFRESH_MS = 5_000;
const LAST_USED_THROTTLE_MS = 60_000;
const MAX_NAME_LENGTH = 200;

export const ACCESS_TOKEN_SCOPES = ['read:events', 'read:state', 'read:conversations', 'tell', 'operate', 'admin'] as const;
export type AccessTokenScope = (typeof ACCESS_TOKEN_SCOPES)[number];
export type AccessTokenKind = 'device' | 'token';

export interface AccessTokenRecord {
  id: string;
  name: string;
  scopes: AccessTokenScope[];
  /** SHA-256 hex digest of the plaintext token. */
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt?: string;
  kind?: AccessTokenKind;
}

/** A record as shown to callers: never carries the hash. */
export type PublicAccessTokenRecord = Omit<AccessTokenRecord, 'tokenHash'>;

export type VerifyAccessTokenResult = { ok: true; record: PublicAccessTokenRecord } | { ok: false };

interface RegistryFile {
  v: 1;
  tokens: AccessTokenRecord[];
}

interface Snapshot {
  records: AccessTokenRecord[];
  /** `${mtimeMs}:${size}` of the file the records came from; null when absent. */
  fingerprint: string | null;
  error: Error | null;
}

let snapshot: Snapshot = { records: [], fingerprint: null, error: null };
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
const lastUsedWrittenAt = new Map<string, number>();

/** True when `granted` covers `required`: admin covers all, operate covers tell. */
export function scopeSatisfies(granted: readonly string[], required: AccessTokenScope): boolean {
  if (granted.includes('admin') || granted.includes(required)) return true;
  return required === 'tell' && granted.includes('operate');
}

function isAccessTokenScope(value: string): value is AccessTokenScope {
  return (ACCESS_TOKEN_SCOPES as readonly string[]).includes(value);
}

/** Parse `read:events,tell` (or an array). Throws naming the first unknown scope; rejects an empty set. */
export function parseAccessTokenScopes(input: string | readonly string[]): AccessTokenScope[] {
  const entries = (typeof input === 'string' ? input.split(',') : input).map((scope) => scope.trim()).filter((scope) => scope !== '');
  const scopes: AccessTokenScope[] = [];
  for (const entry of entries) {
    if (!isAccessTokenScope(entry)) {
      throw new Error(`Unknown access-token scope "${entry}"; expected one of ${ACCESS_TOKEN_SCOPES.join(', ')}`);
    }
    if (!scopes.includes(entry)) scopes.push(entry);
  }
  if (scopes.length === 0) {
    throw new Error(`Access-token scopes must name at least one of ${ACCESS_TOKEN_SCOPES.join(', ')}`);
  }
  return scopes;
}

/** Absolute path of the registry under the current OVERDECK_HOME. */
export function accessTokensPath(): string {
  return join(getOverdeckHome(), ACCESS_TOKENS_FILENAME);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toPublic(record: AccessTokenRecord): PublicAccessTokenRecord {
  const { tokenHash: _hash, ...rest } = record;
  return { ...rest, scopes: [...rest.scopes] };
}

function isRecord(value: unknown): value is AccessTokenRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    Array.isArray(r.scopes) &&
    r.scopes.every((scope) => typeof scope === 'string') &&
    typeof r.tokenHash === 'string' &&
    /^[0-9a-f]{64}$/.test(r.tokenHash) &&
    typeof r.createdAt === 'string' &&
    (r.lastUsedAt === null || typeof r.lastUsedAt === 'string') &&
    (r.revokedAt === undefined || typeof r.revokedAt === 'string') &&
    (r.kind === undefined || r.kind === 'device' || r.kind === 'token')
  );
}

function parseRegistry(raw: string, path: string): AccessTokenRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Access-token registry ${path} is not valid JSON: ${(error as Error).message}`);
  }
  const file = parsed as Partial<RegistryFile> | null;
  if (typeof file !== 'object' || file === null || file.v !== 1 || !Array.isArray(file.tokens) || !file.tokens.every(isRecord)) {
    throw new Error(`Access-token registry ${path} has an unexpected shape`);
  }
  return file.tokens;
}

async function fingerprintOf(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return `${info.mtimeMs}:${info.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot stat access-token registry ${path}: ${(error as Error).message}`);
  }
}

/** Read the file fresh. Absent → empty; unreadable or corrupt → throws naming the path. */
async function readRegistry(path: string): Promise<AccessTokenRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read access-token registry ${path}: ${(error as Error).message}`);
  }
  return parseRegistry(raw, path);
}

async function writeRegistry(path: string, records: AccessTokenRecord[]): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${ACCESS_TOKENS_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: RegistryFile = { v: 1, tokens: records };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  snapshot = { records, fingerprint: await fingerprintOf(path), error: null };
}

/** Serialize read-modify-write cycles within this process. */
function mutate<T>(change: (records: AccessTokenRecord[]) => { records: AccessTokenRecord[]; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = accessTokensPath();
    const { records, result } = change(await readRegistry(path));
    await writeRegistry(path, records);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

function failSnapshot(error: Error): void {
  const changed = snapshot.error?.message !== error.message;
  snapshot = { records: [], fingerprint: null, error };
  if (changed) {
    console.error(`[access-tokens] ${error.message}. No access token is accepted until the file is repaired.`);
  }
}

/**
 * Reload the snapshot when the file changed. Rejects with an Error naming the
 * file when it is unreadable or corrupt; the snapshot then accepts no token.
 */
export async function refreshAccessTokens(): Promise<void> {
  const path = accessTokensPath();
  try {
    const fingerprint = await fingerprintOf(path);
    if (snapshot.error === null && fingerprint === snapshot.fingerprint) return;
    const records = await readRegistry(path);
    snapshot = { records, fingerprint, error: null };
  } catch (error) {
    failSnapshot(error as Error);
    throw error;
  }
}

/** Refresh the snapshot every 5 s until stopped. Idempotent. */
export function startAccessTokenRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void refreshAccessTokens().catch(() => undefined);
  }, ACCESS_TOKEN_REFRESH_MS);
  refreshTimer.unref?.();
}

export function stopAccessTokenRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

export async function createAccessToken(input: {
  name: string;
  scopes: AccessTokenScope[];
  kind?: AccessTokenKind;
}): Promise<{ token: string; record: PublicAccessTokenRecord }> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    throw new Error(`Access-token name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`);
  }
  let scopes: AccessTokenScope[];
  try {
    scopes = parseAccessTokenScopes(input.scopes);
  } catch (error) {
    throw new Error(`Invalid access-token scopes: ${(error as Error).message}`);
  }
  const token = `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
  const record: AccessTokenRecord = {
    id: randomUUID(),
    name,
    scopes,
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    ...(input.kind ? { kind: input.kind } : {}),
  };
  await mutate((records) => ({ records: [...records, record], result: undefined }));
  return { token, record: toPublic(record) };
}

/** All records, revoked included, freshly read from the file. */
export async function listAccessTokens(): Promise<PublicAccessTokenRecord[]> {
  return (await readRegistry(accessTokensPath())).map(toPublic);
}

/** Revoke by id. Returns the revoked record, or null when no record has that id. */
export async function revokeAccessToken(id: string): Promise<PublicAccessTokenRecord | null> {
  return mutate((records) => {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return { records, result: null };
    const existing = records[index]!;
    const revoked = existing.revokedAt ? existing : { ...existing, revokedAt: new Date().toISOString() };
    const next = records.slice();
    next[index] = revoked;
    return { records: next, result: toPublic(revoked) };
  });
}

function recordLastUsed(record: AccessTokenRecord): void {
  const now = Date.now();
  const last = lastUsedWrittenAt.get(record.id);
  if (last !== undefined && now - last < LAST_USED_THROTTLE_MS) return;
  lastUsedWrittenAt.set(record.id, now);
  const at = new Date(now).toISOString();
  record.lastUsedAt = at;
  void mutate((records) => ({
    records: records.map((r) => (r.id === record.id ? { ...r, lastUsedAt: at } : r)),
    result: undefined,
  })).catch((error: unknown) => {
    console.error(`[access-tokens] could not record lastUsedAt: ${(error as Error).message}`);
  });
}

/**
 * Check a presented token against the snapshot. Synchronous and constant-time
 * per record. A revoked token, an unknown token, or a corrupt registry fails.
 */
export function verifyAccessToken(presented: string | null | undefined): VerifyAccessTokenResult {
  if (!presented || !presented.startsWith(ACCESS_TOKEN_PREFIX) || snapshot.error) return { ok: false };
  const presentedHash = Buffer.from(hashToken(presented), 'hex');
  let match: AccessTokenRecord | null = null;
  for (const record of snapshot.records) {
    const stored = Buffer.from(record.tokenHash, 'hex');
    if (stored.length === presentedHash.length && timingSafeEqual(stored, presentedHash) && !record.revokedAt) {
      match = record;
    }
  }
  if (!match) return { ok: false };
  recordLastUsed(match);
  return { ok: true, record: toPublic(match) };
}

/** Test-only: resolve once every queued registry write (including lastUsedAt) has settled. */
export async function _settleAccessTokenWritesForTests(): Promise<void> {
  await writeQueue;
}

/** Test-only: drop the snapshot, timer and throttle state. */
export function _resetAccessTokensForTests(): void {
  stopAccessTokenRefresh();
  snapshot = { records: [], fingerprint: null, error: null };
  writeQueue = Promise.resolve();
  lastUsedWrittenAt.clear();
}
