/**
 * A newer `pan reload` replaces a waiting one (PAN-4888).
 *
 * A newcomer that finds the restart lock held by a waiting reload writes its
 * own supersede marker, `~/.overdeck/reload-supersede/<byPid>.json`, rewrites
 * it on every poll, and takes the lock once the holder steps aside.
 *
 * - Only a `pan reload` holder whose lock record says `supersedable: true` is
 *   ever asked to step aside; every other holder is refused as before (D3).
 * - Targets are compared by git ancestry: an equal or older newcomer target is
 *   covered, a strictly newer one supersedes, and diverged history is refused (D4).
 * - The holder steps aside only after the gate agrees to withdraw its request,
 *   so an approval that already covers it is never thrown away (D6).
 * - A marker is honored only by its target pid, only while its writer is
 *   alive, and only while it was rewritten in the last 30 seconds (D9).
 */

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import {
  acquireRestartLock,
  readRestartLockHolder,
  type RestartLockHandle,
  type RestartLockHolder,
} from '../restart-lock.js';

export const RELOAD_CALLER = 'pan reload';
export const RELOAD_SUPERSEDE_POLL_MS = 2_000;
export const RELOAD_SUPERSEDE_WAIT_MS = 20 * 60_000;
export const RELOAD_SUPERSEDE_FRESH_MS = 30_000;

export interface ReloadSupersedeRequest {
  /** The holder asked to step aside. */
  readonly targetPid: number;
  /** The newcomer that asked (also the file name). */
  readonly byPid: number;
  /** The newcomer's target SHA. */
  readonly targetSha: string;
  /** ISO time of the last rewrite. */
  readonly refreshedAt: string;
}

export function reloadSupersedeDir(): string {
  return join(getOverdeckHome(), 'reload-supersede');
}

export function reloadSupersedeFile(byPid: number): string {
  return join(reloadSupersedeDir(), `${byPid}.json`);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === 'EPERM';
  }
}

export async function writeReloadSupersedeRequest(request: ReloadSupersedeRequest): Promise<void> {
  await mkdir(reloadSupersedeDir(), { recursive: true });
  const path = reloadSupersedeFile(request.byPid);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(request)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
}

/** Delete this newcomer's own marker. Never touches another pid's file. */
export async function deleteOwnReloadSupersedeRequest(byPid: number): Promise<void> {
  try {
    await unlink(reloadSupersedeFile(byPid));
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }
}

function parseRequest(raw: string): ReloadSupersedeRequest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ReloadSupersedeRequest>;
    if (
      typeof parsed.targetPid !== 'number' ||
      !Number.isFinite(parsed.targetPid) ||
      typeof parsed.byPid !== 'number' ||
      !Number.isFinite(parsed.byPid) ||
      typeof parsed.targetSha !== 'string' ||
      typeof parsed.refreshedAt !== 'string'
    ) {
      return null;
    }
    return {
      targetPid: parsed.targetPid,
      byPid: parsed.byPid,
      targetSha: parsed.targetSha,
      refreshedAt: parsed.refreshedAt,
    };
  } catch {
    return null;
  }
}

export async function listReloadSupersedeRequests(): Promise<ReloadSupersedeRequest[]> {
  let names: string[];
  try {
    names = await readdir(reloadSupersedeDir());
  } catch {
    return [];
  }
  const requests: ReloadSupersedeRequest[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const request = parseRequest(await readFile(join(reloadSupersedeDir(), name), 'utf8'));
      if (request) requests.push(request);
    } catch {
      // A marker deleted or rewritten mid-read is skipped; the next poll sees it.
    }
  }
  return requests;
}

/** Holder side: the detail line when a live, fresh newcomer asked this pid to step aside, else null. */
export async function reloadSupersedeDetail(
  pid: number = process.pid,
  deps: { readonly isAlive?: (pid: number) => boolean; readonly now?: () => number } = {},
): Promise<string | null> {
  const isAlive = deps.isAlive ?? defaultIsAlive;
  const now = (deps.now ?? Date.now)();
  const live = (await listReloadSupersedeRequests())
    .filter((request) => request.targetPid === pid)
    .filter((request) => now - Date.parse(request.refreshedAt) < RELOAD_SUPERSEDE_FRESH_MS)
    .filter((request) => isAlive(request.byPid))
    .sort((a, b) => Date.parse(b.refreshedAt) - Date.parse(a.refreshedAt));
  const newest = live[0];
  if (!newest) return null;
  return `superseded by a newer pan reload (PID ${newest.byPid}) that builds origin/main ${newest.targetSha.slice(0, 12)}`;
}

