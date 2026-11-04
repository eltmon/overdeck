/**
 * Cross-process store for pull-request watches (PAN-4943 W-PR1).
 *
 * The single read/write door for `${OVERDECK_HOME}/pr-watches.json`: one row
 * per "agent A wants a message when PR K changes" watch, keyed by its owner
 * (an agent token's `agentId` + `agentKind`) and PR key. A watch carries its
 * own baseline snapshot, so it works without a PR link and without the
 * watching agent having a conversation row (most work agents have neither).
 *
 * The write path copies `anywhere/fly/machine-store.ts`: mode 0600, temp file
 * in the same directory then rename, an in-process write queue, and a
 * cross-process lock file (`pr-watches.json.lock`) around every
 * read-modify-write, because `revokeAgentMcpTokens` calls this store from CLI
 * processes as well as the dashboard. A corrupt file makes every read throw,
 * and nothing rewrites it. A change that alters nothing writes nothing.
 * Imports only Node built-ins, `../paths.js`, `../vault/file-lock.js` and
 * type-only `@overdeck/contracts`, so `agent-token.ts` can load it without
 * pulling in the dashboard runtime (NFR-8).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PrChecksState, PrReviewState, PullRequestKey, PullRequestSnapshot, PullRequestState } from '@overdeck/contracts';

import { getOverdeckHome } from '../paths.js';
import { withFileLock } from '../vault/file-lock.js';

export const PR_WATCHES_FILENAME = 'pr-watches.json';
export const PR_WATCH_LIMIT_PER_OWNER = 20;
export const PR_WATCH_LIMIT_TOTAL = 50;

export interface PullRequestWatchOwner {
  agentId: string;
  agentKind: 'agent' | 'conversation';
}

export interface PullRequestWatchBaseline {
  state: PullRequestState;
  checks: PrChecksState;
  reviewState: PrReviewState;
  mergeable: boolean | null;
}

export interface PullRequestWatch extends PullRequestWatchOwner {
  /** `randomUUID()`. */
  id: string;
  host: string;
  repository: string;
  number: number;
  url: string;
  /** ISO. */
  createdAt: string;
  /** Messages delivered so far. */
  wakes: number;
  /** D-5: consecutive review-only wakes since the last checks event. */
  quietWakes: number;
  last: PullRequestWatchBaseline;
}

interface PullRequestWatchesFile {
  v: 1;
  watches: PullRequestWatch[];
}

let writeQueue: Promise<unknown> = Promise.resolve();

function watchesPath(): string {
  return join(getOverdeckHome(), PR_WATCHES_FILENAME);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function isBaseline(value: unknown): value is PullRequestWatchBaseline {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return isText(b.state) && isText(b.checks) && isText(b.reviewState) && (b.mergeable === null || typeof b.mergeable === 'boolean');
}

function isWatch(value: unknown): value is PullRequestWatch {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Record<string, unknown>;
  return (
    isText(w.id) &&
    isText(w.agentId) &&
    (w.agentKind === 'agent' || w.agentKind === 'conversation') &&
    isText(w.host) &&
    isText(w.repository) &&
    typeof w.number === 'number' &&
    isText(w.url) &&
    isText(w.createdAt) &&
    typeof w.wakes === 'number' &&
    typeof w.quietWakes === 'number' &&
    isBaseline(w.last)
  );
}

function sameOwner(a: PullRequestWatchOwner, b: PullRequestWatchOwner): boolean {
  return a.agentId === b.agentId && a.agentKind === b.agentKind;
}

/** D-2: a snapshot with `mergeable: null` leaves the previous non-null value unchanged. */
export function baselineFromSnapshot(snapshot: PullRequestSnapshot, previous?: PullRequestWatchBaseline): PullRequestWatchBaseline {
  return {
    state: snapshot.state,
    checks: snapshot.checks,
    reviewState: snapshot.reviewState,
    mergeable: snapshot.mergeable ?? previous?.mergeable ?? null,
  };
}

function parseWatches(raw: string, path: string): PullRequestWatch[] {
  // A crash can leave a zero-byte file behind (PAN-2623); it holds no watches.
  if (raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`pr-watches.json is corrupt: ${path}: ${(error as Error).message}`);
  }
  const file = parsed as Partial<PullRequestWatchesFile> | null;
  if (typeof file !== 'object' || file === null || file.v !== 1 || !Array.isArray(file.watches) || !file.watches.every(isWatch)) {
    throw new Error(`pr-watches.json is corrupt: ${path}`);
  }
  return file.watches;
}

