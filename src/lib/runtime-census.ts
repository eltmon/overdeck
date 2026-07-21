import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { buildProcessTreeIndex, collectDescendantPids, type ProcessTreeIndex } from './system-health/collector.js';
import type { TmuxPaneRecord } from './tmux.js';

const execFileAsync = promisify(execFile);
export const RUNTIME_CENSUS_TTL_MS = 3_000;

const KEEPALIVE_FOREGROUND_COMMANDS = new Set(['sleep', 'bash', 'sh', 'dash', 'zsh', 'ash']);

export interface RuntimeProcessRecord {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssBytes: number;
  comm: string;
  command: string;
}

export interface RuntimeCensus {
  sampledAt: number;
  available: boolean;
  tmuxAvailable: boolean;
  processAvailable: boolean;
  stale: boolean;
  error: string | null;
  panes: readonly TmuxPaneRecord[];
  sessionNames: ReadonlySet<string>;
  panesBySession: ReadonlyMap<string, readonly TmuxPaneRecord[]>;
  processesByPid: ReadonlyMap<number, RuntimeProcessRecord>;
  processTree: ProcessTreeIndex;
}

export interface RuntimeCensusServiceDeps {
  listPanes(): Promise<readonly TmuxPaneRecord[]>;
  readProcesses(): Promise<readonly RuntimeProcessRecord[]>;
  now?: () => number;
  ttlMs?: number;
}

export interface RuntimeCensusService {
  get(options?: { fresh?: boolean }): Promise<RuntimeCensus>;
  peek(): RuntimeCensus | null;
  reset(): void;
}

export function parseRuntimeProcessTable(output: string): RuntimeProcessRecord[] {
  return output.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) return [];
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const cpuPercent = Number(match[3]);
    const rssKb = Number(match[4]);
    if (![pid, ppid, cpuPercent, rssKb].every(Number.isFinite)) return [];
    return [{
      pid,
      ppid,
      cpuPercent,
      rssBytes: rssKb * 1024,
      comm: match[5] ?? '',
      command: match[6] ?? match[5] ?? '',
    }];
  });
}

async function readRuntimeProcessTable(): Promise<RuntimeProcessRecord[]> {
  const { stdout } = await execFileAsync(
    'ps',
    ['-eo', 'pid=,ppid=,pcpu=,rss=,comm=,args='],
    { encoding: 'utf8', timeout: 10_000 },
  );
  return parseRuntimeProcessTable(String(stdout));
}

function buildRuntimeCensus(
  panes: readonly TmuxPaneRecord[],
  processes: readonly RuntimeProcessRecord[],
  sampledAt: number,
  options: {
    tmuxAvailable: boolean;
    processAvailable: boolean;
    stale?: boolean;
    error?: string | null;
  },
): RuntimeCensus {
  const panesBySession = new Map<string, TmuxPaneRecord[]>();
  for (const pane of panes) {
    const sessionPanes = panesBySession.get(pane.sessionName);
    if (sessionPanes) sessionPanes.push(pane);
    else panesBySession.set(pane.sessionName, [pane]);
  }
  const processesByPid = new Map(processes.map((process) => [process.pid, process]));
  return {
    sampledAt,
    available: options.tmuxAvailable,
    tmuxAvailable: options.tmuxAvailable,
    processAvailable: options.processAvailable,
    stale: options.stale ?? false,
    error: options.error ?? null,
    panes,
    sessionNames: new Set(panesBySession.keys()),
    panesBySession,
    processesByPid,
    processTree: buildProcessTreeIndex(processes),
  };
}

export function createRuntimeCensusService(deps: RuntimeCensusServiceDeps): RuntimeCensusService {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? RUNTIME_CENSUS_TTL_MS;
  let snapshot: RuntimeCensus | null = null;
  let inFlight: Promise<RuntimeCensus> | null = null;

  const refresh = (): Promise<RuntimeCensus> => {
    if (inFlight) return inFlight;
    inFlight = Promise.allSettled([deps.listPanes(), deps.readProcesses()])
      .then(([panesResult, processesResult]) => {
        const errors: string[] = [];
        if (panesResult.status === 'rejected') {
          errors.push(panesResult.reason instanceof Error ? panesResult.reason.message : String(panesResult.reason));
        }
        if (processesResult.status === 'rejected') {
          errors.push(processesResult.reason instanceof Error ? processesResult.reason.message : String(processesResult.reason));
        }
        const panes = panesResult.status === 'fulfilled'
          ? panesResult.value
          : snapshot?.panes ?? [];
        const processes = processesResult.status === 'fulfilled'
          ? processesResult.value
          : [...(snapshot?.processesByPid.values() ?? [])];
        snapshot = buildRuntimeCensus(panes, processes, now(), {
          tmuxAvailable: panesResult.status === 'fulfilled',
          processAvailable: processesResult.status === 'fulfilled',
          stale: errors.length > 0,
          error: errors.length > 0 ? errors.join('; ') : null,
        });
        return snapshot;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    get(options) {
      if (!options?.fresh && snapshot && now() - snapshot.sampledAt < ttlMs) {
        return Promise.resolve(snapshot);
      }
      return refresh();
    },
    peek() {
      return snapshot;
    },
    reset() {
      snapshot = null;
      inFlight = null;
    },
  };
}

const runtimeCensusService = createRuntimeCensusService({
  listPanes: async () => {
    const { listAllPaneRecords } = await import('./tmux.js');
    return Effect.runPromise(listAllPaneRecords());
  },
  readProcesses: readRuntimeProcessTable,
});

export function getRuntimeCensus(options?: { fresh?: boolean }): Promise<RuntimeCensus> {
  return runtimeCensusService.get(options);
}

export function refreshRuntimeCensus(): Promise<RuntimeCensus> {
  return runtimeCensusService.get({ fresh: true });
}

export function getRuntimeCensusSnapshot(): RuntimeCensus | null {
  return runtimeCensusService.peek();
}

export function resetRuntimeCensusForTests(): void {
  runtimeCensusService.reset();
}

export function panePidsForSession(census: RuntimeCensus, sessionName: string): number[] {
  return (census.panesBySession.get(sessionName) ?? []).map((pane) => pane.panePid);
}

export function descendantPidsForSession(census: RuntimeCensus, sessionName: string): Set<number> {
  const descendants = new Set<number>();
  for (const panePid of panePidsForSession(census, sessionName)) {
    for (const pid of collectDescendantPids(panePid, census.processTree)) descendants.add(pid);
  }
  return descendants;
}

export function runtimeCensusHasHarnessProcess(census: RuntimeCensus, sessionName: string): boolean {
  if (!census.tmuxAvailable || !census.processAvailable) return true;
  const panePids = panePidsForSession(census, sessionName);
  if (panePids.length === 0) return false;
  for (const panePid of panePids) {
    for (const pid of collectDescendantPids(panePid, census.processTree)) {
      const comm = census.processesByPid.get(pid)?.comm;
      if (comm && !KEEPALIVE_FOREGROUND_COMMANDS.has(comm)) return true;
    }
  }
  return false;
}
