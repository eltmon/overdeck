/**
 * Deacon janitor (PAN-1706): reap leftover `playwright-mcp` servers and their
 * headless Chromium trees.
 *
 * Agent sessions spawn `npx @playwright/mcp --isolated` for browser UAT and
 * routinely leave the browser open on the dashboard when they finish. Each
 * leftover headless page runs the full React app with all its pollers, so a
 * handful of ghosts multiplies dashboard load several-fold (observed 4×
 * during the PAN-1705 queueing collapse).
 *
 * Two independent rules, both built on a pure selection function:
 *
 * 1. ORPHANED — the mcp server's ancestor chain no longer contains a harness
 *    process (claude / pi / codex / pty-supervisor): the owning session is
 *    gone, the whole tree (mcp server + browser) is reaped. A minimum age
 *    avoids racing a session that is still starting up.
 * 2. STALE BROWSER — the owner is still alive but the browser has been up
 *    longer than any legitimate UAT run. Only the Chromium descendants are
 *    killed; playwright-mcp launches a fresh browser on the session's next
 *    tool call, so a live session loses nothing.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emitActivityEntrySync } from '../activity-logger.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { isDeaconGloballyPaused } from '../database/app-settings.js';

const execFileAsync = promisify(execFile);

const DEFAULT_ORPHAN_MIN_AGE_SECONDS = 10 * 60;
const DEFAULT_STALE_BROWSER_AGE_SECONDS = 2 * 60 * 60;
const REAP_GRACE_MS = 5000;

/** A harness process anywhere in the ancestor chain marks the tree as owned. */
const HARNESS_ARGS_RE = /(^|[/\s])(claude|pi|codex)([\s]|$)|pty-supervisor/;
const PLAYWRIGHT_MCP_RE = /playwright-mcp|@playwright\/mcp/;
const BROWSER_ARGS_RE = /(^|\/)(chrome|chromium|headless_shell)([\s]|$)|--type=|--headless/;

export interface ProcEntry {
  pid: number;
  ppid: number;
  /** elapsed seconds since the process started (ps etimes). */
  ageSeconds: number;
  args: string;
}

export interface PlaywrightReapTargets {
  /** Whole orphaned trees: mcp server pids + all their descendants. */
  orphanTreePids: number[];
  /** Stale browser processes under still-owned mcp servers. */
  staleBrowserPids: number[];
}

export interface SelectPlaywrightReapOptions {
  procs: ProcEntry[];
  orphanMinAgeSeconds?: number;
  staleBrowserAgeSeconds?: number;
}

/** Parse `ps -eo pid=,ppid=,etimes=,args=` output. Exported for testing. */
export function parseProcTable(psStdout: string): ProcEntry[] {
  const procs: ProcEntry[] = [];
  for (const rawLine of psStdout.split('\n')) {
    const m = rawLine.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    procs.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      ageSeconds: Number(m[3]),
      args: m[4],
    });
  }
  return procs;
}

function collectDescendants(rootPid: number, childrenByPpid: Map<number, ProcEntry[]>): ProcEntry[] {
  const result: ProcEntry[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const child of childrenByPpid.get(pid) ?? []) {
      result.push(child);
      queue.push(child.pid);
    }
  }
  return result;
}

/** Walk ancestors of `pid`; true if any of them looks like a harness process. */
function hasHarnessAncestor(pid: number, byPid: Map<number, ProcEntry>): boolean {
  let current = byPid.get(pid);
  const seen = new Set<number>();
  while (current && current.ppid > 1 && !seen.has(current.pid)) {
    seen.add(current.pid);
    const parent = byPid.get(current.ppid);
    if (!parent) break;
    if (HARNESS_ARGS_RE.test(parent.args)) return true;
    current = parent;
  }
  return false;
}

/**
 * Pure selection of which pids to reap. Deterministic and side-effect-free so
 * the kill set can be unit-tested.
 */