export type ReloadLockOutcome =
  | { readonly kind: 'acquired'; readonly lock: RestartLockHandle }
  | { readonly kind: 'covered'; readonly holder: RestartLockHolder }
  | { readonly kind: 'refused'; readonly message: string };

export interface AcquireReloadLockDeps {
  /** `git merge-base --is-ancestor ancestor descendant`: true, false, or throws on a git error. */
  readonly isAncestor: (ancestor: string, descendant: string) => Promise<boolean>;
  readonly acquire?: typeof acquireRestartLock;
  readonly readHolder?: typeof readRestartLockHolder;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pid?: number;
  readonly log?: (message: string) => void;
}

type TargetComparison = 'covered' | 'supersede' | 'diverged';

async function compareTargets(
  holderSha: string,
  ownSha: string,
  isAncestor: AcquireReloadLockDeps['isAncestor'],
): Promise<TargetComparison> {
  if (holderSha === ownSha) return 'covered';
  try {
    if (await isAncestor(ownSha, holderSha)) return 'covered';
    if (await isAncestor(holderSha, ownSha)) return 'supersede';
  } catch {
    // A git error leaves the order unknown: refuse rather than guess.
  }
  return 'diverged';
}

/**
 * Newcomer side: take the restart lock for `pan reload`, asking a waiting
 * supersedable reload of an older commit to step aside and waiting up to
 * {@link RELOAD_SUPERSEDE_WAIT_MS} for it. `targetSha` is undefined for a
 * `--skip-build` reload, which never supersedes.
 */
export async function acquireReloadLock(
  targetSha: string | undefined,
  deps: AcquireReloadLockDeps,
): Promise<ReloadLockOutcome> {
  const acquire = deps.acquire ?? acquireRestartLock;
  const readHolder = deps.readHolder ?? readRestartLockHolder;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pid = deps.pid ?? process.pid;
  const log = deps.log ?? ((message: string) => console.log(message));

  const deadline = now() + RELOAD_SUPERSEDE_WAIT_MS;
  const comparisons = new Map<string, TargetComparison>();
  const asked = new Set<number>();

  const finish = async (outcome: ReloadLockOutcome): Promise<ReloadLockOutcome> => {
    await deleteOwnReloadSupersedeRequest(pid);
    return outcome;
  };

  for (;;) {
    const lock = await acquire(RELOAD_CALLER, targetSha ? { targetSha, supersedable: true } : { supersedable: true });
    if (lock) return finish({ kind: 'acquired', lock });

    const holder = await readHolder();
    let heldBy = 'held by another process';
    if (holder) {
      heldBy = `held by PID ${holder.pid} (${holder.caller})`;
      if (!targetSha || holder.caller !== RELOAD_CALLER || holder.supersedable !== true) {
        return finish({ kind: 'refused', message: `restart in progress (${heldBy})` });
      }
      if (holder.targetSha) {
        const key = `${holder.pid}:${holder.targetSha}`;
        let comparison = comparisons.get(key);
        if (!comparison) {
          comparison = await compareTargets(holder.targetSha, targetSha, deps.isAncestor);
          comparisons.set(key, comparison);
        }
        if (comparison === 'covered') return finish({ kind: 'covered', holder });
        if (comparison === 'diverged') {
          return finish({
            kind: 'refused',
            message:
              `restart in progress (${heldBy}); its build ${holder.targetSha.slice(0, 12)} and origin/main ` +
              `${targetSha.slice(0, 12)} have diverged, so it was not replaced`,
          });
        }
      }

      await writeReloadSupersedeRequest({
        targetPid: holder.pid,
        byPid: pid,
        targetSha,
        refreshedAt: new Date(now()).toISOString(),
      });
      if (!asked.has(holder.pid)) {
        asked.add(holder.pid);
        const holderSha = holder.targetSha?.slice(0, 12) ?? 'an unbuilt reload';
        log(
          `A reload of origin/main ${holderSha} holds the restart lock (PID ${holder.pid}); ` +
            `asked it to step aside for origin/main ${targetSha.slice(0, 12)}.`,
        );
      }
    }

    if (now() >= deadline) {
      return finish({
        kind: 'refused',
        message: `restart in progress (${heldBy}); it did not step aside for a newer reload within 20 minutes`,
      });
    }
    await sleep(RELOAD_SUPERSEDE_POLL_MS);
  }
}
