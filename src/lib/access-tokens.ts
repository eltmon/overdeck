/**
 * Access-token registry (PAN-2351 W1, adopted by PAN-3762 for device sessions).
 *
 * The single read/write door for `${OVERDECK_HOME}/access-tokens.json`. Each
 * record is one revocable credential: a paired device (`kind: 'device'`), an
 * API token (`kind: 'token'`) or a linked machine (`kind: 'machine'`, PAN-4645).
 * A record with no `kind` is a device. Tokens are `odk_<64 hex>`; only their
 * SHA-256 hex digest is stored, and comparison is constant-time.
 *
 * Every record carries scopes from `ACCESS_TOKEN_SCOPES`. `admin` satisfies
 * every scope, `operate` satisfies `tell`, and the `read:*` scopes and
 * `approve` (answering blocking prompts, PAN-4649) are independent grants
 * (`scopeSatisfies`). Pairing always grants `['admin']`.
 * `createAccessToken` accepts only known scopes, but a record read from the
 * file may hold any string: an unknown scope parses and satisfies nothing.
 *
 * A `machine` record is bound to the peer's machine key (`machineKey`, 64 hex)
 * and names the peer environment and the link's access level. It never holds
 * `admin` (FR-7) and authenticates only inside a secure channel whose remote
 * key equals `machineKey` (`routes/dashboard-auth.ts`, D-4645-9). A `machine`
 * record missing any of those fields makes the file corrupt, so a downgrade to
 * a version without this kind refuses every token until links are removed (H4).
 *
 * A `phone` record (PAN-4835) is bound to the phone app's link key
 * (`phoneKey`, 64 hex) and its directory client id (`clientId`, a UUID v4), and
 * may carry a push key (`pushKey`, 64 hex) once the app sends one. It always
 * carries `PHONE_TOKEN_SCOPES` and never `admin` or `forward`, and
 * authenticates only inside a secure channel whose remote key equals
 * `phoneKey`. A `phone` record missing `phoneKey` or `clientId` makes the file
 * corrupt, exactly like an incomplete `machine` record.
 *
 * An agent token (PAN-4927) is a `token` record that carries `agentId` (an
 * agent id or a conversation name), `agentKind` and `role`. Those fields are
 * valid only on `kind: 'token'` and only all together; on any other kind they
 * make the file corrupt. An agent token never carries `admin` or `forward`.
 * An OAuth token (PAN-4945) is a `token` record with `oauthClientId`,
 * `oauthFamilyId` and `expiresAt`, under the same all-or-none rule and never
 * with the agent fields; it stops verifying at `expiresAt` and never carries
 * `admin`, `forward`, `read:settings`, `read:costs` or `read:events`.
 * A CLI process has an empty snapshot, so `readActiveAccessTokenRecord`,
 * `revokeAccessTokensMatching` and `pruneEndedAccessTokens` read the file fresh.
 *
 * `onAccessTokensRevoked` tells the dashboard when a record was revoked or
 * vanished, whether by this process or by another one seen at the next refresh
 * (D-4645-16), so live sockets of that record can be closed.
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
 * The record shape and its validator live in the leaf `./access-token-records.js`.
 * This module imports only Node built-ins, that leaf and `./paths.js` so the CLI
 * can load it without the dashboard or Effect runtime layers.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  agentFieldsValid,
  type AccessTokenKind,
  type AccessTokenRecord,
  type AccessTokenScope,
  type MachineAccess,
  ACCESS_TOKEN_SCOPES,
  isMachineAccess,
  isRecord,
  MACHINE_ACCESS_LEVELS,
  OAUTH_REFRESH_WINDOW_MS,
  oauthFieldsValid,
  MACHINE_KEY_HEX,
  UUID_V4,
} from './access-token-records.js';
import { getOverdeckHome } from './paths.js';

export {
  ACCESS_TOKEN_SCOPES,
  MACHINE_ACCESS_LEVELS,
  type AccessTokenKind,
  type AccessTokenRecord,
  type AccessTokenScope,
  type MachineAccess,
} from './access-token-records.js';

export const ACCESS_TOKENS_FILENAME = 'access-tokens.json';
export const ACCESS_TOKEN_PREFIX = 'odk_';
export const ACCESS_TOKEN_REFRESH_MS = 5_000;
const LAST_USED_THROTTLE_MS = 60_000;
const MAX_NAME_LENGTH = 200;

/** The scopes a `machine` token carries (FR-7): never `admin`; `forward` only on operator-level links. */
export function MACHINE_TOKEN_SCOPES(access: MachineAccess): AccessTokenScope[] {
  const scopes: AccessTokenScope[] = ['read:events', 'read:state', 'read:conversations', 'read:costs', 'read:settings', 'tell', 'operate'];
  // Operator-level links answer the other machine's prompts (`approve`, PAN-4649) and forward; fenced links do neither.
  return access === 'operator' ? [...scopes, 'approve', 'forward'] : scopes;
}

