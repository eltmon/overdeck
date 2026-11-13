/**
 * Explorer watch supervisor (PAN-5183, FR-3, FR-A4, NFR-2, NFR-5, D-5).
 *
 * Runs in the dashboard process and owns the forked watcher child
 * (`explorer-watch-child.js`), which is the only process that loads
 * @parcel/watcher. This module never imports it, not even as a type.
 *
 * - The child is forked lazily on the first subscription and killed 60 s
 *   after the last one ends.
 * - A child that exits, or sends nothing for 15 s, is a crash: it is
 *   replaced, every root is re-watched, and every listener gets an
 *   `overflow` event so clients re-list.
 * - After 3 restarts inside 5 minutes the supervisor stops forking (poll
 *   mode) and sends `overflow` to every listener every 5 s. A root the
 *   child could not watch (`watch-failed`) is polled the same way.
 * - Nothing here can throw into the dashboard: sends to a closed channel
 *   are skipped and every child has an `error` listener.
 */
import { fork as nodeFork, type ChildProcess } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ExplorerWatchEvent } from '@overdeck/contracts';
import { runGit } from './git-exec.js';
import type { ChildToSupervisor, SupervisorToChild } from './watch-protocol.js';

export interface WatchSpec {
  id: string;
  absPath: string;
  kind: 'project' | 'issue' | 'workspace';
}

export type WatchListener = (events: ExplorerWatchEvent[]) => void;

export interface ExplorerWatchSupervisor {
  /** Resolves once the root is being watched (or polled); the result unsubscribes. */
  subscribe(spec: WatchSpec, listener: WatchListener): Promise<() => void>;
  dispose(): Promise<void>;
}

export interface WatchSupervisorDeps {
  fork?: typeof nodeFork;
  scriptPath?: string;
  execArgv?: string[];
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  listTopLevelIgnored?: (absPath: string) => Promise<string[]>;
  log?: (line: string) => void;
}

export const HEARTBEAT_CHECK_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 15_000;
export const RESTART_WINDOW_MS = 5 * 60_000;
export const MAX_RESTARTS_IN_WINDOW = 3;
export const POLL_INTERVAL_MS = 5000;
export const IDLE_KILL_MS = 60_000;

const OVERFLOW: ExplorerWatchEvent[] = [{ kind: 'overflow', path: '' }];

/** Path of the watcher child script beside the calling module (source, dist, or sibling). */
export function resolveWatchChildScript(moduleUrl: string = import.meta.url): string {
  if (moduleUrl.endsWith('.ts')) return fileURLToPath(new URL('./watch-child.ts', moduleUrl));
  const distMarker = '/dist/';
  const distIndex = moduleUrl.lastIndexOf(distMarker);
  if (distIndex !== -1) {
    return fileURLToPath(new URL('dashboard/explorer-watch-child.js', moduleUrl.slice(0, distIndex + distMarker.length)));
  }
  return fileURLToPath(new URL('./explorer-watch-child.js', moduleUrl));
}

