/**
 * The owner's shared conversation list (PAN-4650 WI-2, FR-1, D-4650-2).
 *
 * `buildSharedConversations` answers `GET /api/machines/conversations`: the
 * FR-1 metadata of every local, unarchived conversation on this machine, or
 * nothing when **Share my conversations** is off. The list hash rides in the
 * link heartbeat so a linked viewer refetches only when something changed.
 * One build serves every caller for 5 s, so a heartbeat on each of several
 * links never lists twice. Transcript content is never part of the list.
 */
import { createHash } from 'node:crypto';

import type { SharedConversationRow, SharedConversationsResponse } from '@overdeck/contracts';

import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { getEnrichedConversationList } from '../overdeck/conversation-list.js';
import { listPulledFrom, type PulledFrom } from '../overdeck/conversation-release.js';
import { loadVaultContinuityLookup, vaultIdForConversation, type VaultContinuityLookup } from '../overdeck/conversation-vault-continuity.js';
import { listProjectsAsync, type ProjectConfig } from '../projects.js';
import { canonicalPathAsync, isWithin } from '../projects/path-containment.js';
import { isResumableHarness } from '../vault/resumable.js';
import { readAnywhereSettings } from './anywhere-settings.js';
import { gitOriginOf } from './project-origin.js';

/** Same page the conversation list asks for by default, so both share one enrichment. */
export const SHARED_CONVERSATIONS_LIMIT = 500;
export const SHARED_CONVERSATIONS_CACHE_MS = 5_000;
export const SHARING_OFF_HASH = 'sharing-off';

/** The enriched list fields this module reads (`getEnrichedConversationList` rows). */
export interface EnrichedConversationInput {
  name: string;
  title: string | null;
  claudeSessionId: string | null;
  harness: string | null;
  model: string | null;
  status: 'active' | 'ended';
  sessionAlive?: boolean;
  isWorking?: boolean;
  lastActivityAt?: string | null;
  projectKey: string | null;
  cwd: string;
  issueId: string | null;
  tmuxSession: string;
  releasedTo: string | null;
  createdAt: string;
  archivedAt: string | null;
  origin: 'local' | 'vault';
  spawnError?: string | null;
}

export interface SharedConversationsDeps {
  listRows: () => Promise<readonly unknown[]>;
  readSharing: () => Promise<boolean>;
  listProjects: () => Promise<Array<{ key: string; config: ProjectConfig }>>;
  environmentId: () => Promise<string>;
  vaultLookup: () => Promise<VaultContinuityLookup>;
  pulledFrom: () => Map<string, PulledFrom>;
  now: () => number;
}

const defaultDeps: SharedConversationsDeps = {
  listRows: () => getEnrichedConversationList(SHARED_CONVERSATIONS_LIMIT, 0),
  readSharing: async () => (await readAnywhereSettings()).shareConversations,
  listProjects: listProjectsAsync,
  environmentId: async () => (await ensureEnvironmentIdentity()).environmentId,
  vaultLookup: () => loadVaultContinuityLookup(),
  pulledFrom: listPulledFrom,
  now: () => Date.now(),
};

/** First 16 hex of SHA-256 over the rows sorted by name. */
export function sharedConversationsHash(rows: readonly SharedConversationRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

/** Resolves a cwd to its project key (deepest root wins), canonicalizing each root once. */
async function projectResolver(projects: Array<{ key: string; config: ProjectConfig }>): Promise<(cwd: string) => Promise<string | null>> {
  const roots = await Promise.all(
    projects.filter(({ config }) => config.path).map(async ({ key, config }) => ({ key, root: await canonicalPathAsync(config.path) })),
  );
  return async (cwd) => {
    if (!cwd) return null;
    const target = await canonicalPathAsync(cwd);
    let best: { key: string; depth: number } | null = null;
    for (const { key, root } of roots) {
      if (isWithin(root, target) && (!best || root.length > best.depth)) best = { key, depth: root.length };
    }
    return best?.key ?? null;
  };
}

async function buildRows(deps: SharedConversationsDeps): Promise<SharedConversationRow[]> {
  const [rows, projects, vaultLookup] = await Promise.all([deps.listRows(), deps.listProjects(), deps.vaultLookup()]);
  const configs = new Map(projects.map(({ key, config }) => [key, config]));
  const pulledFrom = deps.pulledFrom();
  const projectOf = await projectResolver(projects);
  const shared: SharedConversationRow[] = [];
  for (const row of rows as readonly EnrichedConversationInput[]) {
    if (row.origin !== 'local' || row.archivedAt !== null) continue;
    const projectKey = row.projectKey ?? (await projectOf(row.cwd));
    shared.push({
      name: row.name,
      title: row.title,
      nativeSessionId: row.claudeSessionId,
      harness: row.harness,
      model: row.model,
      status: row.status,
      sessionAlive: row.sessionAlive ?? false,
      isWorking: row.isWorking ?? false,
      lastActivityAt: row.lastActivityAt ?? null,
      projectKey,
      gitOrigin: gitOriginOf(projectKey ? configs.get(projectKey) : undefined),
      cwd: row.cwd || null,
      issueId: row.issueId,
      tmuxSession: row.tmuxSession || null,
      releasedTo: row.releasedTo,
      createdAt: row.createdAt,
      pullable: row.harness !== null && isResumableHarness(row.harness),
      vaultId: vaultIdForConversation(row, vaultLookup),
      pulledFrom: pulledFrom.get(row.name) ?? null,
      // Only when set, so a healthy row's list hash does not change (PAN-4903).
      ...(row.spawnError ? { spawnError: row.spawnError } : {}),
    });
  }
  return shared;
}

/** Build the shared list now, bypassing the cache. */
export async function buildSharedConversations(deps: Partial<SharedConversationsDeps> = {}): Promise<SharedConversationsResponse> {
  const resolved = { ...defaultDeps, ...deps };
  const [environmentId, sharing] = await Promise.all([resolved.environmentId(), resolved.readSharing()]);
  if (!sharing) return { environmentId, sharing: false, rows: [], hash: SHARING_OFF_HASH };
  const rows = await buildRows(resolved);
  return { environmentId, sharing: true, rows, hash: sharedConversationsHash(rows) };
}

let cached: { at: number; promise: Promise<SharedConversationsResponse> } | null = null;

/** The shared list, built at most once per 5 s for every caller (route and heartbeats). */
export function sharedConversations(deps: Partial<SharedConversationsDeps> = {}): Promise<SharedConversationsResponse> {
  const now = (deps.now ?? defaultDeps.now)();
  if (cached && now - cached.at < SHARED_CONVERSATIONS_CACHE_MS) return cached.promise;
  const entry = { at: now, promise: buildSharedConversations(deps) };
  cached = entry;
  entry.promise.catch(() => {
    if (cached === entry) cached = null;
  });
  return entry.promise;
}

/** The heartbeat's `conversationsHash` source. */
export async function sharedConversationsHashForHeartbeat(): Promise<string> {
  return (await sharedConversations()).hash;
}

/** Drop the cached build, e.g. after the sharing switch changes. */
export function invalidateSharedConversations(): void {
  cached = null;
}
