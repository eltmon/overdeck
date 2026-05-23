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

// ============== Flywheel gates ==============

export const FLYWHEEL_GLOBAL_PAUSE_KEY = 'flywheel.globally_paused';
export const FLYWHEEL_ACTIVE_RUN_ID_KEY = 'flywheel.active_run_id';

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