/** The scopes a `phone` token carries (PAN-4823 NFR-4): a linked machine's operator scopes without `forward`. */
export const PHONE_TOKEN_SCOPES: readonly AccessTokenScope[] = ['read:events', 'read:state', 'read:conversations', 'read:costs', 'read:settings', 'tell', 'operate', 'approve'];

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
const revokedListeners = new Set<(record: PublicAccessTokenRecord) => void>();

/**
 * Be told when a record is revoked or disappears: by `revokeAccessToken` in
 * this process, or by another process whose write the next refresh sees
 * (D-4645-16). Returns the unsubscribe function. Listener errors are logged,
 * never propagated.
 */
export function onAccessTokensRevoked(listener: (record: PublicAccessTokenRecord) => void): () => void {
  revokedListeners.add(listener);
  return () => {
    revokedListeners.delete(listener);
  };
}

function fireRevoked(records: AccessTokenRecord[]): void {
  for (const record of records) {
    for (const listener of revokedListeners) {
      try {
        listener(toPublic(record));
      } catch (error) {
        console.error(`[access-tokens] revocation listener failed for ${record.id}: ${(error as Error).message}`);
      }
    }
  }
}

/** Records active in `previous` that are revoked or missing in `next`. */
function newlyRevoked(previous: AccessTokenRecord[], next: AccessTokenRecord[]): AccessTokenRecord[] {
  const byId = new Map(next.map((record) => [record.id, record] as const));
  return previous.filter((record) => !record.revokedAt && (byId.get(record.id)?.revokedAt !== undefined || !byId.has(record.id)));
}

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

