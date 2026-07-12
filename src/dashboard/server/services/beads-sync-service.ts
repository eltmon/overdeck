import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { withBdProcessLock } from '../../../lib/bd-process-lock.js';
import { listProjectsSync } from '../../../lib/projects.js';
import { resolveStateReadHomeSync } from '../../../lib/state-read-home.js';
import { getBeadsHealth, recordBeadsPull, recordBeadsSyncError } from '../../../lib/beads/telemetry.js';

const execFileAsync = promisify(execFile);
// 120s: a pull holds the shared bd lock for ~15s on this repo. At 15s the
// lock was held nearly continuously and starved every foreground read
// (observed 60-90s route hangs). The out-of-lock head-check below makes most
// ticks free, so a shorter interval buys nothing.
const DEFAULT_INTERVAL_MS = 120_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export interface BeadsSyncHealth {
  localHead: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

const healthByProject = new Map<string, BeadsSyncHealth>();

export function getBeadsSyncHealth(projectKey: string): BeadsSyncHealth {
  return healthByProject.get(projectKey) ?? { localHead: null, lastSyncedAt: null, lastError: null };
}

export interface BeadsSyncServiceDependencies {
  projects?: () => Array<{ key: string; path: string; beadsCwd: string }>;
  execute?: (args: readonly string[], cwd: string) => Promise<string>;
  emit?: (event: { type: 'beads.freshness_changed'; timestamp: string; payload: { projectKey: string; localHead: string; lastSyncedAt: string } }) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  intervalMs?: number;
  withLock?: typeof withBdProcessLock;
  remoteDoltHead?: (projectPath: string) => Promise<string | null>;
}

function parseHead(status: string): string | null {
  return /^Commit:\s*([0-9a-f]{7,40})\s*$/im.exec(status)?.[1] ?? null;
}

async function defaultExecute(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('bd', [...args], { cwd, encoding: 'utf8', timeout: 30_000 });
  return stdout;
}

/**
 * Cheap remote-head probe that runs OUTSIDE the bd process lock. A `bd dolt
 * pull` can take ~15s and holds the shared lock; pulling unconditionally on
 * every tick starves foreground beads reads (NFR-4). Returns null when the
 * ref cannot be read — callers treat that as "unknown" and fail open.
 */
async function defaultRemoteDoltHead(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', 'origin', 'refs/dolt/data'], { cwd: projectPath, encoding: 'utf8', timeout: 15_000 });
    return stdout.trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

function defaultProjects() {
  return listProjectsSync().map(({ key, config }) => ({
    key,
    path: config.path,
    beadsCwd: resolveStateReadHomeSync(config).root,
  }));
}

export function createBeadsSyncService(dependencies: BeadsSyncServiceDependencies = {}) {
  const projects = dependencies.projects ?? defaultProjects;
  const execute = dependencies.execute ?? defaultExecute;
  const emit = dependencies.emit ?? (() => undefined);
  const sleep = dependencies.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const intervalMs = dependencies.intervalMs ?? DEFAULT_INTERVAL_MS;
  const withLock = dependencies.withLock ?? withBdProcessLock;
  const remoteDoltHead = dependencies.remoteDoltHead ?? defaultRemoteDoltHead;
  const lastRemoteHead = new Map<string, string>();
  let stopped = false;
  let failures = 0;

  async function syncOnce(): Promise<void> {
    for (const project of projects()) {
      try {
        // Skip the expensive locked pull when the remote Dolt head is
        // verifiably unchanged. Unknown (null) fails open into the pull.
        const remoteHead = await remoteDoltHead(project.path);
        if (remoteHead && remoteHead === lastRemoteHead.get(project.key)) continue;
        await withLock('background beads pull for ' + project.key, async () => {
          const before = parseHead(await execute(['vc', 'status'], project.beadsCwd));
          await execute(['dolt', 'pull'], project.beadsCwd);
          const after = parseHead(await execute(['vc', 'status'], project.beadsCwd));
          const lastSyncedAt = new Date(now()).toISOString();
          healthByProject.set(project.key, { localHead: after, lastSyncedAt, lastError: null });
          recordBeadsPull(project.key, after, after, new Date(lastSyncedAt));
          if (after && after !== before) {
            emit({
              type: 'beads.freshness_changed',
              timestamp: lastSyncedAt,
              payload: { projectKey: project.key, localHead: after, lastSyncedAt },
            });
          }
        }, { workspacePath: project.beadsCwd, acquisitionTimeoutMs: 5_000 });
        if (remoteHead) lastRemoteHead.set(project.key, remoteHead);
        failures = 0;
      } catch (error) {
        failures += 1;
        const previous = getBeadsSyncHealth(project.key);
        healthByProject.set(project.key, {
          ...previous,
          lastError: 'Beads synchronization failed; dashboard bead progress may be stale. ' + (error instanceof Error ? error.message : String(error)),
        });
        recordBeadsSyncError(project.key, getBeadsSyncHealth(project.key).lastError!);
      }
    }
  }

  async function run(): Promise<void> {
    while (!stopped) {
      await syncOnce();
      const backoff = Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** failures);
      const jitter = Math.floor(backoff * 0.2 * random());
      await sleep(backoff + jitter);
    }
  }

  return { run, syncOnce, stop: () => { stopped = true; } };
}

export { getBeadsHealth };
