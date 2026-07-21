/**
 * PAN-2487: per-issue Ship-phase log sink. The merge door runs server-side
 * (no agent session), so the cockpit's Ship node had nothing to show while a
 * merge ground through rebase → verification → PR merge. Door steps and
 * quality-gate lines are appended here and served to the UI.
 *
 * In-memory ring buffer — the runtime plane; rebuildable, never persisted.
 */

export interface ShipLogEntry {
  ts: string;
  line: string;
}

export interface ShipLogState {
  issueId: string;
  startedAt: string;
  updatedAt: string;
  /** Mirrors review_status.merge_step at append time ('rebasing' | 'verifying' | 'merging' | …). */
  step?: string;
  lines: ShipLogEntry[];
}

const MAX_LINES = 500;
const MAX_ISSUES = 50;

const logs = new Map<string, ShipLogState>();

export function beginShipLog(issueId: string): void {
  const now = new Date().toISOString();
  logs.set(issueId.toUpperCase(), {
    issueId: issueId.toUpperCase(),
    startedAt: now,
    updatedAt: now,
    lines: [],
  });
  if (logs.size > MAX_ISSUES) {
    const oldest = [...logs.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    if (oldest) logs.delete(oldest.issueId);
  }
}

export function appendShipLog(issueId: string, line: string, step?: string): void {
  const key = issueId.toUpperCase();
  let state = logs.get(key);
  if (!state) {
    beginShipLog(key);
    state = logs.get(key)!;
  }
  state.updatedAt = new Date().toISOString();
  if (step) state.step = step;
  state.lines.push({ ts: state.updatedAt, line });
  if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES);
}

export function getShipLog(issueId: string): ShipLogState | null {
  return logs.get(issueId.toUpperCase()) ?? null;
}
