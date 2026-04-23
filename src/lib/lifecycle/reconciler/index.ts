import { getDatabase } from '../../database/index.js';
import { startLoop } from './loop.js';
import type { ReconcilerConfig, LabelIntent, CanonicalState } from './types.js';

let stopFn: (() => void) | null = null;

const state = {
  running: false,
  timer: null as ReturnType<typeof setInterval> | null,
  mutex: false,
};

/** In-memory queue of label-change intents (drained each tick). */
const intentQueue: LabelIntent[] = [];

/**
 * Start the reconciler service.
 * Idempotent — safe to call multiple times; subsequent calls are no-ops.
 */
export function startReconciler(config: ReconcilerConfig): void {
  if (state.running) {
    console.log('[reconciler] Already running, skipping start');
    return;
  }

  stopFn = startLoop(config, state);
  console.log(`[reconciler] Started (interval=${config.intervalMs}ms)`);
}

/**
 * Stop the reconciler service.
 */
export function stopReconciler(): void {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
}

/**
 * Enqueue a label-change intent to be processed on the next tick.
 */
export function enqueueLabelChange(intent: LabelIntent): void {
  intentQueue.push(intent);
}

/** @internal Drain the intent queue (called by push step each tick). */
export function drainIntentQueue(): LabelIntent[] {
  return intentQueue.splice(0, intentQueue.length);
}

/**
 * Set the canonical state for an issue.
 * Upserts into `issue_state` and enqueues the corresponding label changes.
 */
export function setCanonicalState(
  issueId: string,
  canonicalState: CanonicalState,
  reason?: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  // New rows get epoch last_synced_at so the push step immediately picks them up.
  // Existing rows preserve their last_synced_at via the ON CONFLICT clause.
  db.prepare(
    `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at, pending_mutation)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(issue_id) DO UPDATE SET
       canonical_state = excluded.canonical_state,
       updated_at = excluded.updated_at,
       pending_mutation = COALESCE(excluded.pending_mutation, pending_mutation)`
  ).run(issueId, canonicalState, '1970-01-01T00:00:00.000Z', now, reason ?? null);
}

/**
 * Read the canonical state for an issue (returns null if not tracked).
 */
export function getCanonicalState(issueId: string): CanonicalState | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT canonical_state FROM issue_state WHERE issue_id = ?')
    .get(issueId) as { canonical_state: CanonicalState } | undefined;
  return row ? row.canonical_state : null;
}

/**
 * Lazy-insert an issue row if it does not already exist.
 * Used by call-site migrations to ensure any issue transitioning for the
 * first time gets a row without overwriting existing state.
 */
export function ensureIssueState(
  issueId: string,
  canonicalState: CanonicalState
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  // New rows get epoch last_synced_at so the push step immediately picks them up.
  db.prepare(
    `INSERT OR IGNORE INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(issueId, canonicalState, '1970-01-01T00:00:00.000Z', now);
}
