/**
 * Post-merge deploy progress on the owning project's screen (PAN-3751).
 *
 * The one surviving post-merge deploy is `pan reload` (PAN-3917 D1): it takes
 * the restart lock, builds origin/main, waits on the restart gate, and restarts
 * the dashboard. Nothing here is stored. Each tick re-derives the projection
 * from runtime files that already exist — the restart lock (who is deploying,
 * and that it is alive), the restart gate (is it waiting for the operator), the
 * restart-status journal (did it start the restart, or fail) — plus the reload
 * process's own stdout when that is a regular file (the composer's reload log).
 *
 * The projection fans out through `project.deploy_changed` with `emitOnly`, so
 * it reaches `/ws/rpc` subscribers without entering the durable event log, and
 * a server restart simply derives it again. The frontend never polls.
 */
import { open, readlink, stat } from 'node:fs/promises';
import type { ProjectDeploySnapshot, RestartGateSnapshot } from '@overdeck/contracts';

import { readActiveDashboardBundle } from '../../../lib/deploy/active-dashboard-bundle.js';
import { findProjectKeyByPath } from '../../../lib/projects/project-key.js';
import { readRestartLockHolder, type RestartLockHolder } from '../../../lib/restart-lock.js';
import { readRestartStatus, type RestartStatus } from '../../../lib/restart-status.js';
import { getRestartGate } from './restart-gate.js';

export const DEPLOY_TICK_MS = 3_000;
/** How long a failed reload stays on the project row after it ended. */
export const FAILED_VISIBLE_MS = 15 * 60_000;
export const LOG_TAIL_LINES = 8;
const LOG_TAIL_BYTES = 16 * 1024;
const RELOAD_CALLER = 'pan reload';

export type DeployProjection = Record<string, ProjectDeploySnapshot>;

export interface DeployObservation {
  readonly lockHolder: RestartLockHolder | null;
  readonly gate: RestartGateSnapshot | null;
  readonly lastStatus: RestartStatus | null;
  /** Project whose repo the deploy builds from; null when it cannot be resolved. */
  readonly projectKey: string | null;
  /** When this server first saw the current lock holder. */
  readonly firstSeenAt: string;
  readonly logPath?: string;
  readonly logTail?: readonly string[];
  readonly nowMs: number;
}

