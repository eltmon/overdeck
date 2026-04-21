/**
 * Persistent global key/value settings.
 *
 * Survives dashboard restarts via the `app_settings` SQLite table (schema v27).
 * Currently used for the global Deacon pause flag.
 */

import { getDatabase } from './index.js';

export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

// ============== Deacon global pause ==============

export const DEACON_GLOBAL_PAUSE_KEY = 'deacon.globally_paused';

export function isDeaconGloballyPaused(): boolean {
  try {
    return getSetting(DEACON_GLOBAL_PAUSE_KEY) === 'true';
  } catch (err) {
    console.warn('[app-settings] Failed to read deacon pause flag:', err);
    return false;
  }
}

export function setDeaconGloballyPaused(paused: boolean): void {
  setSetting(DEACON_GLOBAL_PAUSE_KEY, paused ? 'true' : 'false');
}