/** Serialize read-modify-write cycles within this process. `write: false` skips the write. */
function mutate<T>(change: (records: AccessTokenRecord[]) => { records: AccessTokenRecord[]; result: T; write?: false }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = accessTokensPath();
    const { records, result, write } = change(await readRegistry(path));
    if (write !== false) await writeRegistry(path, records);
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
    const revoked = newlyRevoked(snapshot.records, records);
    snapshot = { records, fingerprint, error: null };
    fireRevoked(revoked);
  } catch (error) {
    // A corrupt file accepts no new request, but there is no new snapshot to
    // diff against, so live sockets are left alone rather than mass-closed on
    // what could be a transient read error.
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

export interface CreateAccessTokenInput {
  name: string;
  scopes: AccessTokenScope[];
  kind?: AccessTokenKind;
  /** Required for `kind: 'machine'`: the peer's machine public key, 64 lowercase hex. */
  machineKey?: string;
  /** Required for `kind: 'machine'`. */
  environmentId?: string;
  /** Required for `kind: 'machine'`. */
  access?: MachineAccess;
  /** Required for `kind: 'phone'`: the phone's link public key, 64 lowercase hex. */
  phoneKey?: string;
  /** Required for `kind: 'phone'`: the phone app's directory client id, a UUID v4. */
  clientId?: string;
  /** Optional for `kind: 'phone'`: the phone's push public key, 64 lowercase hex. */
  pushKey?: string;
  /** `token` only (PAN-4927 D-6): the managed agent this token belongs to — an agent id or a conversation name. */
  agentId?: string;
  /** `token` only: what `agentId` names. */
  agentKind?: 'agent' | 'conversation';
  /** `token` only: the agent's role, or 'conversation'. */
  role?: string;
  /** `token` only (PAN-4945), all three or none: the OAuth client, its sign-in (family) and the expiry (ISO 8601). */
  oauthClientId?: string;
  oauthFamilyId?: string;
  expiresAt?: string;
}

const OAUTH_FORBIDDEN_SCOPES: readonly AccessTokenScope[] = ['admin', 'forward', 'read:settings', 'read:costs', 'read:events'];

export async function createAccessToken(input: CreateAccessTokenInput): Promise<{ token: string; record: PublicAccessTokenRecord }> {
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
  let binding: Pick<AccessTokenRecord, 'machineKey' | 'environmentId' | 'access' | 'phoneKey' | 'clientId' | 'pushKey'> = {};
  if (input.kind === 'machine') {
    if (typeof input.machineKey !== 'string' || !MACHINE_KEY_HEX.test(input.machineKey)) {
      throw new Error('A machine token needs machineKey: 64 lowercase hex characters');
    }
    if (typeof input.environmentId !== 'string' || input.environmentId === '') {
      throw new Error('A machine token needs the peer environmentId');
    }
    if (!isMachineAccess(input.access)) {
      throw new Error(`A machine token needs access: one of ${MACHINE_ACCESS_LEVELS.join(', ')}`);
    }
    if (scopes.includes('admin')) {
      throw new Error('A machine token never carries admin (PAN-4645 FR-7)');
    }
    if (input.phoneKey !== undefined || input.clientId !== undefined || input.pushKey !== undefined) {
      throw new Error('phoneKey, clientId and pushKey belong to kind: phone only');
    }
    binding = { machineKey: input.machineKey, environmentId: input.environmentId, access: input.access };
  } else if (input.kind === 'phone') {
    if (typeof input.phoneKey !== 'string' || !MACHINE_KEY_HEX.test(input.phoneKey)) {
      throw new Error('A phone token needs phoneKey: 64 lowercase hex characters');
    }
    if (typeof input.clientId !== 'string' || !UUID_V4.test(input.clientId)) {
      throw new Error('A phone token needs clientId: a UUID v4');
    }
    if (input.pushKey !== undefined && (typeof input.pushKey !== 'string' || !MACHINE_KEY_HEX.test(input.pushKey))) {
      throw new Error('A phone token pushKey must be 64 lowercase hex characters');
    }
    if (scopes.includes('admin') || scopes.includes('forward')) {
      throw new Error('A phone token never carries admin or forward (PAN-4823 NFR-4)');
    }
    if (input.machineKey !== undefined || input.environmentId !== undefined || input.access !== undefined) {
      throw new Error('machineKey, environmentId and access belong to kind: machine only');
    }
    binding = { phoneKey: input.phoneKey, clientId: input.clientId, ...(input.pushKey !== undefined ? { pushKey: input.pushKey } : {}) };
  } else if (input.machineKey !== undefined || input.environmentId !== undefined || input.access !== undefined) {
    throw new Error('machineKey, environmentId and access belong to kind: machine only');
  } else if (input.phoneKey !== undefined || input.clientId !== undefined || input.pushKey !== undefined) {
    throw new Error('phoneKey, clientId and pushKey belong to kind: phone only');
  }
  let agent: Pick<AccessTokenRecord, 'agentId' | 'agentKind' | 'role'> = {};
  if (input.agentId !== undefined || input.agentKind !== undefined || input.role !== undefined) {
    if (input.kind !== 'token') {
      throw new Error('agentId, agentKind and role belong to kind: token only');
    }
    if (!agentFieldsValid(input)) {
      throw new Error('An agent token needs agentId, agentKind and role');
    }
    if (scopes.includes('admin') || scopes.includes('forward')) {
      throw new Error('An agent token never carries admin or forward (PAN-4927 D-8)');
    }
    agent = { agentId: input.agentId, agentKind: input.agentKind, role: input.role };
  }
  const oauth = input.oauthClientId !== undefined || input.oauthFamilyId !== undefined || input.expiresAt !== undefined;
  if (oauth) {
    if (input.kind !== 'token' || agent.agentId !== undefined) throw new Error('oauthClientId, oauthFamilyId and expiresAt belong to kind: token only, never with agent fields');
    if (!oauthFieldsValid(input)) throw new Error('An OAuth token needs oauthClientId, oauthFamilyId and expiresAt');
    if (scopes.some((scope) => OAUTH_FORBIDDEN_SCOPES.includes(scope))) {
      throw new Error('An OAuth token never carries admin, forward, read:settings, read:costs or read:events (PAN-4945)');
    }
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
    ...binding,
    ...agent,
    ...(oauth ? { oauthClientId: input.oauthClientId, oauthFamilyId: input.oauthFamilyId, expiresAt: input.expiresAt } : {}),
  };
  await mutate((records) => ({ records: [...records, record], result: undefined }));
  return { token, record: toPublic(record) };
}

/** Not revoked and, for an OAuth token, not past `expiresAt`. */
function isLive(record: AccessTokenRecord, now: number): boolean {
  return !record.revokedAt && !(record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now);
}

/** Active (not revoked, not expired) records of one kind, from the in-memory snapshot. */
export function listActiveRecordsOfKind(kind: AccessTokenKind): PublicAccessTokenRecord[] {
  const now = Date.now();
  return snapshot.records
    .filter((record) => isLive(record, now) && (record.kind ?? 'device') === kind)
    .map(toPublic);
}

/** The active `machine` record bound to `machineKey` (64 hex), from the snapshot; null when none. */
export function findActiveMachineTokenByKey(machineKey: string): PublicAccessTokenRecord | null {
  const match = snapshot.records.find(
    (record) => record.kind === 'machine' && !record.revokedAt && record.machineKey === machineKey,
  );
  return match ? toPublic(match) : null;
}

/** The active `machine` or `phone` record a link-mode initiator key is pinned by (PAN-4835 D-1); null when none. */
export function findActiveChannelTokenByKey(keyHex: string): PublicAccessTokenRecord | null {
  const match = snapshot.records.find((record) => !record.revokedAt
    && ((record.kind === 'machine' && record.machineKey === keyHex) || (record.kind === 'phone' && record.phoneKey === keyHex)));
  return match ? toPublic(match) : null;
}

/** All records, revoked included, freshly read from the file. */
export async function listAccessTokens(): Promise<PublicAccessTokenRecord[]> {
  return (await readRegistry(accessTokensPath())).map(toPublic);
}

/** Revoke by id. Returns the revoked record, or null when no record has that id. */
export async function revokeAccessToken(id: string): Promise<PublicAccessTokenRecord | null> {
  let fire: AccessTokenRecord | null = null;
  const result = await mutate((records) => {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return { records, result: null };
    const existing = records[index]!;
    if (existing.revokedAt) return { records, result: toPublic(existing) };
    const revoked = { ...existing, revokedAt: new Date().toISOString() };
    fire = revoked;
    const next = records.slice();
    next[index] = revoked;
    return { records: next, result: toPublic(revoked) };
  });
  if (fire) fireRevoked([fire]);
  return result;
}

/** The active record whose hash matches `token`, read fresh from the file. Never touches the snapshot or lastUsedAt. Null when absent, revoked, or the file is missing. Throws when the file is corrupt. */
export async function readActiveAccessTokenRecord(token: string): Promise<PublicAccessTokenRecord | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const presentedHash = Buffer.from(hashToken(token), 'hex');
  let match: AccessTokenRecord | null = null;
  for (const record of await readRegistry(accessTokensPath())) {
    const stored = Buffer.from(record.tokenHash, 'hex');
    if (stored.length === presentedHash.length && timingSafeEqual(stored, presentedHash) && !record.revokedAt) {
      match = record;
    }
  }
  return match ? toPublic(match) : null;
}

