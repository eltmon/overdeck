/**
 * PAN-3550: Activity-feed signals for memory pressure. Runs every 15 seconds
 * in the deacon child, independent of the 60s patrol, to warn before the kernel acts.
 *
 * Three levels: ok → watch (warn), holding (soft band, warn), shedding (hard band, error).
 * Transition-only emit: one row per level change, never repeats while the level persists.
 * No frontend changes needed — activity.entry already renders in ActivityPanel.
 */

import { MemoryPressureBand, MemoryVerdict, assessMemoryPressure, readGovernorPsiCalmConfig, readGovernorReserves, readGovernorWatchReserveBytes } from './memory-governor.js';
import { RuntimeCensus, getRuntimeCensus } from '../runtime-census.js';
import { emitActivityEntrySync, EmitActivityOptions } from '../activity-logger.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { resolve } from 'path';

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

function formatPsi(value: number | null | undefined): string {
  return value == null ? 'unavailable (pressure stall data not readable)' : value.toFixed(2);
}

function formatTrigger(verdict: MemoryVerdict): string {
  const trigger = verdict.trigger;
  if (!trigger) {
    return verdict.band === 'hard'
      ? 'Memory critical: the governor entered shedding before trigger details were available.'
      : 'Overdeck stopped admitting work before trigger details were available.';
  }

  const since = new Date(trigger.at).toISOString().slice(11, 16);
  if (trigger.kind === 'soft-dip') {
    return `Overdeck stopped admitting work at ${since} UTC when available memory dipped to ${formatGib(trigger.readingBytes)}, under the ${formatGib(trigger.thresholdBytes)} soft reserve.`;
  }
  if (trigger.kind === 'hard') {
    return `Overdeck entered critical memory shedding at ${since} UTC when available memory fell to ${formatGib(trigger.readingBytes)}, under the ${formatGib(trigger.thresholdBytes)} hard reserve.`;
  }
  if (trigger.kind === 'swap-psi') {
    return `Overdeck entered critical memory shedding at ${since} UTC when swap free fell to ${formatGib(trigger.readingBytes)}, under the ${formatGib(trigger.thresholdBytes)} swap runway threshold, while memory pressure stalls were active.`;
  }
  return `Overdeck stopped admitting work at ${since} UTC when swap free fell to ${formatGib(trigger.readingBytes)}, under the ${formatGib(trigger.thresholdBytes)} swap runway threshold, and memory pressure stall data was unavailable.`;
}

function formatCalmWindow(windowMs: number): string {
  const minutes = windowMs / 60_000;
  return Number.isInteger(minutes) ? `${minutes} minutes` : `${windowMs} ms`;
}

function formatSheddingExit(verdict: MemoryVerdict, hardBytes: number, recoveryBytes: number): string {
  if (verdict.trigger?.kind === 'swap-psi') {
    return `Shedding ends when live memory stalls clear or swap runway recovers. Admissions resume at the ${formatGib(recoveryBytes)} recovery reserve or through the PSI-calm condition.`;
  }
  return `Shedding ends when available memory reaches the ${formatGib(hardBytes)} hard reserve. Admissions resume at the ${formatGib(recoveryBytes)} recovery reserve or through the PSI-calm condition.`;
}

/**
 * Format a multi-line memory details string for activity entry.
 */
function buildMemoryDetails(
  verdict: MemoryVerdict,
  watchBytes: number,
  softBytes: number,
  hardBytes: number,
  recoveryBytes: number,
): string {
  const swap = verdict.swapFreeBytes == null || verdict.swapTotalBytes == null
    ? 'Swap: unavailable'
    : `Swap: ${formatGib(verdict.swapFreeBytes)} free of ${formatGib(verdict.swapTotalBytes)}`;
  return [
    `MemAvailable: ${formatGib(verdict.availableBytes)}`,
    `Watch reserve: ${formatGib(watchBytes)} | Soft: ${formatGib(softBytes)} | Hard: ${formatGib(hardBytes)} | Recovery: ${formatGib(recoveryBytes)}`,
    swap,
    `PSI some avg10: ${formatPsi(verdict.psiSomeAvg10)} | full avg10: ${formatPsi(verdict.psiFullAvg10)}`,
  ].join('\n');
}