export function selectPlaywrightReapTargets(opts: SelectPlaywrightReapOptions): PlaywrightReapTargets {
  const orphanMinAge = opts.orphanMinAgeSeconds ?? DEFAULT_ORPHAN_MIN_AGE_SECONDS;
  const staleBrowserAge = opts.staleBrowserAgeSeconds ?? DEFAULT_STALE_BROWSER_AGE_SECONDS;

  const byPid = new Map(opts.procs.map((p) => [p.pid, p]));
  const childrenByPpid = new Map<number, ProcEntry[]>();
  for (const p of opts.procs) {
    const list = childrenByPpid.get(p.ppid);
    if (list) list.push(p);
    else childrenByPpid.set(p.ppid, [p]);
  }

  // mcp "servers" are the node processes actually running playwright-mcp —
  // not sh/npm wrappers (those die with the tree anyway) and not browsers.
  const mcpServers = opts.procs.filter(
    (p) => PLAYWRIGHT_MCP_RE.test(p.args) && !BROWSER_ARGS_RE.test(p.args) && /(^|\/)node(js)?\s/.test(p.args),
  );

  const orphanTreePids = new Set<number>();
  const staleBrowserPids = new Set<number>();

  for (const server of mcpServers) {
    const descendants = collectDescendants(server.pid, childrenByPpid);
    if (!hasHarnessAncestor(server.pid, byPid)) {
      if (server.ageSeconds >= orphanMinAge) {
        orphanTreePids.add(server.pid);
        for (const d of descendants) orphanTreePids.add(d.pid);
      }
      continue;
    }
    for (const d of descendants) {
      if (BROWSER_ARGS_RE.test(d.args) && d.ageSeconds >= staleBrowserAge) {
        staleBrowserPids.add(d.pid);
      }
    }
  }

  return {
    orphanTreePids: [...orphanTreePids],
    staleBrowserPids: [...staleBrowserPids].filter((pid) => !orphanTreePids.has(pid)),
  };
}

async function listProcs(): Promise<ProcEntry[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,etimes=,args='], {
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseProcTable(stdout);
  } catch {
    return [];
  }
}

export interface PlaywrightReapDeps {
  listProcs?: () => Promise<ProcEntry[]>;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  orphanMinAgeSeconds?: number;
  staleBrowserAgeSeconds?: number;
  graceMs?: number;
}

/**
 * Find and reap leftover playwright-mcp trees / stale browsers. Returns
 * human-readable action strings for the patrol log. Honors the global deacon
 * pause and emits a `cloister` activity event per reap.
 */
export async function reapLeftoverPlaywrightBrowsers(deps: PlaywrightReapDeps = {}): Promise<string[]> {
  if (isDeaconGloballyPaused()) return [];

  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const graceMs = deps.graceMs ?? REAP_GRACE_MS;
  const procs = await (deps.listProcs ?? listProcs)();
  const targets = selectPlaywrightReapTargets({
    procs,
    orphanMinAgeSeconds: deps.orphanMinAgeSeconds,
    staleBrowserAgeSeconds: deps.staleBrowserAgeSeconds,
  });

  const labelled: Array<{ pid: number; label: string }> = [
    ...targets.orphanTreePids.map((pid) => ({ pid, label: 'orphaned playwright-mcp tree' })),
    ...targets.staleBrowserPids.map((pid) => ({ pid, label: 'stale playwright browser' })),
  ];
  if (labelled.length === 0) return [];

  for (const { pid } of labelled) {
    try { kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  await new Promise((resolve) => setTimeout(resolve, graceMs));

  const actions: string[] = [];
  for (const { pid, label } of labelled) {
    let alive = false;
    try { kill(pid, 0); alive = true; } catch { alive = false; }
    if (alive) {
      try { kill(pid, 'SIGKILL'); } catch { /* race: gone between check and kill */ }
    }
    const message = `Reaped ${label} pid ${pid}`;
    logDeaconEventSync(`[playwright-reaper] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `Deacon ${message.toLowerCase()}` });
    actions.push(message);
  }
  return actions;
}
