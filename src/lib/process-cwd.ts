/**
 * Enumerate host PIDs whose current working directory is inside a given
 * directory tree, via /proc/<pid>/cwd.
 *
 * This is the safe selector for "orphaned workspace processes" (leftover vite
 * watchers, npm/vitest runners spawned in a workspace). It deliberately does
 * NOT use `lsof +D <dir>`: Bun installs node_modules as hardlinks from a
 * global cache, so long-lived platform processes (the dashboard server, every
 * conversation's PTY supervisor) mmap native addons (e.g. pty.node) whose
 * inode also lives inside every workspace's node_modules. `lsof +D` reports
 * them as holding files "in" the workspace, and killing that list takes down
 * the dashboard and all live conversations (2026-07-16 incident: `pan close
 * PAN-2532` killed the dashboard and an active operator conversation).
 */
import { readdir, readlink } from 'fs/promises';

export async function pidsWithCwdUnder(dir: string): Promise<string[]> {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const pids: string[] = [];
  let entries: string[];
  try {
    entries = await readdir('/proc');
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cwd = await readlink(`/proc/${entry}/cwd`);
      if (cwd === dir || cwd.startsWith(prefix)) pids.push(entry);
    } catch {
      // Process exited, or belongs to another user — not killable by us anyway.
    }
  }
  return pids;
}
