/**
 * Deacon janitor (PAN-1625): reap orphaned `dist/dashboard/server.js` processes.
 *
 * A failed `pan dev` / `pan up` restart can leave a second dashboard server
 * running that already lost the port. It is not harmless — it can keep serving
 * stale data and, worse, run a SECOND Deacon racing the live one (single-deacon
 * invariant; PAN-821/PAN-698).
 *
 * THIS RUNS INSIDE THE LIVE SERVER PROCESS. The Deacon is in-process with
 * `dist/dashboard/server.js`, so `process.pid` IS the live server. The hard
 * safety rule: never kill `process.pid`, never kill the current port owner,
 * never kill a just-spawned server (could be a legitimate restart handoff), and
 * never kill a process living inside a container (a workspace-container server
 * is legitimate — only host-level orphans are reaped). Everything is built on a
 * pure, unit-tested selection function so the kill set is auditable.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { isDeaconGloballyPaused } from '../overdeck/control-settings.js';
import { loadConfig } from '../config.js';

const execFileAsync = promisify(execFile);

const DEFAULT_MIN_AGE_SECONDS = 120;
const REAP_GRACE_MS = 5000;
const SERVER_SCRIPT = 'dist/dashboard/server.js';

export interface DashboardServerProc {
  pid: number;
  /** elapsed seconds since the process started (ps etimes). */
  ageSeconds: number;
}

export interface SelectOrphanOptions {
  servers: DashboardServerProc[];
  /** The live server's own pid — NEVER reaped. */
  selfPid: number;
  /** The pid currently listening on the dashboard API port — NEVER reaped. */
  portOwnerPid: number | null;
  /** Don't reap a server younger than this (avoids racing a restart handoff). */
  minAgeSeconds?: number;
}

/**
 * Pure selection of which dashboard-server pids are safe to reap. Excludes the
 * deacon's own process, the live port owner, and any just-spawned server. Fully
 * deterministic and side-effect-free so the kill set can be unit-tested.
 */
export function selectOrphanServerPids(opts: SelectOrphanOptions): number[] {
  const minAge = opts.minAgeSeconds ?? DEFAULT_MIN_AGE_SECONDS;
  return opts.servers
    .filter((s) => s.pid !== opts.selfPid)
    .filter((s) => opts.portOwnerPid == null || s.pid !== opts.portOwnerPid)
    .filter((s) => s.ageSeconds >= minAge)
    .map((s) => s.pid);
}

/** Parse `ps -eo pid=,etimes=,args=` output into dashboard-server processes.
 *  Exported for testing — only true `node … dist/dashboard/server.js`
 *  invocations match; shell/grep/ps lines that merely mention the path do not. */
export function parseDashboardServerProcs(psStdout: string): DashboardServerProc[] {
  const procs: DashboardServerProc[] = [];
  for (const rawLine of psStdout.split('\n')) {
    const line = rawLine.trim();
    const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pidStr, ageStr, args] = m;
    if (!args.includes(SERVER_SCRIPT)) continue;
    // The executable (first token) must be a node binary — excludes
    // `/bin/bash -c '… dist/dashboard/server.js …'`, grep, ps, etc.
    const exe = args.split(/\s+/)[0] ?? '';
    if (!/(^|\/)node(js)?$/.test(exe)) continue;
    procs.push({ pid: Number(pidStr), ageSeconds: Number(ageStr) });
  }
  return procs;
}

async function listDashboardServers(): Promise<DashboardServerProc[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,etimes=,args='], {
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseDashboardServerProcs(stdout);
  } catch {
    return [];
  }
}

/** Best-effort: which pid listens on the dashboard API port. Returns null when
 *  it can't be determined — `selfPid` remains the primary guard. */
async function resolvePortOwner(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf-8' });
    const pid = Number(stdout.trim().split('\n')[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** True if the pid lives inside a container (docker/containerd/kube). A
 *  workspace-container dashboard server is legitimate and must never be reaped
 *  by the host deacon. On platforms without /proc (macOS) container processes
 *  aren't host-visible, so this is a no-op (returns false). */
async function isContainerProcess(pid: number): Promise<boolean> {
  try {
    const cgroup = await readFile(`/proc/${pid}/cgroup`, 'utf-8');
    return /docker|containerd|kubepods|libpod/.test(cgroup);
  } catch {
    return false;
  }
}

export interface ReapDeps {
  selfPid?: number;
  apiPort?: number;
  listServers?: () => Promise<DashboardServerProc[]>;
  resolvePortOwner?: (port: number) => Promise<number | null>;
  isContainerProcess?: (pid: number) => Promise<boolean>;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  minAgeSeconds?: number;
  graceMs?: number;
}

/**
 * Find and reap orphaned host-level dashboard servers. Returns a list of
 * human-readable action strings (one per reap) for the patrol log. Honors the
 * global deacon pause and emits a `cloister` activity event per reap so it
 * surfaces in the Deacon activity view.
 */
export async function reapOrphanedDashboardServers(deps: ReapDeps = {}): Promise<string[]> {
  if (isDeaconGloballyPaused()) return [];

  const selfPid = deps.selfPid ?? process.pid;
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const graceMs = deps.graceMs ?? REAP_GRACE_MS;
  const apiPort = deps.apiPort ?? await Effect.runPromise(
    loadConfig().pipe(
      Effect.map((c) => c.dashboard.api_port ?? 3011),
      Effect.catch(() => Effect.succeed(3011)),
    ),
  );

  const listServers = deps.listServers ?? listDashboardServers;
  const portOwner = deps.resolvePortOwner ?? resolvePortOwner;
  const inContainer = deps.isContainerProcess ?? isContainerProcess;

  const [servers, portOwnerPid] = await Promise.all([listServers(), portOwner(apiPort)]);
  let candidates = selectOrphanServerPids({
    servers,
    selfPid,
    portOwnerPid,
    minAgeSeconds: deps.minAgeSeconds,
  });

  // Drop any candidate that lives inside a container (legitimate workspace server).
  const containerFlags = await Promise.all(candidates.map((pid) => inContainer(pid)));
  candidates = candidates.filter((_, i) => !containerFlags[i]);

  if (candidates.length === 0) return [];

  // SIGTERM first, then escalate survivors to SIGKILL after a grace window.
  for (const pid of candidates) {
    try { kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  await new Promise((resolve) => setTimeout(resolve, graceMs));

  const actions: string[] = [];
  for (const pid of candidates) {
    let alive = false;
    try { kill(pid, 0); alive = true; } catch { alive = false; }
    if (alive) {
      try { kill(pid, 'SIGKILL'); } catch { /* race: gone between check and kill */ }
    }
    const message = `Reaped orphan dashboard server pid ${pid}`;
    logDeaconEventSync(`[orphan-server-reaper] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `Deacon ${message.toLowerCase()}` });
    actions.push(message);
  }
  return actions;
}
