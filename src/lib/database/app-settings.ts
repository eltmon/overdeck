/**
 * Persistent global key/value settings.
 *
 * Survives dashboard restarts via the `app_settings` SQLite table (schema v27).
 * Currently used for the global Deacon pause flag.
 *
 * PAN-1249: Effect migration pass — synchronous public API preserved to keep
 * the existing call sites unchanged. SQLite operations are wrapped in
 * Effect.try with a local DatabaseError tag so the failure mode is typed.
 * Pre-existing defensive try/catch + console.warn handlers were preserved as
 * Effect.catchTag at the boundary; behaviour is unchanged. A full conversion
 * to @effect/sql-sqlite-bun is deferred to PAN-447.
 */

import { Data, Effect } from 'effect';
import { getDatabase } from './index.js';

/** A SQLite operation against panopticon.db failed. */
class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}

const getSettingProgram = (key: string): Effect.Effect<string | null, DatabaseError> =>
  Effect.try({
    try: () => {
      const db = getDatabase();
      const row = db
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },
    catch: (cause) => new DatabaseError({ operation: `getSetting(${key})`, cause }),
  });

const setSettingProgram = (key: string, value: string): Effect.Effect<void, DatabaseError> =>
  Effect.try({
    try: () => {
      const db = getDatabase();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, value, now);
    },
    catch: (cause) => new DatabaseError({ operation: `setSetting(${key})`, cause }),
  });

export function getSetting(key: string): string | null {
  return Effect.runSync(getSettingProgram(key));
}

export function setSetting(key: string, value: string): void {
  Effect.runSync(setSettingProgram(key, value));
}

// ============== Deacon global pause ==============

export const DEACON_GLOBAL_PAUSE_KEY = 'deacon.globally_paused';

export function isDeaconGloballyPaused(): boolean {
  return Effect.runSync(
    getSettingProgram(DEACON_GLOBAL_PAUSE_KEY).pipe(
      Effect.map((v) => v === 'true'),
      Effect.catchTag('DatabaseError', (err) => {
        console.warn('[app-settings] Failed to read deacon pause flag:', err.cause);
        return Effect.succeed(false);
      }),
    ),
  );
}

export function setDeaconGloballyPaused(paused: boolean): void {
  setSetting(DEACON_GLOBAL_PAUSE_KEY, paused ? 'true' : 'false');
}

// ============== Boot reconciliation ==============

export const BOOT_RECONCILIATION_DECISION_KEY = 'boot_reconciliation.decision';
export const BOOT_RECONCILIATION_PER_AGENT_KEY = 'boot_reconciliation.per_agent';
export const BOOT_RECONCILIATION_DECIDED_AT_KEY = 'boot_reconciliation.decided_at';
export const BOOT_RECONCILIATION_BOOT_ID_KEY = 'boot_reconciliation.boot_id';
export const BOOT_RECONCILIATION_GRACE_DEADLINE_KEY = 'boot_reconciliation.grace_deadline';

export type BootReconciliationDecision = 'pending' | 'resume_all' | 'hold_all' | 'per_agent';
export type BootReconciliationPerAgentAction = 'resume' | 'hold';
export type BootReconciliationPerAgentMap = Record<string, BootReconciliationPerAgentAction>;

export interface BootReconciliationState {
  decision: BootReconciliationDecision | null;
  perAgent: BootReconciliationPerAgentMap;
  decidedAt: string | null;
  bootId: string | null;
  graceDeadline: string | null;
}

const BOOT_RECONCILIATION_DECISIONS = new Set<BootReconciliationDecision>([
  'pending',
  'resume_all',
  'hold_all',
  'per_agent',
]);

function parseBootReconciliationDecision(value: string | null): BootReconciliationDecision | null {
  if (value && BOOT_RECONCILIATION_DECISIONS.has(value as BootReconciliationDecision)) {
    return value as BootReconciliationDecision;
  }
  return null;
}

function parseBootReconciliationPerAgent(value: string | null): BootReconciliationPerAgentMap {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const perAgent: BootReconciliationPerAgentMap = {};
    for (const [issueId, action] of Object.entries(parsed)) {
      if (action === 'resume' || action === 'hold') {
        perAgent[issueId] = action;
      }
    }
    return perAgent;
  } catch (err) {
    console.warn('[app-settings] Failed to parse boot reconciliation per-agent map:', err);
    return {};
  }
}

