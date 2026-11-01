/**
 * Machine-link store (PAN-4645 WI-11, W-LINK1).
 *
 * The single read/write door for `${OVERDECK_HOME}/machine-links.json`: one
 * record per machine this server can reach — the peer's environment id and
 * label, its pinned machine key, the `odk_` machine token the peer issued us,
 * the link's access level, the id of the reverse token we issued the peer, and
 * the ordered route list. The file is 0600, written atomically (temp file in
 * the same directory, then rename) through an in-process write queue, and
 * never parsed permissively: a corrupt file means zero links plus a loud error
 * until it is repaired. Linking the same environment id again replaces the
 * old link (D-4645-18); the caller revokes the old reverse token.
 *
 * Like `access-tokens.ts`, a synchronous in-memory snapshot (`linksSnapshot`,
 * `hasActiveLinks`) is refreshed every 5 s so a peer dashboard sharing this
 * home computes the same `require_token_mint` as the primary (D-4645-23).
 * Imports only Node built-ins, `../paths.js`, the contracts package and the
 * route model, so the CLI can load it without the dashboard runtime.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROUTE_KINDS } from '@overdeck/contracts';

import { MACHINE_ACCESS_LEVELS, type MachineAccess } from '../access-tokens.js';
import { getOverdeckHome } from '../paths.js';
import type { LinkRoute } from './routes.js';

export const MACHINE_LINKS_FILENAME = 'machine-links.json';
export const MACHINE_LINKS_REFRESH_MS = 5_000;
const KEY_HEX = /^[0-9a-f]{64}$/;
const ROUTE_SOURCES = ['pairing', 'manual', 'advertised'] as const;

export interface MachineLink {
  id: string;
  environmentId: string;
  label: string;
  /** The peer's pinned machine key, 64 lowercase hex. */
  machineKey: string;
  /** The `odk_` machine token the peer issued this machine. */
  token: string;
  access: MachineAccess;
  /** Id of the machine token this machine issued the peer (both-ways links), else null. */
  reverseTokenId: string | null;
  routes: LinkRoute[];
  createdAt: string;
  revokedAt: string | null;
  /** PAN-4650 D-4650-15: **Hide this machine** — its conversations leave the merged list; the link stays. */
  hidden?: boolean;
}

export interface UpsertLinkInput {
  environmentId: string;
  label: string;
  machineKey: string;
  token: string;
  access: MachineAccess;
  reverseTokenId?: string | null;
  routes: LinkRoute[];
}

interface LinksFile {
  v: 1;
  links: MachineLink[];
}

interface Snapshot {
  links: MachineLink[];
  fingerprint: string | null;
  error: Error | null;
}

let snapshot: Snapshot = { links: [], fingerprint: null, error: null };
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

export function machineLinksPath(): string {
  return join(getOverdeckHome(), MACHINE_LINKS_FILENAME);
}

function isRoute(value: unknown): value is LinkRoute {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.url === 'string' && /^(tcp|wss):\/\//.test(r.url) &&
    (ROUTE_KINDS as readonly unknown[]).includes(r.kind) &&
    (ROUTE_SOURCES as readonly unknown[]).includes(r.source) &&
    typeof r.addedAt === 'string'
  );
}

function isLink(value: unknown): value is MachineLink {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' && r.id !== '' &&
    typeof r.environmentId === 'string' && r.environmentId !== '' &&
    typeof r.label === 'string' &&
    typeof r.machineKey === 'string' && KEY_HEX.test(r.machineKey) &&
    typeof r.token === 'string' && r.token.startsWith('odk_') &&
    (MACHINE_ACCESS_LEVELS as readonly unknown[]).includes(r.access) &&
    (r.reverseTokenId === null || typeof r.reverseTokenId === 'string') &&
    Array.isArray(r.routes) && r.routes.every(isRoute) &&
    typeof r.createdAt === 'string' &&
    (r.revokedAt === null || typeof r.revokedAt === 'string')
  );
}

function parseLinks(raw: string, path: string): MachineLink[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Machine-link store ${path} is not valid JSON: ${(error as Error).message}`);
  }
  const file = parsed as Partial<LinksFile> | null;
  if (typeof file !== 'object' || file === null || file.v !== 1 || !Array.isArray(file.links) || !file.links.every(isLink)) {
    throw new Error(`Machine-link store ${path} has an unexpected shape`);
  }
  return file.links;
}

async function fingerprintOf(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return `${info.mtimeMs}:${info.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot stat machine-link store ${path}: ${(error as Error).message}`);
  }
}

/** Fresh read. Absent ⇒ empty; unreadable or corrupt ⇒ throws naming the path. */
async function readLinks(path: string): Promise<MachineLink[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read machine-link store ${path}: ${(error as Error).message}`);
  }
  return parseLinks(raw, path);
}

async function writeLinks(path: string, links: MachineLink[]): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${MACHINE_LINKS_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: LinksFile = { v: 1, links };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  snapshot = { links, fingerprint: await fingerprintOf(path), error: null };
}