/** Revoke every active record `match` accepts, in one write. Returns the records it revoked; fires onAccessTokensRevoked for each. */
export async function revokeAccessTokensMatching(match: (record: PublicAccessTokenRecord) => boolean): Promise<PublicAccessTokenRecord[]> {
  const revoked: AccessTokenRecord[] = [];
  await mutate((records) => {
    const at = new Date().toISOString();
    const next = records.map((record) => {
      if (record.revokedAt || !match(toPublic(record))) return record;
      const updated = { ...record, revokedAt: at };
      revoked.push(updated);
      return updated;
    });
    return revoked.length === 0 ? { records, result: undefined, write: false } : { records: next, result: undefined };
  });
  fireRevoked(revoked);
  return revoked.map(toPublic);
}

/**
 * Remove records that ended more than `olderThanMs` before `now`: agent tokens at `revokedAt`; OAuth tokens (PAN-4945)
 * at `expiresAt`, or when revoked at `revokedAt` + the 90-day refresh window, so a refresh still sees a revocation (D-8.6).
 * Never removes any other record. Returns the count removed. */
export async function pruneEndedAccessTokens(olderThanMs: number, now = Date.now()): Promise<number> {
  return mutate((records) => {
    const kept = records.filter((record) => {
      // NaN (a record that never ends) fails the comparison and is kept.
      const revoked = record.revokedAt !== undefined ? Date.parse(record.revokedAt) : NaN;
      const ended = record.oauthClientId === undefined ? (record.agentId !== undefined ? revoked : NaN)
        : record.revokedAt !== undefined ? revoked + OAUTH_REFRESH_WINDOW_MS : Date.parse(record.expiresAt!);
      return !(now - ended > olderThanMs);
    });
    const removed = records.length - kept.length;
    return removed === 0 ? { records, result: 0, write: false } : { records: kept, result: removed };
  });
}

