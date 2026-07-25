/**
 * inotify watch budget doctor checks (PAN-3063).
 *
 * fs.inotify.max_user_watches is a per-user kernel budget shared by every
 * process and container this user runs. When it is exhausted, new
 * file-watching processes (Vite dev servers, test watchers) fail with
 * ENOSPC while the rest of the host looks healthy. Doctor reports usage,
 * the top consumers, and whether the limit survives a reboot. Raising the
 * limit needs sudo, so the fix is always printed for the operator — never
 * executed.
 */
import { promises as fsp } from 'fs';
import { join } from 'path';

import { sampleInotify, type InotifySample } from '../../lib/system-health/inotify.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-state-worktree.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

const INOTIFY_WARNING_PERCENT = 80;
const INOTIFY_CRITICAL_PERCENT = 90;
const INOTIFY_PERSIST_FIX =
  "echo 'fs.inotify.max_user_watches = 2097152' | sudo tee /etc/sysctl.d/99-inotify.conf && sudo sysctl --system";

/**
 * Resolves the persisted fs.inotify.max_user_watches the way systemd-sysctl
 * does: /usr/lib/sysctl.d < /run/sysctl.d < /etc/sysctl.d (same basename in a
 * higher-precedence dir masks the lower), files applied in sorted order with
 * the last match winning, and /etc/sysctl.conf applied last of all.
 */
export async function readPersistedInotifyWatchLimit(): Promise<number | null> {
  const dirsByPrecedence = ['/usr/lib/sysctl.d', '/run/sysctl.d', '/etc/sysctl.d'];
  const fileByBasename = new Map<string, string>();
  for (const dir of dirsByPrecedence) {
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith('.conf')) fileByBasename.set(entry, join(dir, entry));
    }
  }
  const files = [...fileByBasename.keys()].sort().map((name) => fileByBasename.get(name)!);
  files.push('/etc/sysctl.conf');

  let persisted: number | null = null;
  for (const file of files) {
    let content: string;
    try {
      content = await fsp.readFile(file, 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*fs\.inotify\.max_user_watches\s*=\s*(\d+)\s*$/);
      if (match) persisted = Number(match[1]);
    }
  }
  return persisted;
}

export interface InotifyDoctorDeps {
  platform: NodeJS.Platform;
  sample: () => Promise<InotifySample | null>;
  readPersistedLimit: () => Promise<number | null>;
}

export async function checkInotify(deps?: Partial<InotifyDoctorDeps>): Promise<CheckResult[]> {
  const platform = deps?.platform ?? process.platform;
  if (platform !== 'linux') return [];

  const sample = await (deps?.sample ?? sampleInotify)().catch(() => null);
  if (!sample) {
    return [{
      name: 'inotify watch budget',
      status: 'warn',
      message: 'Could not scan /proc for inotify usage',
    }];
  }

  const results: CheckResult[] = [];
  if (sample.watchesMax == null) {
    results.push({
      name: 'inotify watch budget',
      status: 'warn',
      message: `${sample.watchesUsed.toLocaleString()} watches in use; fs.inotify.max_user_watches is unreadable`,
    });
  } else {
    const percent = Math.round((sample.watchesUsed / sample.watchesMax) * 100);
    const usage = `${sample.watchesUsed.toLocaleString()} of ${sample.watchesMax.toLocaleString()} watches in use (${percent}%)`;
    if (percent >= INOTIFY_WARNING_PERCENT) {
      const top = sample.topConsumers
        .slice(0, 3)
        .map((consumer) => `${consumer.watches.toLocaleString()} watches: pid ${consumer.pid} (${consumer.command})`)
        .join('; ');
      results.push({
        name: 'inotify watch budget',
        status: percent >= INOTIFY_CRITICAL_PERCENT ? 'error' : 'warn',
        message: `${usage} — new file-watching processes ${percent >= INOTIFY_CRITICAL_PERCENT ? 'will' : 'may'} fail with ENOSPC. Top consumers: ${top}`,
        fix: `Raise and persist the per-user limit: ${INOTIFY_PERSIST_FIX}`,
      });
    } else {
      results.push({
        name: 'inotify watch budget',
        status: 'ok',
        message: `${usage}; ${sample.instancesUsed.toLocaleString()} of ${sample.instancesMax?.toLocaleString() ?? '?'} instances`,
      });
    }
  }

  const persisted = await (deps?.readPersistedLimit ?? readPersistedInotifyWatchLimit)().catch(() => null);
  if (sample.watchesMax != null) {
    if (persisted == null) {
      results.push({
        name: 'inotify limit persistence',
        status: 'warn',
        message: `fs.inotify.max_user_watches=${sample.watchesMax.toLocaleString()} is not persisted in sysctl config — a reboot resets it to the distro default`,
        fix: INOTIFY_PERSIST_FIX,
      });
    } else if (persisted < sample.watchesMax) {
      results.push({
        name: 'inotify limit persistence',
        status: 'warn',
        message: `Live limit is ${sample.watchesMax.toLocaleString()} but sysctl config persists ${persisted.toLocaleString()} — a reboot lowers it`,
        fix: INOTIFY_PERSIST_FIX,
      });
    } else {
      results.push({
        name: 'inotify limit persistence',
        status: 'ok',
        message: `fs.inotify.max_user_watches=${persisted.toLocaleString()} persisted in sysctl config`,
      });
    }
  }

  return results;
}