/** Serialize read-modify-write cycles within this process. A corrupt file is never overwritten. */
function mutate<T>(change: (links: MachineLink[]) => { links: MachineLink[]; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = machineLinksPath();
    const { links, result } = change(await readLinks(path));
    await writeLinks(path, links);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

function failSnapshot(error: Error): void {
  const changed = snapshot.error?.message !== error.message;
  snapshot = { links: [], fingerprint: null, error };
  if (changed) console.error(`[machine-links] ${error.message}. No machine link is honoured until the file is repaired.`);
}

/** Reload the snapshot when the file changed; a corrupt file empties it and rejects naming the path. */
export async function refreshLinkStore(): Promise<void> {
  const path = machineLinksPath();
  try {
    const fingerprint = await fingerprintOf(path);
    if (snapshot.error === null && fingerprint === snapshot.fingerprint) return;
    const links = await readLinks(path);
    snapshot = { links, fingerprint, error: null };
  } catch (error) {
    failSnapshot(error as Error);
    throw error;
  }
}

export function startLinkStoreRefresh(): void {
  if (refreshTimer) return;
  void refreshLinkStore().catch(() => undefined);
  refreshTimer = setInterval(() => {
    void refreshLinkStore().catch(() => undefined);
  }, MACHINE_LINKS_REFRESH_MS);
  refreshTimer.unref?.();
}

export function stopLinkStoreRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/** The in-memory snapshot (every link, revoked included). Synchronous. */
export function linksSnapshot(): MachineLink[] {
  return snapshot.links.map((link) => ({ ...link, routes: [...link.routes] }));
}

/** True when the snapshot holds at least one non-revoked link. */
export function hasActiveLinks(): boolean {
  return snapshot.links.some((link) => link.revokedAt === null);
}

/**
 * Every link, freshly read. A corrupt or unreadable file yields zero links and
 * one loud error naming the file (never a permissive parse).
 */
export async function listLinks(): Promise<MachineLink[]> {
  try {
    const links = await readLinks(machineLinksPath());
    snapshot = { links, fingerprint: await fingerprintOf(machineLinksPath()), error: null };
    return links;
  } catch (error) {
    failSnapshot(error as Error);
    return [];
  }
}

/** Find a link by id, environment id or label (exact match, in that order). */
export async function getLink(idOrEnvOrLabel: string): Promise<MachineLink | null> {
  const links = await listLinks();
  return links.find((link) => link.id === idOrEnvOrLabel)
    ?? links.find((link) => link.environmentId === idOrEnvOrLabel)
    ?? links.find((link) => link.label === idOrEnvOrLabel)
    ?? null;
}

/**
 * Write a link, replacing any existing link to the same environment id
 * (D-4645-18). Returns the stored link and the link it replaced, whose
 * `reverseTokenId` the caller revokes.
 */
export async function upsertLink(input: UpsertLinkInput): Promise<{ link: MachineLink; replaced: MachineLink | null }> {
  if (!KEY_HEX.test(input.machineKey)) throw new Error('A machine link needs machineKey: 64 lowercase hex characters');
  if (!input.token.startsWith('odk_')) throw new Error('A machine link needs the odk_ token the peer issued');
  if (!(MACHINE_ACCESS_LEVELS as readonly string[]).includes(input.access)) throw new Error(`A machine link needs access: one of ${MACHINE_ACCESS_LEVELS.join(', ')}`);
  if (input.environmentId === '') throw new Error('A machine link needs the peer environmentId');
  return mutate((links) => {
    const replaced = links.find((link) => link.environmentId === input.environmentId) ?? null;
    const link: MachineLink = {
      id: randomUUID(),
      environmentId: input.environmentId,
      label: input.label,
      machineKey: input.machineKey,
      token: input.token,
      access: input.access,
      reverseTokenId: input.reverseTokenId ?? null,
      routes: input.routes.map((route) => ({ ...route })),
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    return { links: [...links.filter((entry) => entry.environmentId !== input.environmentId), link], result: { link, replaced } };
  });
}

/** Delete a link by id. Returns the removed link, or null when no link has that id. */
export async function removeLink(id: string): Promise<MachineLink | null> {
  return mutate((links) => {
    const removed = links.find((link) => link.id === id) ?? null;
    return { links: links.filter((link) => link.id !== id), result: removed };
  });
}

/** Mark a link revoked (the peer refused our key or token). Returns the link, or null when unknown. */
export async function markLinkRevoked(id: string): Promise<MachineLink | null> {
  return mutate((links) => {
    const index = links.findIndex((link) => link.id === id);
    if (index === -1) return { links, result: null };
    const existing = links[index]!;
    const revoked = existing.revokedAt ? existing : { ...existing, revokedAt: new Date().toISOString() };
    const next = links.slice();
    next[index] = revoked;
    return { links: next, result: revoked };
  });
}

/** Replace a link's route list. Returns the link, or null when unknown. */
export async function setLinkRoutes(id: string, routes: LinkRoute[]): Promise<MachineLink | null> {
  return mutate((links) => {
    const index = links.findIndex((link) => link.id === id);
    if (index === -1) return { links, result: null };
    const updated = { ...links[index]!, routes: routes.map((route) => ({ ...route })) };
    const next = links.slice();
    next[index] = updated;
    return { links: next, result: updated };
  });
}

/** PAN-4650 D-4650-15: Hide this machine (its conversations leave the merged list; the link stays). */
export async function setLinkHidden(id: string, hidden: boolean): Promise<MachineLink | null> {
  return mutate((links) => {
    const index = links.findIndex((link) => link.id === id);
    if (index === -1) return { links, result: null };
    const { hidden: _previous, ...rest } = links[index]!;
    const updated: MachineLink = hidden ? { ...rest, hidden: true } : rest;
    const next = links.slice();
    next[index] = updated;
    return { links: next, result: updated };
  });
}

/** Test-only: wait for queued writes to settle. */
export async function _settleLinkStoreWritesForTests(): Promise<void> {
  await writeQueue;
}

/** Test-only: drop the snapshot, timer and queue. */
export function _resetLinkStoreForTests(): void {
  stopLinkStoreRefresh();
  snapshot = { links: [], fingerprint: null, error: null };
  writeQueue = Promise.resolve();
}