export interface MemoryPressurePatrolDeps {
  assess: () => Promise<MemoryVerdict>;
  readWatchReserveBytes: () => number;
  readSoftReserveBytes: () => number;
  readHardReserveBytes: () => number;
  readRecoveryReserveBytes: () => number;
  readPsiCalmConfig: () => { readmitAvg10: number; windowMs: number };
  census: () => Promise<RuntimeCensus>;
  readNewKernelJournal: () => Promise<string>;
  emit: (entry: EmitActivityOptions) => void;
}

// Module-level state for transition-only emission
let lastLevel: MemoryFeedLevel | null = null;

// Module-level state for OOM canary: disabled if journal reading fails
let oomCanaryDisabled = false;

/**
 * WI-4: Read new kernel journal entries via journalctl with cursor-file persistence.
 * On first call (cursor file absent), uses -n 0 to initialize and returns empty string.
 * On ANY error, disables the canary permanently and returns empty string.
 */
async function readNewKernelJournal(): Promise<string> {
  if (oomCanaryDisabled) return '';

  try {
    const overdeckHome = process.env.OVERDECK_HOME || resolve(homedir(), '.overdeck');
    const cursorFile = resolve(overdeckHome, 'oom-canary.cursor');

    // Check if cursor file exists to determine if we should use -n 0
    const fs = await import('fs/promises');
    let cursorExists = false;
    try {
      await fs.stat(cursorFile);
      cursorExists = true;
    } catch {
      // Cursor doesn't exist yet
    }

    const execFileAsync = promisify(execFile);
    const args = ['-k', '--cursor-file', cursorFile, '--no-pager', '-o', 'cat'];

    // On first run (no cursor), use -n 0 to initialize without replaying
    if (!cursorExists) {
      args.push('-n', '0');
    }

    const result = await execFileAsync('journalctl', args, { timeout: 10000 });
    return result.stdout;
  } catch (err) {
    console.warn('[memory-pressure-patrol] Journal reader failed, disabling OOM canary:', err);
    oomCanaryDisabled = true;
    return '';
  }
}

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
    readPsiCalmConfig: deps.readPsiCalmConfig || (() => readGovernorPsiCalmConfig()),
    census: deps.census || (() => getRuntimeCensus()),
    readNewKernelJournal: deps.readNewKernelJournal || readNewKernelJournal,
    emit: deps.emit || emitActivityEntrySync,
  };

  const verdict = await d.assess();
  const watchBytes = d.readWatchReserveBytes();
  const softBytes = d.readSoftReserveBytes();
  const hardBytes = d.readHardReserveBytes();
  const recoveryBytes = d.readRecoveryReserveBytes();
  const psiCalmConfig = d.readPsiCalmConfig();
  const actions: string[] = [];

  // WI-4: Check for new OOM kills in the journal (runs even if level unchanged)
  const journalText = await d.readNewKernelJournal();
  const oomKills = parseOomKills(journalText);

  // Emit OOM kills with backpressure: aggregate burst into one event per level
  // to avoid unbounded durable writes when the machine is memory-constrained
  if (oomKills.length > 0) {
    const overdeckKills = oomKills.filter((k) => k.inOverdeckTree);
    const hostKills = oomKills.filter((k) => !k.inOverdeckTree);

    // Emit Overdeck-tree kills as error
    if (overdeckKills.length > 0) {
      const plural = overdeckKills.length === 1 ? '' : 's';
      const message =
        overdeckKills.length === 1
          ? `Kernel OOM: Killed process ${overdeckKills[0].pid} (${overdeckKills[0].comm}), ${formatGib(overdeckKills[0].rssBytes)} RSS in Overdeck tmux-server`
          : `Kernel OOM: Killed ${overdeckKills.length} process${plural} in Overdeck tmux-server (${overdeckKills.map((k) => `${k.pid}/${k.comm}`).join(', ')})`;

      const details = overdeckKills
        .map((k) => `  PID ${k.pid} (${k.comm}): ${formatGib(k.rssBytes)} RSS | Cgroup: ${k.cgroup || '(unknown)'}`)
        .join('\n');

      d.emit({
        level: 'error',
        source: 'cloister',
        link: '/resources',
        message,
        details: `OOM kills in Overdeck tree:\n${details}\n\n${buildMemoryDetails(verdict, watchBytes, softBytes, hardBytes, recoveryBytes)}`,
        desktop: true,
      });

      const action = `memory-pressure-patrol: oom-kills (${overdeckKills.length} in Overdeck tree)`;
      actions.push(action);
      logDeaconEventSync(`[deacon] ${action}`);
    }

    // Emit host kills as warn (less urgent)
    if (hostKills.length > 0) {
      const plural = hostKills.length === 1 ? '' : 's';
      const message =
        hostKills.length === 1
          ? `Kernel OOM: Killed process ${hostKills[0].pid} (${hostKills[0].comm}), ${formatGib(hostKills[0].rssBytes)} RSS outside Overdeck`
          : `Kernel OOM: Killed ${hostKills.length} process${plural} outside Overdeck (${hostKills.map((k) => `${k.pid}/${k.comm}`).join(', ')})`;

      const details = hostKills
        .map((k) => `  PID ${k.pid} (${k.comm}): ${formatGib(k.rssBytes)} RSS | Cgroup: ${k.cgroup || '(unknown)'}`)
        .join('\n');

      d.emit({
        level: 'warn',
        source: 'cloister',
        link: '/resources',
        message,
        details: `OOM kills outside Overdeck:\n${details}\n\n${buildMemoryDetails(verdict, watchBytes, softBytes, hardBytes, recoveryBytes)}`,
        desktop: false,
      });

      const action = `memory-pressure-patrol: oom-kills (${hostKills.length} outside Overdeck)`;
      actions.push(action);
      logDeaconEventSync(`[deacon] ${action}`);
    }
  }

  const level = memoryFeedLevel(verdict.band, verdict.availableBytes, watchBytes);

  // Transition-only: if level hasn't changed, emit nothing for level transition
  if (level === lastLevel) {
    return oomKills.length > 0 ? actions : [];
  }

  lastLevel = level;

  // Fetch the runtime census for top-consumer attribution
  const census = await d.census();

  // Build details with the base reserves and top consumers
  let details = buildMemoryDetails(
    verdict,
    watchBytes,
    softBytes,
    hardBytes,
    recoveryBytes,
  );

  // WI-3: Append top memory consumers to details
  if (!census.processAvailable) {
    details += '\n\nTop memory consumers: unavailable (process census could not be read)';
  } else {
    const topConsumers = topMemoryConsumers(census, 5);
    if (topConsumers.length > 0) {
      const consumerLines = topConsumers.map(
        (c) =>
          `  ${formatGib(c.rssBytes)} | pid ${c.pid} (${c.comm}) in session ${c.sessionName || '(host)'}`,
      );
      details += '\n\nTop memory consumers:\n' + consumerLines.join('\n');
    }
  }

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
      `${formatTrigger(verdict)} ${formatGib(verdict.availableBytes)} is available now. ` +
      `Admissions resume at the ${formatGib(recoveryBytes)} recovery reserve, or at the ${formatGib(softBytes)} soft reserve once memory pressure stalls (PSI full avg10) stay below ${psiCalmConfig.readmitAvg10} for ${formatCalmWindow(psiCalmConfig.windowMs)}. ` +
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
      `${formatTrigger(verdict)} ${formatGib(verdict.availableBytes)} is available now. ` +
      `Overdeck admits nothing while shedding is active. ${formatSheddingExit(verdict, hardBytes, recoveryBytes)} ` +
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
      `Memory pressure cleared — ${formatGib(verdict.availableBytes)} available, at or above the ${formatGib(watchBytes)} watch reserve. ` +
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
  oomCanaryDisabled = false;
}

/**
 * WI-3: Top consumer attribution
 */
export interface TopConsumer {
  pid: number;
  rssBytes: number;
  comm: string;
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
      comm: proc.comm,
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
