import { isNoResumeValueEnabled } from '../boot-no-resume.js';
import { isPeerDashboardProcess } from '../boot-gates.js';
import { isShutdownDrainingSync } from '../shutdown/drain-record.js';
import { spawnSequencerAgent } from './sequencer-agent.js';

/**
 * PAN-2396: --no-resume is the operator's full-quiescence escape hatch —
 * "human-driven only". When the boot carries OVERDECK_NO_RESUME, no
 * autonomous sequencer pass may spawn; only explicit operator actions
 * (the dashboard's start-sequencer button, `pan` commands) remain allowed.
 * Checked at FIRE time so an already-scheduled timer respects the gate too.
 */
function autonomousSpawnSuppressed(mode: 'incremental' | 'review'): boolean {
  // fix10: a peer dashboard is a read/UI peer, never an orchestrator. It ran
  // this trigger anyway and spawned a real Opus sequencer-runner into the live
  // Herdr session. Checked at FIRE time so a timer scheduled before the check
  // still respects it.
  if (isPeerDashboardProcess()) {
    console.warn(`[backlog-auto-trigger] suppressed ${mode} sequencer pass: peer dashboard spawns nothing`);
    return true;
  }
  if (isShutdownDrainingSync()) {
    console.warn(`[backlog-auto-trigger] suppressed ${mode} sequencer pass: shutdown in progress`);
    return true;
  }
  if (!isNoResumeValueEnabled(process.env.OVERDECK_NO_RESUME)) return false;
  console.warn(`[backlog-auto-trigger] suppressed ${mode} sequencer pass: boot is --no-resume (human-driven only)`);
  return true;
}

let _incrementalTimer: ReturnType<typeof setTimeout> | null = null;
let _lastAutoPassAt: number | null = null;
let _spawnInFlight = false;

const DEBOUNCE_MS = 30_000;
/** PAN-5357: at most one automatic pass per 30 minutes. Operator passes are immediate. */
export const MIN_AUTO_PASS_INTERVAL_MS = 30 * 60_000;

function windowEndMs(): number {
  return _lastAutoPassAt === null ? 0 : _lastAutoPassAt + MIN_AUTO_PASS_INTERVAL_MS;
}

function schedule(projectRoot: string, delayMs: number): void {
  if (_incrementalTimer !== null) clearTimeout(_incrementalTimer);
  _incrementalTimer = setTimeout(() => fire(projectRoot), delayMs);
}

function fire(projectRoot: string): void {
  _incrementalTimer = null;
  const wait = windowEndMs() - Date.now();
  if (wait > 0) return schedule(projectRoot, wait);
  if (_spawnInFlight) return schedule(projectRoot, DEBOUNCE_MS);
  if (autonomousSpawnSuppressed('incremental')) return;
  _spawnInFlight = true;
  spawnSequencerAgent('incremental', { projectRoot, skipWhenUnchanged: true })
    .then((agent) => {
      // FR-8: only a pass that actually spawned starts the window.
      if (agent) _lastAutoPassAt = Date.now();
    })
    .catch((err: unknown) => console.warn('[backlog-auto-trigger] incremental pass failed:', err))
    .finally(() => { _spawnInFlight = false; });
}

/**
 * PAN-1866: call on every backlog delta; PAN-5357: deltas inside the
 * 30-minute window after a spawned automatic pass collapse into one pass at
 * the window's end. Outside the window, deltas within DEBOUNCE_MS collapse
 * into a single incremental sequencer pass as before.
 */
export function triggerDebouncedIncrementalPass(projectRoot: string): void {
  schedule(projectRoot, Math.max(DEBOUNCE_MS, windowEndMs() - Date.now()));
}

export function resetBacklogAutoTriggerForTests(): void {
  if (_incrementalTimer !== null) clearTimeout(_incrementalTimer);
  _incrementalTimer = null;
  _lastAutoPassAt = null;
  _spawnInFlight = false;
}
