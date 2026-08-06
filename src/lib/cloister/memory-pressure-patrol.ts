/**
 * PAN-3550: Activity-feed signals for memory pressure. Runs every 15 seconds
 * in the deacon child, independent of the 60s patrol, to warn before the kernel acts.
 *
 * Three levels: ok → watch (warn), holding (soft band, warn), shedding (hard band, error).
 * Transition-only emit: one row per level change, never repeats while the level persists.
 * No frontend changes needed — activity.entry already renders in ActivityPanel.
 */

import { MemoryPressureBand, MemoryVerdict, assessMemoryPressure, readGovernorReserves, readGovernorWatchReserveBytes } from './memory-governor.js';
import { RuntimeCensus, getRuntimeCensus } from '../runtime-census.js';
import { emitActivityEntrySync, EmitActivityOptions } from '../activity-logger.js';
import { logDeaconEventSync } from '../persistent-logger.js';

export type MemoryFeedLevel = 'ok' | 'watch' | 'holding' | 'shedding';

/**
 * Pure: fold the governor's band and the WATCH reserve into one feed level.
 * The band already encodes SOFT/HARD hysteresis; WATCH only applies while the
 * governor is still admitting.
 */
export function memoryFeedLevel(
  band: MemoryPressureBand,
  availableBytes: number,
  watchBytes: number,
): MemoryFeedLevel {
  if (band === 'hard') return 'shedding';
  if (band === 'soft') return 'holding';
  return availableBytes < watchBytes ? 'watch' : 'ok';
}

/**
 * Format bytes as human-readable GiB string, e.g., "7.2 GiB"
 */
function formatGib(bytes: number): string {
  const gib = bytes / (1024 ** 3);
  return `${gib.toFixed(1)} GiB`;
}

/**
 * Format a multi-line memory details string for activity entry.
 */
function buildMemoryDetails(
  availableBytes: number,
  watchBytes: number,
  softBytes: number,
  hardBytes: number,
  recoveryBytes: number,
): string {
  // For now, just the basic reserve info. We'll add swap and PSI data later in WI-3 and WI-4.
  return [
    `MemAvailable: ${formatGib(availableBytes)}`,
    `Watch reserve: ${formatGib(watchBytes)} | Soft: ${formatGib(softBytes)} | Hard: ${formatGib(hardBytes)} | Recovery: ${formatGib(recoveryBytes)}`,
    `Swap free: unavailable | PSI full avg10: unavailable`,
  ].join('\n');
}

export interface MemoryPressurePatrolDeps {
  assess: () => Promise<MemoryVerdict>;
  readWatchReserveBytes: () => number;
  readSoftReserveBytes: () => number;
  readHardReserveBytes: () => number;
  readRecoveryReserveBytes: () => number;
  census: () => Promise<RuntimeCensus>;
  emit: (entry: EmitActivityOptions) => void;
}

// Module-level state for transition-only emission
let lastLevel: MemoryFeedLevel | null = null;

/**
 * Patrol memory pressure once and emit a transition-only activity entry if the level changed.
 * Returns a human-readable list of actions taken (for deacon log).
 */
export async function patrolMemoryPressure(deps: Partial<MemoryPressurePatrolDeps> = {}): Promise<string[]> {
  // Fill in defaults
  const d: MemoryPressurePatrolDeps = {
    assess: deps.assess || (() => assessMemoryPressure()),
    readWatchReserveBytes: deps.readWatchReserveBytes || (() => readGovernorWatchReserveBytes()),
    readSoftReserveBytes: deps.readSoftReserveBytes || (() => readGovernorReserves().softBytes),
    readHardReserveBytes: deps.readHardReserveBytes || (() => readGovernorReserves().hardBytes),
    readRecoveryReserveBytes: deps.readRecoveryReserveBytes || (() => readGovernorReserves().recoveryBytes),
    census: deps.census || (() => getRuntimeCensus()),
    emit: deps.emit || emitActivityEntrySync,
  };

  const verdict = await d.assess();
  const watchBytes = d.readWatchReserveBytes();
  const softBytes = d.readSoftReserveBytes();
  const hardBytes = d.readHardReserveBytes();
  const recoveryBytes = d.readRecoveryReserveBytes();

  const level = memoryFeedLevel(verdict.band, verdict.availableBytes, watchBytes);

  // Transition-only: if level hasn't changed, emit nothing
  if (level === lastLevel) {
    return [];
  }

  lastLevel = level;
  const actions: string[] = [];

  const details = buildMemoryDetails(
    verdict.availableBytes,
    watchBytes,
    softBytes,
    hardBytes,
    recoveryBytes,
  );

  // Build the activity entry based on level
  if (level === 'watch') {
    const message =
      `Memory is getting tight — ${formatGib(verdict.availableBytes)} available, below the ${formatGib(watchBytes)} watch reserve. ` +
      `Overdeck is still admitting new agents; it will stop admitting if available memory falls below the ${formatGib(softBytes)} soft reserve.`;

    d.emit({
      level: 'warn',
      source: 'cloister',
      link: '/resources',
      message,
      details,
      desktop: false,
    });

    const action = `memory-pressure-patrol: watch-level (${formatGib(verdict.availableBytes)} available)`;
    actions.push(action);
    logDeaconEventSync(`[deacon] ${action}`);
  } else if (level === 'holding') {
    const message =
      `Memory pressure: Overdeck has stopped admitting work — ${formatGib(verdict.availableBytes)} available is under the ${formatGib(softBytes)} soft reserve. ` +
      `Queued agent resumes and review/test dispatches will wait until available memory climbs back above the ${formatGib(recoveryBytes)} recovery reserve. ` +
      `Nothing has been stopped or killed.`;

    d.emit({
      level: 'warn',
      source: 'cloister',
      link: '/resources',
      message,
      details,
      desktop: false,
    });

    const action = `memory-pressure-patrol: admission-hold (${formatGib(verdict.availableBytes)} available)`;
    actions.push(action);
    logDeaconEventSync(`[deacon] ${action}`);
  } else if (level === 'shedding') {
    const message =
      `Memory critical — ${formatGib(verdict.availableBytes)} available is under the ${formatGib(hardBytes)} hard reserve. ` +
      `Overdeck admits nothing and the kernel may start killing processes. ` +
      `Free memory on this host now; automatic shedding is not wired, so Overdeck will not reclaim anything on its own.`;

    d.emit({
      level: 'error',
      source: 'cloister',
      link: '/resources',
      message,
      details,
      desktop: true,
    });

    const action = `memory-pressure-patrol: shedding-level (${formatGib(verdict.availableBytes)} available)`;
    actions.push(action);
    logDeaconEventSync(`[deacon] ${action}`);
  } else if (level === 'ok') {
    const message =
      `Memory pressure cleared — ${formatGib(verdict.availableBytes)} available, above the ${formatGib(watchBytes)} watch reserve. ` +
      `Overdeck is admitting work again.`;

    d.emit({
      level: 'info',
      source: 'cloister',
      link: '/resources',
      message,
      details,
      desktop: false,
    });

    const action = `memory-pressure-patrol: recovered (${formatGib(verdict.availableBytes)} available)`;
    actions.push(action);
    logDeaconEventSync(`[deacon] ${action}`);
  }

  return actions;
}