async function readWatches(path: string): Promise<PullRequestWatch[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read pr-watches.json: ${path}: ${(error as Error).message}`);
  }
  return parseWatches(raw, path);
}

async function writeWatches(path: string, watches: PullRequestWatch[]): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${PR_WATCHES_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: PullRequestWatchesFile = { v: 1, watches };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/**
 * Serializes read-modify-write cycles within this process and takes the
 * cross-process lock around each one. `fn` returns the same `watches` array
 * it was given to signal "nothing changed"; anything else is written.
 */
export function updatePullRequestWatches<T>(fn: (watches: PullRequestWatch[]) => { watches: PullRequestWatch[]; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = watchesPath();
    await mkdir(getOverdeckHome(), { recursive: true, mode: 0o700 });
    return withFileLock(`${path}.lock`, async () => {
      const current = await readWatches(path);
      const { watches, result } = fn(current);
      if (watches !== current) await writeWatches(path, watches);
      return result;
    });
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Every watch, freshly read, optionally filtered to one owner. A corrupt file throws naming the path. */
export async function listPullRequestWatches(owner?: PullRequestWatchOwner): Promise<PullRequestWatch[]> {
  const watches = await readWatches(watchesPath());
  return owner ? watches.filter((watch) => sameOwner(watch, owner)) : watches;
}

export type AddPullRequestWatchResult = { ok: true; watch: PullRequestWatch; created: boolean } | { ok: false; code: 'owner-limit' | 'total-limit' };

/** D-9: a duplicate owner+key add returns the existing watch unchanged, with no write. */
export async function addPullRequestWatch(
  input: PullRequestWatchOwner & { key: PullRequestKey & { url: string }; last: PullRequestWatchBaseline; now?: number },
): Promise<AddPullRequestWatchResult> {
  return updatePullRequestWatches<AddPullRequestWatchResult>((watches) => {
    const owner: PullRequestWatchOwner = { agentId: input.agentId, agentKind: input.agentKind };
    const existing = watches.find(
      (watch) => sameOwner(watch, owner) && watch.host === input.key.host && watch.repository === input.key.repository && watch.number === input.key.number,
    );
    if (existing) return { watches, result: { ok: true, watch: existing, created: false } };

    const ownerCount = watches.filter((watch) => sameOwner(watch, owner)).length;
    if (ownerCount >= PR_WATCH_LIMIT_PER_OWNER) return { watches, result: { ok: false, code: 'owner-limit' } };
    if (watches.length >= PR_WATCH_LIMIT_TOTAL) return { watches, result: { ok: false, code: 'total-limit' } };

    const watch: PullRequestWatch = {
      ...owner,
      id: randomUUID(),
      host: input.key.host,
      repository: input.key.repository,
      number: input.key.number,
      url: input.key.url,
      createdAt: new Date(input.now ?? Date.now()).toISOString(),
      wakes: 0,
      quietWakes: 0,
      last: input.last,
    };
    return { watches: [...watches, watch], result: { ok: true, watch, created: true } };
  });
}

/** Removes a watch only when `owner` matches its row. Returns false (and writes nothing) otherwise. */
export async function removePullRequestWatch(id: string, owner: PullRequestWatchOwner): Promise<boolean> {
  return updatePullRequestWatches((watches) => {
    const index = watches.findIndex((watch) => watch.id === id && sameOwner(watch, owner));
    if (index === -1) return { watches, result: false };
    const next = watches.slice();
    next.splice(index, 1);
    return { watches: next, result: true };
  });
}

/** Removes every watch of `owner`. Returns the removed count (and writes nothing when it is 0). */
export async function removePullRequestWatchesForOwner(owner: PullRequestWatchOwner): Promise<number> {
  return updatePullRequestWatches((watches) => {
    const remaining = watches.filter((watch) => !sameOwner(watch, owner));
    const removed = watches.length - remaining.length;
    if (removed === 0) return { watches, result: 0 };
    return { watches: remaining, result: removed };
  });
}

/** Test seam: no production caller; tests wait for queued writes to settle. */
export async function _settlePullRequestWatchWritesForTests(): Promise<void> {
  await writeQueue;
}

/** Test seam: no production caller; tests drop the write queue between cases. */
export function _resetPullRequestWatchStoreForTests(): void {
  writeQueue = Promise.resolve();
}
