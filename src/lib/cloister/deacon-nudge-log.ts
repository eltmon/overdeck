import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * A deacon RECOVERY action — a "nudge" the REACTIVE pipeline should not have needed.
 *
 * The deacon is the safety net: in steady state, handoffs (work→review, review→test, test→ship)
 * fire reactively off domain events. So every deacon nudge is a signal that a reactive handoff
 * FAILED, and each one is a breadcrumb for root-cause retrospection. We persist them as JSONL so
 * the flywheel (or a `pan` retrospect command) can mine them: "which handoff keeps needing a nudge,
 * for which issues, under what state?" points straight at the reactive gap to close.
 */
export interface DeaconNudge {
  /** The patrol that nudged, e.g. 'checkPendingTestDispatch'. */
  patrol: string;
  /** The issue that was stuck. */
  issueId: string;
  /** What the deacon did, e.g. 'dispatched test role'. */
  action: string;
  /** WHY a nudge was needed — the reactive handoff that should have fired but didn't. */
  reason: string;
  /** A snapshot of the relevant state so the retrospective doesn't need to reconstruct it. */
  state?: Record<string, unknown>;
}

function nudgeLogPath(): string {
  const home = process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
  return join(home, 'logs', 'deacon-nudges.jsonl');
}

/**
 * Record a deacon nudge to {@link nudgeLogPath} (machine-readable JSONL for the flywheel) and echo
 * a single-line summary to the console (so it also lands in dashboard.log). Best-effort — a logging
 * failure must never break a recovery action.
 */
export function recordDeaconNudge(nudge: DeaconNudge): void {
  const entry = { timestamp: new Date().toISOString(), ...nudge };
  try {
    const p = nudgeLogPath();
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(entry) + '\n');
  } catch {
    /* non-fatal — never let logging break recovery */
  }
  console.log(
    `[deacon-nudge] ${nudge.patrol} nudged ${nudge.issueId}: ${nudge.action} — REASON: ${nudge.reason}` +
      (nudge.state ? ` state=${JSON.stringify(nudge.state)}` : ''),
  );
}