/** Pure: the deploy projection one observation implies. */
export function deriveDeployProjection(obs: DeployObservation): DeployProjection {
  if (!obs.projectKey) return {};
  const holder = obs.lockHolder;
  const log = {
    ...(obs.logPath ? { logPath: obs.logPath } : {}),
    ...(obs.logTail && obs.logTail.length > 0 ? { logTail: [...obs.logTail] } : {}),
  };

  if (holder && holder.caller === RELOAD_CALLER) {
    // The reload's gate requester id always ends in its pid (restartGateRequesterId).
    const waiting = obs.gate?.pending.some((request) => request.requesterId.endsWith(`:${holder.pid}`)) ?? false;
    const restarting = obs.lastStatus?.trigger === RELOAD_CALLER
      && obs.lastStatus.phase === 'stopping'
      && obs.lastStatus.pid === holder.pid;
    const phase: ProjectDeploySnapshot['phase'] = waiting ? 'awaiting-approval' : restarting ? 'restarting' : 'building';
    return {
      [obs.projectKey]: {
        projectKey: obs.projectKey, trigger: RELOAD_CALLER, phase, pid: holder.pid,
        startedAt: obs.firstSeenAt, ...log,
      },
    };
  }

  const last = obs.lastStatus;
  // `stopping` is written with success=false before SIGTERM; it is progress, not failure.
  if (last && last.trigger === RELOAD_CALLER && !last.success && last.phase !== 'stopping') {
    const endedMs = Date.parse(last.ts);
    if (Number.isFinite(endedMs) && obs.nowMs - endedMs < FAILED_VISIBLE_MS) {
      return {
        [obs.projectKey]: {
          projectKey: obs.projectKey, trigger: RELOAD_CALLER, phase: 'failed', startedAt: last.ts,
          ...(last.error ? { error: last.error } : {}), ...log,
        },
      };
    }
  }
  return {};
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Last non-empty lines of a file, ANSI stripped; empty when unreadable. */
export async function readLogTail(path: string, lines = LOG_TAIL_LINES): Promise<string[]> {
  const handle = await open(path, 'r').catch(() => undefined);
  if (!handle) return [];
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, LOG_TAIL_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.subarray(0, bytesRead).toString('utf8')
      .replace(ANSI_PATTERN, '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-lines);
  } finally {
    await handle.close();
  }
}

/** The file behind a live process's stdout, when it is a regular file (Linux /proc). */
async function stdoutLogPath(pid: number): Promise<string | undefined> {
  const target = await readlink(`/proc/${pid}/fd/1`).catch(() => undefined);
  if (!target || !target.startsWith('/')) return undefined;
  const info = await stat(target).catch(() => undefined);
  return info?.isFile() ? target : undefined;
}

/** The deploying repo: the reload's cwd while it lives, else the active dashboard bundle's source repo. */
async function deployProjectKey(pid: number | undefined): Promise<string | null> {
  const cwd = pid ? await readlink(`/proc/${pid}/cwd`).catch(() => undefined) : undefined;
  const byCwd = cwd ? findProjectKeyByPath(cwd) : null;
  if (byCwd) return byCwd;
  const repoRoot = readActiveDashboardBundle()?.repoRoot;
  return repoRoot ? findProjectKeyByPath(repoRoot) : null;
}

export interface DeployProgressDeps {
  readLockHolder?: () => Promise<RestartLockHolder | null>;
  readGate?: () => Promise<RestartGateSnapshot | null>;
  readLastStatus?: () => Promise<RestartStatus | null>;
  resolveProjectKey?: (pid: number | undefined) => Promise<string | null>;
  resolveLogPath?: (pid: number) => Promise<string | undefined>;
  readTail?: (path: string) => Promise<string[]>;
  /** Resolves true once the projection reached subscribers. */
  emit?: (deploys: DeployProjection) => Promise<boolean>;
  now?: () => number;
}

async function emitThroughEventStore(deploys: DeployProjection): Promise<boolean> {
  try {
    const { getEventStore } = await import('../event-store.js');
    // emitOnly, never append: deploy progress is runtime-plane, re-derived every boot.
    getEventStore().emitOnly({
      type: 'project.deploy_changed',
      timestamp: new Date().toISOString(),
      payload: { deploys },
    });
    return true;
  } catch {
    // Event store not ready yet (it initialises asynchronously at boot) — the next tick retries.
    return false;
  }
}

export interface DeployProgressObserver {
  /** Re-derive; publish only when the projection changed. Returns the projection. */
  tick(): Promise<DeployProjection>;
}

export function createDeployProgressObserver(deps: DeployProgressDeps = {}): DeployProgressObserver {
  const readLockHolder = deps.readLockHolder ?? readRestartLockHolder;
  const readGate = deps.readGate ?? (() => getRestartGate().read());
  const readLastStatus = deps.readLastStatus ?? readRestartStatus;
  const resolveProjectKey = deps.resolveProjectKey ?? deployProjectKey;
  const resolveLogPath = deps.resolveLogPath ?? stdoutLogPath;
  const readTail = deps.readTail ?? ((path: string) => readLogTail(path));
  const emit = deps.emit ?? emitThroughEventStore;
  const now = deps.now ?? Date.now;

  let firstSeen: { pid: number; at: string } | null = null;
  // The last live reload's stdout file, kept after it exits so a failure can
  // still point at its log. In memory only: a server restart forgets it.
  let lastReload: { pid: number; logPath?: string } | null = null;
  let published: string | null = null;

  return {
    async tick() {
      const nowMs = now();
      const [lockHolder, lastStatus] = await Promise.all([readLockHolder(), readLastStatus()]);
      const reloadHolder = lockHolder?.caller === RELOAD_CALLER ? lockHolder : null;
      if (reloadHolder && firstSeen?.pid !== reloadHolder.pid) {
        firstSeen = { pid: reloadHolder.pid, at: new Date(nowMs).toISOString() };
      } else if (!reloadHolder) {
        firstSeen = null;
      }
      // Cheap pre-check so an idle server resolves nothing (the derivation re-checks).
      const recentFailure = lastStatus?.trigger === RELOAD_CALLER && !lastStatus.success
        && nowMs - Date.parse(lastStatus.ts) < FAILED_VISIBLE_MS;
      let projection: DeployProjection = {};
      if (reloadHolder || recentFailure) {
        const [gate, projectKey, liveLogPath] = await Promise.all([
          reloadHolder ? readGate() : Promise.resolve(null),
          resolveProjectKey(reloadHolder?.pid),
          reloadHolder ? resolveLogPath(reloadHolder.pid) : Promise.resolve(undefined),
        ]);
        if (reloadHolder) {
          lastReload = { pid: reloadHolder.pid, ...(liveLogPath ? { logPath: liveLogPath } : {}) };
        }
        const logPath = reloadHolder
          ? liveLogPath
          : lastStatus?.pid !== undefined && lastStatus.pid === lastReload?.pid ? lastReload.logPath : undefined;
        projection = deriveDeployProjection({
          lockHolder: reloadHolder, gate, lastStatus, projectKey,
          firstSeenAt: firstSeen?.at ?? new Date(nowMs).toISOString(),
          ...(logPath ? { logPath, logTail: await readTail(logPath) } : {}),
          nowMs,
        });
      }
      const serialized = JSON.stringify(projection);
      if (serialized !== published && await emit(projection)) {
        published = serialized;
      }
      return projection;
    },
  };
}

let tickTimer: ReturnType<typeof setInterval> | null = null;

/** Publish the first projection and keep re-deriving it on a server-side tick. */
export async function initDeployProgress(
  deps: DeployProgressDeps & { setIntervalFn?: typeof setInterval } = {},
): Promise<void> {
  if (tickTimer) return;
  const observer = createDeployProgressObserver(deps);
  await observer.tick();
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  tickTimer = setIntervalFn(() => {
    void observer.tick().catch((error: unknown) => {
      console.error('[deploy-progress] Tick failed:', error);
    });
  }, DEPLOY_TICK_MS);
  tickTimer.unref?.();
}