/**
 * Test-only: reset the module-level state between test cases.
 */
export function __resetMemoryPressurePatrolState(): void {
  lastLevel = null;
}

/**
 * WI-3: Top consumer attribution
 */
export interface TopConsumer {
  pid: number;
  rssBytes: number;
  command: string;
  sessionName: string | null;
}

/**
 * Pure: the N largest-RSS processes in the census, each attributed to a tmux session.
 */
export function topMemoryConsumers(census: RuntimeCensus, limit: number): TopConsumer[] {
  if (!census.processAvailable) return [];
  
  const sessionByPanePid = new Map<number, string>();
  for (const [sessionName, panes] of census.panesBySession) {
    for (const pane of panes) {
      sessionByPanePid.set(pane.panePid, sessionName);
    }
  }

  const topProcs = [...census.processesByPid.values()]
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, limit);

  return topProcs.map((proc) => {
    const visited = new Set<number>();
    let current = proc.pid;
    let sessionName: string | null = null;

    while (current > 1 && !visited.has(current)) {
      visited.add(current);
      if (sessionByPanePid.has(current)) {
        sessionName = sessionByPanePid.get(current)!;
        break;
      }
      const parent = census.processesByPid.get(current);
      if (!parent?.ppid) break;
      current = parent.ppid;
    }

    return {
      pid: proc.pid,
      rssBytes: proc.rssBytes,
      command: proc.command.slice(0, 80),
      sessionName,
    };
  });
}

/**
 * WI-4: OOM kill detection
 */
export interface OomKillRecord {
  pid: number;
  comm: string;
  rssBytes: number;
  cgroup: string | null;
  inOverdeckTree: boolean;
}

const OOM_OVERDECK_TREE_REGEX = /overdeck-tmux-server\.service|overdeck-/;

export function parseOomKills(journalText: string): OomKillRecord[] {
  const kills = new Map<number, OomKillRecord>();

  const oomkillPattern = /task_memcg=(\S+?),task=([^,]+),pid=(\d+)/g;
  let match;
  while ((match = oomkillPattern.exec(journalText)) !== null) {
    const [_, cgroup, comm, pidStr] = match;
    const pid = parseInt(pidStr, 10);
    kills.set(pid, {
      pid,
      comm,
      rssBytes: 0,
      cgroup,
      inOverdeckTree: OOM_OVERDECK_TREE_REGEX.test(cgroup),
    });
  }

  const victimPattern = /Out of memory: Killed process (\d+) \(([^)]+)\)(.*?)$/gm;
  while ((match = victimPattern.exec(journalText)) !== null) {
    const [_, pidStr, comm, tail] = match;
    const pid = parseInt(pidStr, 10);

    let rssBytes = 0;
    const rssPattern = /(?:anon|file|shmem)-rss:(\d+)kB/g;
    let rssMatch;
    while ((rssMatch = rssPattern.exec(tail)) !== null) {
      rssBytes += parseInt(rssMatch[1], 10) * 1024;
    }

    if (kills.has(pid)) {
      kills.get(pid)!.rssBytes = rssBytes;
    } else {
      kills.set(pid, {
        pid,
        comm,
        rssBytes,
        cgroup: null,
        inOverdeckTree: false,
      });
    }
  }

  return Array.from(kills.values());
}
