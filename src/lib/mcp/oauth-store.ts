/**
 * The `${OVERDECK_HOME}/mcp-oauth.json` door (PAN-4945 D-10): registered OAuth
 * clients and their sign-ins (families). The only module that reads or
 * writes the file.
 *
 * A family stores its refresh token only as a SHA-256 hex digest, plus up to
 * `MAX_PRIOR_REFRESH_HASHES` digests of retired refresh tokens so a reused
 * one can be detected. Access tokens live in the access-token registry; a
 * family names its current one by `accessTokenId`.
 *
 * Every read and mutation prunes first, against the caller's `now`: families
 * that ended (revoked or refresh-expired) more than `ENDED_FAMILY_KEEP_MS`
 * ago, then clients with no family created more than `UNUSED_CLIENT_TTL_MS`
 * ago. A missing file is empty. An unreadable or malformed file throws an
 * Error naming the path and is never overwritten. Writes are serialized within
 * the process and land atomically (temp file, then rename) with mode 0600.
 * Only the dashboard process writes this file; the CLI goes through the
 * operator endpoints.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { OAUTH_CLIENT_ID, OAUTH_FAMILY_ID, type AccessTokenScope } from '../access-token-records.js';
import { getOverdeckHome } from '../paths.js';
import { isOAuthLevel, type OAuthLevel } from './oauth-flow.js';

export const MCP_OAUTH_FILENAME = 'mcp-oauth.json';
export const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60_000;
export const ENDED_FAMILY_KEEP_MS = 7 * 24 * 60 * 60_000;
export const MAX_PRIOR_REFRESH_HASHES = 20;

export interface OAuthClientRecord {
  clientId: string;
  name: string;
  redirectUris: string[];
  /** Present only on clients made by `issue`: no browser flow, no redirect URIs. */
  headless?: true;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OAuthFamilyRecord {
  familyId: string;
  clientId: string;
  level: OAuthLevel;
  scopes: AccessTokenScope[];
  /** SHA-256 hex digest of the current refresh token. */
  refreshHash: string;
  /** Digests of retired refresh tokens, newest first, at most `MAX_PRIOR_REFRESH_HASHES`. */
  priorRefreshHashes: string[];
  refreshExpiresAt: string;
  /** The registry id of the family's current access token. */
  accessTokenId: string;
  createdAt: string;
  revokedAt?: string;
}

export interface McpOAuthData {
  clients: OAuthClientRecord[];
  families: OAuthFamilyRecord[];
}

const HASH_HEX = /^[0-9a-f]{64}$/;

let writeQueue: Promise<unknown> = Promise.resolve();

export function mcpOAuthPath(): string {
  return join(getOverdeckHome(), MCP_OAUTH_FILENAME);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isClient(value: unknown): value is OAuthClientRecord {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.clientId === 'string' &&
    OAUTH_CLIENT_ID.test(c.clientId) &&
    typeof c.name === 'string' &&
    isStringArray(c.redirectUris) &&
    (c.headless === undefined || c.headless === true) &&
    typeof c.createdAt === 'string' &&
    (c.lastUsedAt === null || typeof c.lastUsedAt === 'string')
  );
}

function isFamily(value: unknown): value is OAuthFamilyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.familyId === 'string' &&
    OAUTH_FAMILY_ID.test(f.familyId) &&
    typeof f.clientId === 'string' &&
    OAUTH_CLIENT_ID.test(f.clientId) &&
    isOAuthLevel(f.level) &&
    isStringArray(f.scopes) &&
    typeof f.refreshHash === 'string' &&
    HASH_HEX.test(f.refreshHash) &&
    isStringArray(f.priorRefreshHashes) &&
    f.priorRefreshHashes.every((hash) => HASH_HEX.test(hash)) &&
    typeof f.refreshExpiresAt === 'string' &&
    typeof f.accessTokenId === 'string' &&
    typeof f.createdAt === 'string' &&
    (f.revokedAt === undefined || typeof f.revokedAt === 'string')
  );
}

function parseStore(raw: string, path: string): McpOAuthData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`MCP OAuth store ${path} has an unexpected shape`);
  }
  const file = parsed as { v?: unknown; clients?: unknown; families?: unknown } | null;
  if (
    typeof file !== 'object' || file === null || file.v !== 1 ||
    !Array.isArray(file.clients) || !file.clients.every(isClient) ||
    !Array.isArray(file.families) || !file.families.every(isFamily)
  ) {
    throw new Error(`MCP OAuth store ${path} has an unexpected shape`);
  }
  return { clients: file.clients, families: file.families };
}

async function readStore(path: string): Promise<McpOAuthData> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { clients: [], families: [] };
    throw new Error(`Cannot read MCP OAuth store ${path}: ${(error as Error).message}`);
  }
  return parseStore(raw, path);
}

async function writeStore(path: string, data: McpOAuthData): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${MCP_OAUTH_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify({ v: 1, clients: data.clients, families: data.families }, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** When a family ended: the earlier of `revokedAt` and `refreshExpiresAt`. */
function familyEndedAt(family: OAuthFamilyRecord): number {
  const expires = Date.parse(family.refreshExpiresAt);
  return family.revokedAt === undefined ? expires : Math.min(expires, Date.parse(family.revokedAt));
}

/** Drop families ended more than 7 days before `now`, then clients with no family created more than 24 h before `now` (D-10). */
export function pruneMcpOAuthData(data: McpOAuthData, now: number): McpOAuthData {
  const families = data.families.filter((family) => !(now - familyEndedAt(family) > ENDED_FAMILY_KEEP_MS));
  const withFamily = new Set(families.map((family) => family.clientId));
  const clients = data.clients.filter((client) => withFamily.has(client.clientId) || !(now - Date.parse(client.createdAt) > UNUSED_CLIENT_TTL_MS));
  return { clients, families };
}

/** A fresh, pruned read. Never writes. Throws naming the path when the file is unreadable or malformed. */
export async function readMcpOAuthData(now: number): Promise<McpOAuthData> {
  return pruneMcpOAuthData(await readStore(mcpOAuthPath()), now);
}

/** Serialized read-prune-change-write. `write: false` skips the write. */
export function mutateMcpOAuthData<T>(now: number, change: (data: McpOAuthData) => { data: McpOAuthData; result: T; write?: false }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = mcpOAuthPath();
    const { data, result, write } = change(pruneMcpOAuthData(await readStore(path), now));
    if (write !== false) await writeStore(path, data);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Test-only: drop the write queue. */
export function _resetMcpOAuthStoreForTests(): void {
  writeQueue = Promise.resolve();
}
