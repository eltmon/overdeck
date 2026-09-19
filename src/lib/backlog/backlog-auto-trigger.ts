import { isNoResumeValueEnabled } from '../boot-no-resume.js';
import { isPeerDashboardProcess } from '../boot-gates.js';
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
  if (!isNoResumeValueEnabled(process.env.OVERDECK_NO_RESUME)) return false;
  console.warn(`[backlog-auto-trigger] suppressed ${mode} sequencer pass: boot is --no-resume (human-driven only)`);
  return true;
}

let _incrementalTimer: ReturnType<typeof setTimeout> | null = null;
let _reviewTimer: ReturnType<typeof setInterval> | null = null;

const DEBOUNCE_MS = 30_000;

/**
 * PAN-1866: Call on every backlog delta (issue opened/closed/edited).
 * Debounces: multiple changes within DEBOUNCE_MS collapse into a single
 * incremental sequencer pass.
 */
export function triggerDebouncedIncrementalPass(projectRoot: string): void {
  if (_incrementalTimer !== null) clearTimeout(_incrementalTimer);
  _incrementalTimer = setTimeout(() => {
    _incrementalTimer = null;
    if (autonomousSpawnSuppressed('incremental')) return;
    spawnSequencerAgent('incremental', { projectRoot }).catch((err: unknown) =>
      console.warn('[backlog-auto-trigger] incremental pass failed:', err),
    );
  }, DEBOUNCE_MS);
}

/**
 * PAN-1866: Start a periodic review-pass cadence. Safe to call multiple times
 * (clears the previous interval first). Pass 0 to disable.
 */
export function startPeriodicReviewPass(projectRoot: string, intervalMs: number): void {
  if (_reviewTimer !== null) {
    clearInterval(_reviewTimer);
    _reviewTimer = null;
  }
  if (intervalMs <= 0) return;
  _reviewTimer = setInterval(() => {
    if (autonomousSpawnSuppressed('review')) return;
    spawnSequencerAgent('review', { projectRoot }).catch((err: unknown) =>
      console.warn('[backlog-auto-trigger] periodic review pass failed:', err),
    );
  }, intervalMs);
}

export function stopPeriodicReviewPass(): void {
  if (_reviewTimer !== null) {
    clearInterval(_reviewTimer);
    _reviewTimer = null;
  }
}
