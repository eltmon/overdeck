/**
 * inotify watch/instance accounting for the local user.
 *
 * inotify watches are a per-UID kernel budget (fs.inotify.max_user_watches)
 * shared by every process the user runs — host processes and Docker
 * containers alike, since containers share the kernel and (in Overdeck's
 * setups) the same uid. When the budget is exhausted, any program that
 * tries to add a watch fails with ENOSPC; the classic symptom is a Vite
 * dev server dying at startup while everything else looks healthy
 * (PAN-3063, the 2026-07-25 MIN-898 incident).
 *
 * The kernel exposes no aggregate usage counter, so the only way to measure
 * usage is to walk /proc/<pid>/fd for anon_inode:inotify descriptors and sum
 * the `inotify wd:` lines in the matching fdinfo files. Unprivileged scans
 * can only read same-uid processes, which conveniently matches the per-UID
 * scope of the budget itself.
 */
import { readdir, readFile, readlink } from 'node:fs/promises';

export interface InotifyConsumer {
  pid: number;
  watches: number;
  command: string;
}

export interface InotifySample {
  watchesUsed: number;
  watchesMax: number | null;
  instancesUsed: number;
  instancesMax: number | null;
  topConsumers: InotifyConsumer[];
}

export interface InotifyScanAdapters {
  readdir(path: string): Promise<string[]>;
  readlink(path: string): Promise<string>;
  readFile(path: string): Promise<string>;
}

export const INOTIFY_TOP_CONSUMER_COUNT = 5;

/** Pids scanned concurrently; keeps the /proc walk from monopolizing the fd table. */
const PID_SCAN_CONCURRENCY = 32;

const defaultAdapters: InotifyScanAdapters = {
  readdir: (path) => readdir(path),
  readlink: (path) => readlink(path),
  readFile: (path) => readFile(path, 'utf-8'),
};

/** Counts `inotify wd:` entries in a /proc/<pid>/fdinfo/<fd> payload. */
export function countInotifyWatches(fdinfoContent: string): number {
  let count = 0;
  for (const line of fdinfoContent.split('\n')) {
    if (line.startsWith('inotify wd:')) count += 1;
  }
  return count;
}

export function parseProcLimit(content: string): number | null {
  const value = Number(content.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function readLimit(adapters: InotifyScanAdapters, path: string): Promise<number | null> {
  try {
    return parseProcLimit(await adapters.readFile(path));
  } catch {
    return null;
  }
}

interface PidScan {
  pid: number;
  watches: number;
  instances: number;
}

async function scanPid(adapters: InotifyScanAdapters, pid: number): Promise<PidScan | null> {
  let fds: string[];
  try {
    fds = await adapters.readdir(`/proc/${pid}/fd`);
  } catch {
    return null; // other-uid process, or it exited mid-scan
  }

  let watches = 0;
  let instances = 0;
  for (const fd of fds) {
    let target: string;
    try {
      target = await adapters.readlink(`/proc/${pid}/fd/${fd}`);
    } catch {
      continue;
    }
    if (!target.includes('inotify')) continue;
    instances += 1;
    try {
      watches += countInotifyWatches(await adapters.readFile(`/proc/${pid}/fdinfo/${fd}`));
    } catch {
      // fd closed between readdir and readFile
    }
  }
  if (instances === 0) return null;
  return { pid, watches, instances };
}

async function readCommand(adapters: InotifyScanAdapters, pid: number): Promise<string> {
  try {
    const cmdline = await adapters.readFile(`/proc/${pid}/cmdline`);
    const command = cmdline.replaceAll('\0', ' ').trim();
    return command.length > 120 ? `${command.slice(0, 117)}…` : command;
  } catch {
    return `pid ${pid}`;
  }
}

/**
 * Walks /proc and totals inotify watches and instances held by processes
 * this user can read. Returns null when /proc is unavailable (non-Linux).
 */
export async function sampleInotify(
  adapters: InotifyScanAdapters = defaultAdapters,
): Promise<InotifySample | null> {
  let procEntries: string[];
  try {
    procEntries = await adapters.readdir('/proc');
  } catch {
    return null;
  }
  const pids = procEntries.filter((entry) => /^\d+$/.test(entry)).map(Number);

  const scans: PidScan[] = [];
  for (let i = 0; i < pids.length; i += PID_SCAN_CONCURRENCY) {
    const chunk = pids.slice(i, i + PID_SCAN_CONCURRENCY);
    const results = await Promise.all(chunk.map((pid) => scanPid(adapters, pid)));
    for (const result of results) {
      if (result) scans.push(result);
    }
  }

  const [watchesMax, instancesMax] = await Promise.all([
    readLimit(adapters, '/proc/sys/fs/inotify/max_user_watches'),
    readLimit(adapters, '/proc/sys/fs/inotify/max_user_instances'),
  ]);

  const top = [...scans]
    .sort((a, b) => b.watches - a.watches)
    .slice(0, INOTIFY_TOP_CONSUMER_COUNT);
  const topConsumers = await Promise.all(top.map(async (scan) => ({
    pid: scan.pid,
    watches: scan.watches,
    command: await readCommand(adapters, scan.pid),
  })));

  return {
    watchesUsed: scans.reduce((sum, scan) => sum + scan.watches, 0),
    watchesMax,
    instancesUsed: scans.reduce((sum, scan) => sum + scan.instances, 0),
    instancesMax,
    topConsumers,
  };
}
