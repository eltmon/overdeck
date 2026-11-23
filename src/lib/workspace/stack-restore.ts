/**
 * PAN-5623: the restore door for a workspace stack a memory reclaim stopped.
 *
 * A reclaim (`stack-reclaim-service.ts`) journals `stack.reclaimed` with the
 * exact container names before it stops them. When the issue next needs its
 * stack (its agent starts a turn, an agent is spawned for it, or its
 * verification starts) this door starts exactly those containers again and
 * journals `stack.restored`.
 *
 * Every step after a cheap unlocked journal read runs inside the per-workspace
 * stack lock, so a restore never interleaves with a stop sequence (D5). A
 * journaled name is started only when its listed container still carries the
 * issue's compose project label and a reclaimable service; anything else is
 * refused (D9). The door never throws: a failure returns `{ kind: 'failed' }`
 * and the caller continues on its existing path (NFR-3). It is plain
 * `src/lib` code because the spawn gate runs in CLI processes and
 * verification runs in a detached worker process.
 */
import { existsSync } from 'node:fs';
import { mkdir, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Effect } from 'effect';

import { emitActivityEntry } from '../activity-logger.js';
import {
  appendPipelineEntry,
  openStackReclaim,
  readPipelineJournal,
  type PipelineJournalEntry,
} from '../cloister/pipeline-journal.js';
import { recordDockerContainerLifecycleSnapshot } from '../docker-stats.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { withFileLock } from '../vault/file-lock.js';
import {
  CONTAINER_NAME_RE,
  RECLAIMABLE_STACK_SERVICES,
  listComposeContainers,
  startContainer,
  type ComposeContainer,
} from './stack-reclaim-docker.js';
import {
  collectDockerContainerLifecycleSnapshot,
  defaultWorkspacePath,
  tryComposeProjectNameForWorkspace,
  type DockerContainerLifecycle,
} from './stack-health.js';

export type StackRestoreTrigger = 'turn' | 'spawn' | 'verification';

export type StackRestoreResult =
  | { kind: 'none' }
  | { kind: 'restored'; started: string[]; alreadyRunning: string[]; missing: string[]; refused: string[] }
  | { kind: 'failed'; failed: string[]; error: string };

/** The stack lock file, under `<workspace>/.overdeck/`. */
export const STACK_LOCK_FILE = 'stack-reclaim.lock';
/** A lock older than this is a crashed holder; it exceeds four 60 s stops. */
export const STACK_LOCK_STALE_MS = 300_000;
/** PAN-5648 (r4672667704 part a): how often a long-running holder re-touches its lock so it is never mistaken for abandoned. */
export const STACK_LOCK_RENEW_MS = 60_000;
const STACK_LOCK_RETRY_MS = 250;
const RESTORE_LOCK_TIMEOUT_MS = 300_000;

export function stackLockPath(workspacePath: string): string {
  return join(workspacePath, '.overdeck', STACK_LOCK_FILE);
}

/** Sets the lock file's mtime to now, so `STACK_LOCK_STALE_MS` is measured from the holder's last renewal. */
async function defaultTouchLock(lockPath: string): Promise<void> {
  const now = new Date();
  await utimes(lockPath, now, now);
}

/**
 * Touches `lockPath` on an unref'd interval until `stop()` is called. A
 * rejected touch (e.g. the lock was already removed) is swallowed — a missed
 * renewal is not a reason to crash the holder.
 */