/** Replace an active phone record's `pushKey`. Returns the updated record, or null when no active phone record has that id. */
export async function setPhonePushKey(id: string, pushKey: string): Promise<PublicAccessTokenRecord | null> {
  if (!MACHINE_KEY_HEX.test(pushKey)) {
    throw new Error('pushKey must be 64 lowercase hex characters');
  }
  return mutate((records) => {
    const index = records.findIndex((record) => record.id === id && record.kind === 'phone' && !record.revokedAt);
    if (index === -1) return { records, result: null };
    const updated = { ...records[index]!, pushKey };
    const next = records.slice();
    next[index] = updated;
    return { records: next, result: toPublic(updated) };
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
 * per record. A revoked or expired token, an unknown token, or a corrupt registry fails.
 */
export function verifyAccessToken(presented: string | null | undefined): VerifyAccessTokenResult {
  if (!presented || !presented.startsWith(ACCESS_TOKEN_PREFIX) || snapshot.error) return { ok: false };
  const presentedHash = Buffer.from(hashToken(presented), 'hex');
  const now = Date.now();
  let match: AccessTokenRecord | null = null;
  for (const record of snapshot.records) {
    const stored = Buffer.from(record.tokenHash, 'hex');
    if (stored.length === presentedHash.length && timingSafeEqual(stored, presentedHash) && isLive(record, now)) {
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
  revokedListeners.clear();
}
