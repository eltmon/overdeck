/**
 * The phone's notification preferences (PAN-5019 WI-7): pause and the muted categories, held in
 * `localStorage` as `{ revision, prefs }` so the app, its sync to every paired machine, and the
 * Settings screen all read the same value. `overdeck.notificationPrefsSynced` tracks, per machine,
 * the last revision that machine has acknowledged (D-9, D-10).
 *
 * Storage errors read as the default and writes fail silently, matching `push.ts`'s
 * `readStorage`/`writeStorage`. Stored JSON goes through `parsePhoneNotificationPreferences`; an
 * invalid value reads as the default.
 */
import { DEFAULT_PHONE_NOTIFICATION_PREFERENCES, parsePhoneNotificationPreferences, type PhoneNotificationPreferences } from '@overdeck/contracts';
import { useSyncExternalStore } from 'react';

export const NOTIFICATION_PREFS_KEY = 'overdeck.notificationPrefs';
export const NOTIFICATION_PREFS_SYNCED_KEY = 'overdeck.notificationPrefsSynced';

export type PauseChoice = 'hour' | 'morning' | 'indefinite';

export interface StoredNotificationPrefs {
  revision: number;
  prefs: PhoneNotificationPreferences;
}

const DEFAULT_STORED: StoredNotificationPrefs = { revision: 0, prefs: DEFAULT_PHONE_NOTIFICATION_PREFERENCES };

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the in-memory state still applies for this launch.
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseStored(raw: string | null): StoredNotificationPrefs {
  if (raw === null) return DEFAULT_STORED;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_STORED;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_STORED;
  const { revision, prefs } = value as { revision?: unknown; prefs?: unknown };
  const parsedPrefs = parsePhoneNotificationPreferences(prefs);
  if (parsedPrefs === null || !isNonNegativeInteger(revision)) return DEFAULT_STORED;
  return { revision, prefs: parsedPrefs };
}

let lastRaw: string | null | undefined;
let lastParsed: StoredNotificationPrefs = DEFAULT_STORED;

/** Memoized on the raw stored string, so `useSyncExternalStore` sees a stable reference until storage actually changes. */
export function readNotificationPrefs(): StoredNotificationPrefs {
  const raw = readStorage(NOTIFICATION_PREFS_KEY);
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastParsed = parseStored(raw);
  }
  return lastParsed;
}

const changeListeners = new Set<() => void>();

/** Returns the uninstaller. */
export function onNotificationPrefsChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of changeListeners) listener();
}

/** Stores `prefs` at the next revision and notifies every listener; returns the new revision. */
export function writeNotificationPrefs(prefs: PhoneNotificationPreferences): number {
  const revision = readNotificationPrefs().revision + 1;
  writeStorage(NOTIFICATION_PREFS_KEY, JSON.stringify({ revision, prefs }));
  notify();
  return revision;
}

/** D-6: "pause for 1 hour" is `now + 1 h`; "pause until tomorrow 8:00" is the next 08:00 in local time strictly after `now`. */
export function pauseFor(choice: PauseChoice, now: Date): PhoneNotificationPreferences['pause'] {
  if (choice === 'indefinite') return { until: null };
  if (choice === 'hour') return { until: new Date(now.getTime() + 60 * 60 * 1000).toISOString() };
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return { until: next.toISOString() };
}

/** D-3's pause rule: non-null `pause` whose `until` is null or still in the future at `nowMs`. */
export function isPaused(prefs: PhoneNotificationPreferences, nowMs: number): boolean {
  return prefs.pause !== null && (prefs.pause.until === null || Date.parse(prefs.pause.until) > nowMs);
}

function readSyncedMap(): Record<string, number> {
  const raw = readStorage(NOTIFICATION_PREFS_SYNCED_KEY);
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** 0 when `environmentId` has no recorded synced revision. */
export function syncedRevision(environmentId: string): number {
  const value = readSyncedMap()[environmentId];
  return isNonNegativeInteger(value) ? value : 0;
}

export function markSynced(environmentId: string, revision: number): void {
  const map = readSyncedMap();
  map[environmentId] = revision;
  writeStorage(NOTIFICATION_PREFS_SYNCED_KEY, JSON.stringify(map));
}

export function useNotificationPrefs(): StoredNotificationPrefs {
  return useSyncExternalStore(onNotificationPrefsChange, readNotificationPrefs);
}