/** Top-level directories of `absPath` that git ignores; [] when git cannot say. */
async function defaultListTopLevelIgnored(absPath: string): Promise<string[]> {
  try {
    const dirs = (await readdir(absPath, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    if (dirs.length === 0) return [];
    const run = await runGit(absPath, ['check-ignore', '-z', '--stdin'], { input: `${dirs.join('\0')}\0` });
    if (run.code !== 0 && run.code !== 1) return [];
    return run.stdout.toString('utf8').split('\0').filter((name) => name !== '');
  } catch {
    return [];
  }
}

interface RootEntry {
  spec: WatchSpec;
  listeners: Set<WatchListener>;
  /** Null until listTopLevelIgnored resolves. */
  topLevelDirs: string[] | null;
  /** Whether a `watch` for this root went to the current child. */
  watchSent: boolean;
  /** The child could not watch it; it is polled instead. */
  polling: boolean;
  ready: Promise<void>;
}

export function createExplorerWatchSupervisor(deps: WatchSupervisorDeps = {}): ExplorerWatchSupervisor {
  const fork = deps.fork ?? nodeFork;
  const scriptPath = deps.scriptPath ?? resolveWatchChildScript();
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimeout ?? setTimeout;
  const clearTimer = deps.clearTimeout ?? clearTimeout;
  const setRepeat = deps.setInterval ?? setInterval;
  const clearRepeat = deps.clearInterval ?? clearInterval;
  const listTopLevelIgnored = deps.listTopLevelIgnored ?? defaultListTopLevelIgnored;
  const log = deps.log ?? ((line: string) => console.error(line));

  const roots = new Map<string, RootEntry>();
  let child: ChildProcess | null = null;
  let lastHeartbeatAt = 0;
  let heartbeatCheck: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let pollMode = false;
  let restarts: number[] = [];
  let disposed = false;

  const totalListeners = () => [...roots.values()].reduce((n, r) => n + r.listeners.size, 0);

  const notify = (entry: RootEntry, events: ExplorerWatchEvent[]) => {
    for (const listener of [...entry.listeners]) {
      try {
        listener(events);
      } catch (error) {
        log(`[explorer-watch] listener for ${entry.spec.id} threw: ${String(error)}`);
      }
    }
  };

  const send = (msg: SupervisorToChild): boolean => {
    if (!child || !child.connected) return false;
    try {
      child.send(msg);
      return true;
    } catch (error) {
      log(`[explorer-watch] send failed: ${String(error)}`);
      return false;
    }
  };

  const sendWatch = (entry: RootEntry) => {
    if (entry.topLevelDirs === null || entry.polling || pollMode) return;
    entry.watchSent = send({
      type: 'watch',
      rootId: entry.spec.id,
      absPath: entry.spec.absPath,
      topLevelDirs: entry.topLevelDirs,
    });
  };

  const stopHeartbeatCheck = () => {
    if (heartbeatCheck !== null) clearRepeat(heartbeatCheck);
    heartbeatCheck = null;
  };

  /** Drops the current child without treating its end as a crash. */
  const dropChild = (signal: NodeJS.Signals) => {
    const old = child;
    child = null;
    stopHeartbeatCheck();
    for (const entry of roots.values()) entry.watchSent = false;
    if (old && old.exitCode === null && old.signalCode === null) {
      try {
        old.kill(signal);
      } catch {
        // already gone
      }
    }
  };

  const syncPollTimer = () => {
    const needed = pollMode || [...roots.values()].some((r) => r.polling);
    if (needed && pollTimer === null) {
      pollTimer = setRepeat(() => {
        for (const entry of roots.values()) if (pollMode || entry.polling) notify(entry, OVERFLOW);
      }, POLL_INTERVAL_MS);
    } else if (!needed && pollTimer !== null) {
      clearRepeat(pollTimer);
      pollTimer = null;
    }
  };

  const onMessage = (from: ChildProcess, msg: ChildToSupervisor) => {
    if (from !== child) return;
    lastHeartbeatAt = now();
    if (msg.type === 'events') {
      const entry = roots.get(msg.rootId);
      if (entry && !entry.polling) notify(entry, msg.events);
    } else if (msg.type === 'watch-failed') {
      const entry = roots.get(msg.rootId);
      if (entry) {
        entry.polling = true;
        entry.watchSent = false;
        syncPollTimer();
      }
      log(`[explorer-watch] polling fallback root=${msg.rootId}: ${msg.message}`);
    } else if (msg.type === 'error') {
      log(`[explorer-watch] child error root=${msg.rootId}: ${msg.message}`);
    }
  };

  const onCrash = (from: ChildProcess, why: string) => {
    if (from !== child || disposed) return;
    dropChild('SIGKILL');
    log(`[explorer-watch] watcher child ${why}`);
    // No one is listening: the next subscribe forks a fresh child.
    if (totalListeners() === 0) return;

    const t = now();
    restarts = restarts.filter((at) => t - at < RESTART_WINDOW_MS);
    if (restarts.length >= MAX_RESTARTS_IN_WINDOW) {
      pollMode = true;
      log('[explorer-watch] polling fallback');
      syncPollTimer();
      return;
    }
    restarts.push(t);
    startChild();
    for (const entry of roots.values()) {
      // A root still listing its top-level dirs sends its own watch when ready.
      sendWatch(entry);
      notify(entry, OVERFLOW);
    }
  };

  function startChild(): void {
    let forked: ChildProcess;
    try {
      forked = fork(scriptPath, [], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        execArgv: deps.execArgv ?? [],
        env: process.env,
      });
    } catch (error) {
      log(`[explorer-watch] fork failed: ${String(error)}`);
      pollMode = true;
      log('[explorer-watch] polling fallback');
      syncPollTimer();
      return;
    }
    child = forked;
    lastHeartbeatAt = now();

    let stderrTail = '';
    forked.stderr?.on('data', (chunk: Buffer | string) => {
      const lines = (stderrTail + chunk.toString()).split('\n');
      stderrTail = lines.pop() ?? '';
      for (const line of lines) if (line.trim() !== '') log(`[explorer-watch-child] ${line}`);
    });
    forked.on('message', (msg) => onMessage(forked, msg as ChildToSupervisor));
    forked.on('error', (error) => log(`[explorer-watch] child process error: ${String(error)}`));
    forked.on('exit', (code, signal) => onCrash(forked, `exited (code=${code} signal=${signal})`));

    heartbeatCheck = setRepeat(() => {
      if (child === forked && now() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        onCrash(forked, `sent no heartbeat for ${HEARTBEAT_TIMEOUT_MS} ms`);
      }
    }, HEARTBEAT_CHECK_MS);
  }

  const ensureChild = () => {
    if (child === null && !pollMode && !disposed) startChild();
  };

  const cancelIdle = () => {
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = null;
  };

  const onLastListenerGone = () => {
    pollMode = false;
    restarts = [];
    syncPollTimer();
    cancelIdle();
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (totalListeners() === 0) dropChild('SIGTERM');
    }, IDLE_KILL_MS);
  };

  return {
    async subscribe(spec, listener) {
      if (disposed) throw new Error('explorer watch supervisor is disposed');
      cancelIdle();
      let entry = roots.get(spec.id);
      if (!entry) {
        const created: RootEntry = {
          spec,
          listeners: new Set(),
          topLevelDirs: null,
          watchSent: false,
          polling: false,
          ready: Promise.resolve(),
        };
        created.ready = (async () => {
          const ignored = await listTopLevelIgnored(spec.absPath).catch(() => []);
          created.topLevelDirs = [...new Set([...ignored, ...(spec.kind === 'project' ? ['workspaces'] : [])])];
          if (roots.get(spec.id) !== created || created.listeners.size === 0) return;
          ensureChild();
          sendWatch(created);
        })();
        roots.set(spec.id, created);
        entry = created;
      }
      entry.listeners.add(listener);
      await entry.ready;

      const owner = entry;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        owner.listeners.delete(listener);
        if (owner.listeners.size > 0 || roots.get(spec.id) !== owner) return;
        roots.delete(spec.id);
        if (owner.watchSent) send({ type: 'unwatch', rootId: spec.id });
        owner.watchSent = false;
        syncPollTimer();
        if (totalListeners() === 0) onLastListenerGone();
      };
    },

    async dispose() {
      disposed = true;
      cancelIdle();
      if (pollTimer !== null) clearRepeat(pollTimer);
      pollTimer = null;
      dropChild('SIGTERM');
      roots.clear();
    },
  };
}

let singleton: ExplorerWatchSupervisor | null = null;

/** The dashboard's one watch supervisor, created on first use. */
export function getExplorerWatchSupervisor(): ExplorerWatchSupervisor {
  if (!singleton) {
    const scriptPath = resolveWatchChildScript();
    singleton = createExplorerWatchSupervisor({
      scriptPath,
      // A source checkout (vitest, tsx) runs the TypeScript entry through tsx.
      execArgv: scriptPath.endsWith('.ts') ? ['--import', 'tsx'] : [],
    });
  }
  return singleton;
}