function startLockRenewal(lockPath: string, intervalMs: number, touch: (path: string) => Promise<void>): { stop: () => void } {
  const timer = setInterval(() => {
    void touch(lockPath).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export interface WithStackLockOptions {
  /** Defaults to touching the lock file's mtime; tests inject a mock. */
  touch?: (lockPath: string) => Promise<void>;
}

/**
 * Runs `fn` holding the stack lock at `lockPath`, waiting at most `timeoutMs`.
 * Creates the lock's `.overdeck/` directory first, because it need not exist
 * yet, but never the workspace itself: a workspace the reaper removed makes
 * this reject (ENOENT) instead of coming back as an empty directory.
 *
 * While `fn` runs, the lock is renewed every `STACK_LOCK_RENEW_MS` so a
 * holder running close to `STACK_LOCK_STALE_MS` is never treated as crashed
 * and reclaimed out from under it (FR-6).
 */
export async function withStackLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  timeoutMs: number,
  options: WithStackLockOptions = {},
): Promise<T> {
  await mkdir(dirname(lockPath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const touch = options.touch ?? defaultTouchLock;
  return withFileLock(lockPath, async () => {
    const renewal = startLockRenewal(lockPath, STACK_LOCK_RENEW_MS, touch);
    try {
      return await fn();
    } finally {
      renewal.stop();
    }
  }, {
    staleMs: STACK_LOCK_STALE_MS,
    retryMs: STACK_LOCK_RETRY_MS,
    maxAttempts: Number.POSITIVE_INFINITY,
    timeoutMs,
    label: 'stack reclaim',
  });
}

export interface StackRestoreDeps {
  pathExists: (path: string) => boolean;
  readJournal: (workspacePath: string) => PipelineJournalEntry[];
  composeProjectFor: (workspacePath: string, issueId: string) => string | null;
  listContainers: () => Promise<ComposeContainer[] | null>;
  startContainer: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  appendEntry: typeof appendPipelineEntry;
  emitActivity: typeof emitActivityEntry;
  withLock: <T>(lockPath: string, fn: () => Promise<T>) => Promise<T>;
}

function resolveDeps(deps: Partial<StackRestoreDeps> = {}): StackRestoreDeps {
  return {
    pathExists: deps.pathExists ?? existsSync,
    readJournal: deps.readJournal ?? ((workspacePath) => readPipelineJournal(workspacePath)),
    composeProjectFor: deps.composeProjectFor ?? tryComposeProjectNameForWorkspace,
    listContainers: deps.listContainers ?? (() => listComposeContainers({ all: true })),
    startContainer: deps.startContainer ?? startContainer,
    appendEntry: deps.appendEntry ?? appendPipelineEntry,
    emitActivity: deps.emitActivity ?? emitActivityEntry,
    withLock: deps.withLock ?? ((lockPath, fn) => withStackLock(lockPath, fn, RESTORE_LOCK_TIMEOUT_MS)),
  };
}

function resolveWorkspacePath(issueId: string, workspacePath: string | null | undefined): string | null {
  if (workspacePath) return workspacePath;
  const projectKey = resolveProjectFromIssueSync(issueId)?.projectKey;
  return defaultWorkspacePath(issueId, projectKey ? getProjectSync(projectKey) : null);
}

/**
 * Starts exactly the containers the open reclaim named, then journals
 * `stack.restored`. Returns `none` when no reclaim is open; never throws.
 */
export async function restoreReclaimedStack(
  input: { issueId: string; workspacePath?: string | null; trigger: StackRestoreTrigger },
  deps?: Partial<StackRestoreDeps>,
): Promise<StackRestoreResult> {
  try {
    const d = resolveDeps(deps);
    const { issueId, trigger } = input;
    const workspacePath = resolveWorkspacePath(issueId, input.workspacePath);
    if (!workspacePath || !d.pathExists(workspacePath)) return { kind: 'none' };
    // The common case: no open reclaim, one file read, no lock.
    if (!openStackReclaim(d.readJournal(workspacePath))) return { kind: 'none' };

    return await d.withLock(stackLockPath(workspacePath), async (): Promise<StackRestoreResult> => {
      const open = openStackReclaim(d.readJournal(workspacePath));
      if (!open) return { kind: 'none' };

      const composeProject = d.composeProjectFor(workspacePath, issueId);
      const listed = await d.listContainers();
      if (listed === null) return { kind: 'failed', failed: [], error: 'docker listing unavailable' };
      const byName = new Map(listed.map((container) => [container.name, container]));

      const started: string[] = [];
      const alreadyRunning: string[] = [];
      const missing: string[] = [];
      const refused: string[] = [];
      const failed: string[] = [];
      const errors: string[] = [];
      for (const name of open.containers) {
        if (!CONTAINER_NAME_RE.test(name) || composeProject === null) {
          refused.push(name);
          continue;
        }
        const container = byName.get(name);
        if (!container) {
          missing.push(name);
          continue;
        }
        if (container.composeProject !== composeProject || !RECLAIMABLE_STACK_SERVICES.has(container.composeService)) {
          refused.push(name);
          continue;
        }
        if (container.state === 'running') {
          alreadyRunning.push(name);
          continue;
        }
        const result = await d.startContainer(name);
        if (result.ok) {
          started.push(name);
        } else {
          failed.push(name);
          errors.push(`${name}: ${result.error}`);
        }
      }

      // A failed start writes nothing: the reclaim stays open, so a later
      // attempt finds the containers that did start as already running.
      if (failed.length > 0) return { kind: 'failed', failed, error: errors.join('; ') };

      d.appendEntry(workspacePath, {
        type: 'stack.restored',
        issueId,
        source: `stack-restore:${trigger}`,
        data: { containers: open.containers, started, alreadyRunning, missing, refused, trigger, reclaimedAt: open.at },
      });
      if (started.length > 0) {
        d.emitActivity({
          source: 'cloister',
          level: 'info',
          issueId,
          message: `stack-restored: ${issueId}`,
          details: `Started ${started.join(', ')} (${trigger}).`,
        });
      }
      if (refused.length > 0) {
        console.warn(`[stack-restore] ${issueId}: refused to start ${refused.join(', ')} (not in compose project ${composeProject ?? 'unknown'} or not a reclaimable service)`);
      }
      return { kind: 'restored', started, alreadyRunning, missing, refused };
    });
  } catch (err) {
    return { kind: 'failed', failed: [], error: String(err) };
  }
}

/**
 * The spawn-path wrapper (D10): restores with trigger `spawn`, and when it
 * started something returns a fresh, recorded container listing for the
 * caller's next health read. Returns `undefined` otherwise, including when
 * the fresh listing fails or is empty, so a gating read never sees a bad
 * listing. Never rejects.
 */
export async function restoreReclaimedStackForSpawn(
  issueId: string,
  workspacePath?: string | null,
  deps?: Partial<StackRestoreDeps> & {
    collect?: () => Promise<DockerContainerLifecycle[]>;
    record?: (containers: DockerContainerLifecycle[]) => void;
  },
): Promise<DockerContainerLifecycle[] | undefined> {
  try {
    const result = await restoreReclaimedStack({ issueId, workspacePath, trigger: 'spawn' }, deps);
    if (result.kind !== 'restored' || result.started.length === 0) return undefined;
    const collect = deps?.collect ?? (() => Effect.runPromise(collectDockerContainerLifecycleSnapshot()));
    const containers = await collect();
    if (containers.length === 0) return undefined;
    (deps?.record ?? recordDockerContainerLifecycleSnapshot)(containers);
    return containers;
  } catch {
    return undefined;
  }
}
