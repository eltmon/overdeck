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
 * issue's compose project label and a restorable service (reclaimable, or the
 * service its reclaim entry recorded, PAN-5250 FR-9); anything else is
 * refused (D9). The door never throws: a failure returns `{ kind: 'failed' }`
 * and the caller continues on its existing path (NFR-3). It is plain
 * `src/lib` code because the spawn gate runs in CLI processes and
 * verification runs in a detached worker process.
 *
 * PAN-5250 adds the wake door (`wakeWorkspaceStack`, D11) behind
 * `pan workspace up`: the restore, then every other exited container of the
 * compose project whose service is wakeable.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
import { wakeableServicesForIssue } from './stack-idle-config.js';

export type StackRestoreTrigger = 'turn' | 'spawn' | 'verification' | 'operator';

export type StackRestoreResult =
  | { kind: 'none' }
  | { kind: 'restored'; started: string[]; alreadyRunning: string[]; missing: string[]; refused: string[] }
  | { kind: 'failed'; failed: string[]; error: string };

/** The stack lock file, under `<workspace>/.overdeck/`. */
export const STACK_LOCK_FILE = 'stack-reclaim.lock';
/** A lock older than this is a crashed holder; it exceeds four 60 s stops. */
export const STACK_LOCK_STALE_MS = 300_000;
const STACK_LOCK_RETRY_MS = 250;
const RESTORE_LOCK_TIMEOUT_MS = 300_000;

export function stackLockPath(workspacePath: string): string {
  return join(workspacePath, '.overdeck', STACK_LOCK_FILE);
}

/**
 * Runs `fn` holding the stack lock at `lockPath`, waiting at most `timeoutMs`.
 * Creates the lock's `.overdeck/` directory first, because it need not exist
 * yet, but never the workspace itself: a workspace the reaper removed makes
 * this reject (ENOENT) instead of coming back as an empty directory.
 */
export async function withStackLock<T>(lockPath: string, fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  await mkdir(dirname(lockPath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return withFileLock(lockPath, fn, {
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
  /** PAN-5250 D11: services the wake door may start; never read by the restore door. */
  wakeableServices: (issueId: string) => ReadonlySet<string>;
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
    wakeableServices: deps.wakeableServices ?? wakeableServicesForIssue,
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
        const recorded = open.recordedServices[name];
        if (container.composeProject !== composeProject
          || !(RECLAIMABLE_STACK_SERVICES.has(container.composeService) || recorded === container.composeService)) {
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
        console.warn(`[stack-restore] ${issueId}: refused to start ${refused.join(', ')} (not in compose project ${composeProject ?? 'unknown'} or not a restorable service)`);
      }
      return { kind: 'restored', started, alreadyRunning, missing, refused };
    });
  } catch (err) {
    return { kind: 'failed', failed: [], error: String(err) };
  }
}

export type StackWakeResult =
  | { kind: 'no-stack'; reason: 'no-workspace' | 'no-compose-project' }
  | { kind: 'woken'; restored: StackRestoreResult; started: string[]; alreadyRunning: string[] }
  | { kind: 'failed'; error: string; failed: string[] };

/**
 * PAN-5250 D11: restore the open reclaim, then start every exited container of the
 * workspace's compose project whose service is wakeable. Never throws.
 */
export async function wakeWorkspaceStack(
  input: { issueId: string; workspacePath?: string | null; trigger: StackRestoreTrigger },
  deps?: Partial<StackRestoreDeps>,
): Promise<StackWakeResult> {
  try {
    const d = resolveDeps(deps);
    const { issueId, trigger } = input;
    const workspacePath = resolveWorkspacePath(issueId, input.workspacePath);
    if (!workspacePath || !d.pathExists(workspacePath)) return { kind: 'no-stack', reason: 'no-workspace' };
    const composeProject = d.composeProjectFor(workspacePath, issueId);
    if (composeProject === null) return { kind: 'no-stack', reason: 'no-compose-project' };

    const restored = await restoreReclaimedStack({ issueId, workspacePath, trigger }, deps);
    if (restored.kind === 'failed') return { kind: 'failed', error: restored.error, failed: restored.failed };

    const wakeable = d.wakeableServices(issueId);
    return await d.withLock(stackLockPath(workspacePath), async (): Promise<StackWakeResult> => {
      const listed = await d.listContainers();
      if (listed === null) return { kind: 'failed', error: 'docker listing unavailable', failed: [] };
      const started: string[] = [];
      const alreadyRunning: string[] = [];
      const failed: string[] = [];
      const errors: string[] = [];
      for (const container of listed) {
        if (container.composeProject !== composeProject || !wakeable.has(container.composeService)) continue;
        if (!CONTAINER_NAME_RE.test(container.name)) continue;
        if (container.state === 'running') {
          alreadyRunning.push(container.name);
          continue;
        }
        if (container.state !== 'exited') continue;
        const result = await d.startContainer(container.name);
        if (result.ok) {
          started.push(container.name);
        } else {
          failed.push(container.name);
          errors.push(`${container.name}: ${result.error}`);
        }
      }
      if (started.length > 0) {
        d.emitActivity({
          source: 'cloister',
          level: 'info',
          issueId,
          message: `stack-woken: ${issueId}`,
          details: `Started ${started.join(', ')} (${trigger}).`,
        });
      }
      if (failed.length > 0) return { kind: 'failed', error: errors.join('; '), failed };
      return { kind: 'woken', restored, started, alreadyRunning };
    });
  } catch (err) {
    return { kind: 'failed', error: String(err), failed: [] };
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
