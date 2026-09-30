/**
 * Cleanup for installs that ran TLDR before it was removed (PAN-4429).
 *
 * Older Overdeck versions started an llm-tldr index daemon per checkout. The
 * daemon writes its own pidfile at `<checkout>/.tldr/daemon.pid`. Dashboard
 * boot stops those daemons once; `pan sync` tells the operator about leftover
 * `.venv`/`.tldr/` directories. Nothing here deletes a directory: they may be
 * the user's own.
 *
 * Async only — this runs in the dashboard server.
 */

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { listCandidateCheckouts } from './retired-hooks.js';

const execFileAsync = promisify(execFile);

export interface LegacyTldrCleanupDeps {
  /** Command line of a live pid, or null when it cannot be read. */
  readCmdline?: (pid: number) => Promise<string | null>;
  kill?: (pid: number, signal?: NodeJS.Signals | 0) => void;
}

async function readCmdlineDefault(pid: number): Promise<string | null> {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf-8');
    if (raw) return raw.split('\0').join(' ').trim();
  } catch {
    // no procfs (macOS) — fall back to ps
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readPid(pidFile: string): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(pidFile, 'utf-8')).trim(), 10);
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * For each checkout with .tldr/daemon.pid: parse the pid, skip if not alive
 * (process.kill(pid, 0) throws), read the command line, and send SIGTERM only
 * when it contains "tldr" (a reused pid belongs to some other process).
 * Returns the pids signalled.
 */
export async function stopLegacyTldrDaemons(
  checkouts: string[] = listCandidateCheckouts(),
  deps: LegacyTldrCleanupDeps = {},
): Promise<number[]> {
  const readCmdline = deps.readCmdline ?? readCmdlineDefault;
  const kill = deps.kill ?? ((pid: number, signal?: NodeJS.Signals | 0) => { process.kill(pid, signal); });
  const signalled: number[] = [];

  for (const checkout of checkouts) {
    const pid = await readPid(join(checkout, '.tldr', 'daemon.pid'));
    if (pid === null || signalled.includes(pid)) continue;
    try {
      kill(pid, 0);
    } catch {
      continue;
    }
    const cmdline = await readCmdline(pid);
    if (!cmdline || !cmdline.toLowerCase().includes('tldr')) continue;
    try {
      kill(pid, 'SIGTERM');
      signalled.push(pid);
    } catch {
      // exited between the liveness check and the signal
    }
  }
  return signalled;
}

/** Checkouts that still contain a .tldr/ directory. */
export function findLegacyTldrCheckouts(checkouts: string[] = listCandidateCheckouts()): string[] {
  return checkouts.filter((checkout) => {
    const dir = join(checkout, '.tldr');
    try {
      return existsSync(dir) && statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}