export function getBootReconciliationState(): BootReconciliationState {
  return {
    decision: parseBootReconciliationDecision(getSetting(BOOT_RECONCILIATION_DECISION_KEY)),
    perAgent: parseBootReconciliationPerAgent(getSetting(BOOT_RECONCILIATION_PER_AGENT_KEY)),
    decidedAt: getSetting(BOOT_RECONCILIATION_DECIDED_AT_KEY),
    bootId: getSetting(BOOT_RECONCILIATION_BOOT_ID_KEY),
    graceDeadline: getSetting(BOOT_RECONCILIATION_GRACE_DEADLINE_KEY),
  };
}

export function setBootReconciliationDecision(
  decision: BootReconciliationDecision,
  perAgent: BootReconciliationPerAgentMap = {},
): void {
  setSetting(BOOT_RECONCILIATION_DECISION_KEY, decision);
  setSetting(BOOT_RECONCILIATION_PER_AGENT_KEY, JSON.stringify(perAgent));
  setSetting(BOOT_RECONCILIATION_DECIDED_AT_KEY, new Date().toISOString());
}

export function stampBootReconciliation(bootId: string, graceDeadline: string): void {
  setSetting(BOOT_RECONCILIATION_BOOT_ID_KEY, bootId);
  setSetting(BOOT_RECONCILIATION_GRACE_DEADLINE_KEY, graceDeadline);
}

// ============== Flywheel gates ==============

export const FLYWHEEL_GLOBAL_PAUSE_KEY = 'flywheel.globally_paused';
export const FLYWHEEL_ACTIVE_RUN_ID_KEY = 'flywheel.active_run_id';
export const FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY = 'flywheel.auto_pickup_backlog';
export const FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY = 'flywheel.require_uat_before_merge';
// PAN-1691: gate for the rolling merge-train reconciler (rebase ready siblings
// after a merge, agent-resolve conflicts). Default OFF — it mutates git, so it
// stays inert until an operator deliberately enables it.
export const FLYWHEEL_MERGE_TRAIN_ENABLED_KEY = 'flywheel.merge_train_enabled';

export function isFlywheelGloballyPaused(): boolean {
  return Effect.runSync(
    getSettingProgram(FLYWHEEL_GLOBAL_PAUSE_KEY).pipe(
      Effect.map((v) => v === 'true'),
      Effect.catchTag('DatabaseError', (err) => {
        console.warn('[app-settings] Failed to read flywheel pause flag:', err.cause);
        return Effect.succeed(false);
      }),
    ),
  );
}

export function setFlywheelGloballyPaused(paused: boolean): void {
  setSetting(FLYWHEEL_GLOBAL_PAUSE_KEY, paused ? 'true' : 'false');
}

export function isFlywheelAutoPickupBacklog(): boolean {
  return Effect.runSync(
    getSettingProgram(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY).pipe(
      Effect.map((v) => v === 'true'),
      Effect.catchTag('DatabaseError', (err) => {
        console.warn('[app-settings] Failed to read flywheel auto-pickup backlog flag:', err.cause);
        return Effect.succeed(false);
      }),
    ),
  );
}

export function setFlywheelAutoPickupBacklog(enabled: boolean): void {
  setSetting(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY, enabled ? 'true' : 'false');
}

export function isFlywheelRequireUatBeforeMerge(): boolean {
  return Effect.runSync(
    getSettingProgram(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY).pipe(
      Effect.map((v) => v !== 'false'),
      Effect.catchTag('DatabaseError', (err) => {
        console.warn('[app-settings] Failed to read flywheel require-UAT-before-merge flag:', err.cause);
        return Effect.succeed(true);
      }),
    ),
  );
}

export function setFlywheelRequireUatBeforeMerge(required: boolean): void {
  setSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY, required ? 'true' : 'false');
}

export function isMergeTrainEnabled(): boolean {
  return Effect.runSync(
    getSettingProgram(FLYWHEEL_MERGE_TRAIN_ENABLED_KEY).pipe(
      Effect.map((v) => v === 'true'),
      Effect.catchTag('DatabaseError', (err) => {
        console.warn('[app-settings] Failed to read merge-train flag:', err.cause);
        return Effect.succeed(false);
      }),
    ),
  );
}

export function setMergeTrainEnabled(enabled: boolean): void {
  setSetting(FLYWHEEL_MERGE_TRAIN_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getFlywheelActiveRunId(): string | null {
  return Effect.runSync(
    getSettingProgram(FLYWHEEL_ACTIVE_RUN_ID_KEY).pipe(
      Effect.map((v) => (v && v.trim() ? v : null)),
      Effect.catchTag('DatabaseError', (err) => {
        console.warn('[app-settings] Failed to read flywheel active run id:', err.cause);
        return Effect.succeed<string | null>(null);
      }),
    ),
  );
}

export function setFlywheelActiveRunId(runId: string | null): void {
  setSetting(FLYWHEEL_ACTIVE_RUN_ID_KEY, runId ?? '');
}
