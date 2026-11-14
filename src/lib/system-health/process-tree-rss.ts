/**
 * Process-tree resident memory (PAN-5248).
 *
 * The quality-gate admission queue needs two numbers per gate: the current
 * RSS of an admitted owner's process tree (to compute its reservation) and
 * the peak RSS a gate reached while it ran (to estimate its next footprint).
 * Both come from `/proc`: the tree is every descendant of a root pid by
 * ppid, and each member's memory is the `VmRSS:` line of its `status` file.
 *
 * A leaf module on purpose: the tsc wrapper and the Vitest globalSetup load
 * it, so it imports only Node built-ins and never the runaway patrol or the
 * memory governor (both pull in dashboard routes and agent state).
 */

import { readdir, readFile } from 'node:fs/promises';

/** Reads the parts of `/proc` the tree walk needs; injectable for tests. */
export interface ProcReader {
  /** Numeric entries of `/proc`. */
  listPids(): Promise<number[]>;
  /** Contents of `/proc/<pid>/stat`, or null when the process is gone. */
  readStat(pid: number): Promise<string | null>;
  /** Contents of `/proc/<pid>/status`, or null when the process is gone. */
  readStatus(pid: number): Promise<string | null>;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    // ENOENT/ESRCH: the process exited between listing and reading.
    return null;
  }
}

const defaultProcReader: ProcReader = {
  async listPids() {
    const entries = await readdir('/proc');
    return entries.filter((name) => /^\d+$/.test(name)).map(Number);
  },
  readStat: (pid) => readOrNull(`/proc/${pid}/stat`),
  readStatus: (pid) => readOrNull(`/proc/${pid}/status`),
};

/**
 * Parent pid from a `/proc/<pid>/stat` line. The `comm` field is wrapped in
 * parentheses and may itself contain `)` or spaces, so parse after the last
 * `)`: the fields there are `state ppid …`.
 */
function parsePpid(stat: string): number | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}

/** `VmRSS:` in bytes; 0 when the line is absent (zombies, kernel threads). */
function parseVmRssBytes(status: string): number {
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
  return match ? Number(match[1]) * 1024 : 0;
}

/**
 * Sum of `VmRSS` over `rootPid` and all its descendants, in bytes. Returns
 * null off Linux or when the root's status cannot be read. Members that
 * exit during the walk are skipped.
 */
export async function readProcessTreeRssBytes(
  rootPid: number,
  reader: ProcReader = defaultProcReader,
  platform: NodeJS.Platform = process.platform,
): Promise<number | null> {
  if (platform !== 'linux') return null;
  const rootStatus = await reader.readStatus(rootPid);
  if (rootStatus === null) return null;

  const pids = await reader.listPids();
  const stats = await Promise.all(pids.map((pid) => reader.readStat(pid)));
  const children = new Map<number, number[]>();
  pids.forEach((pid, index) => {
    const stat = stats[index];
    if (stat == null || pid === rootPid) return;
    const ppid = parsePpid(stat);
    if (ppid === null) return;
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  });

  const descendants: number[] = [];
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }

  const statuses = await Promise.all(descendants.map((pid) => reader.readStatus(pid)));
  let total = parseVmRssBytes(rootStatus);
  for (const status of statuses) {
    if (status !== null) total += parseVmRssBytes(status);
  }
  return total;
}

export interface PeakRssSampler {
  /** Stop sampling and return the largest tree RSS seen, or null when no read succeeded. */
  stop(): Promise<number | null>;
}

/**
 * Sample a process tree's RSS once now and every `intervalMs` (default
 * 2000) until `stop()`. The interval is unref'd so it never holds the
 * process open. A tick that lands while a read is still running is skipped.
 */
export function startPeakRssSampler(
  rootPid: number,
  opts: { intervalMs?: number; read?: (pid: number) => Promise<number | null> } = {},
): PeakRssSampler {
  const read = opts.read ?? ((pid: number) => readProcessTreeRssBytes(pid));
  let peak: number | null = null;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const sample = (): void => {
    if (stopped || inFlight) return;
    inFlight = read(rootPid)
      .then((bytes) => {
        if (bytes !== null && (peak === null || bytes > peak)) peak = bytes;
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
  };

  sample();
  const timer = setInterval(sample, opts.intervalMs ?? 2000);
  timer.unref?.();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (inFlight) await inFlight;
      return peak;
    },
  };
}
