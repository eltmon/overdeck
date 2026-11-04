import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isPaused,
  markSynced,
  NOTIFICATION_PREFS_KEY,
  onNotificationPrefsChange,
  pauseFor,
  readNotificationPrefs,
  syncedRevision,
  writeNotificationPrefs,
} from '../notificationPrefs';

beforeEach(() => {
  localStorage.clear();
});

describe('pauseFor (PAN-5019 D-6)', () => {
  it("'hour' is now plus one hour", () => {
    const now = new Date('2026-11-04T10:00:00.000Z');
    expect(pauseFor('hour', now)).toEqual({ until: new Date('2026-11-04T11:00:00.000Z').toISOString() });
  });

  it("'morning' at 02:00 local is 08:00 the same day", () => {
    const now = new Date(2026, 10, 4, 2, 0, 0, 0);
    const result = pauseFor('morning', now);
    expect(result?.until).not.toBeNull();
    const until = new Date(result?.until as string);
    expect([until.getFullYear(), until.getMonth(), until.getDate(), until.getHours(), until.getMinutes()]).toEqual([2026, 10, 4, 8, 0]);
  });

  it("'morning' at 09:00 local is 08:00 the next day", () => {
    const now = new Date(2026, 10, 4, 9, 0, 0, 0);
    const result = pauseFor('morning', now);
    const until = new Date(result?.until as string);
    expect([until.getFullYear(), until.getMonth(), until.getDate(), until.getHours(), until.getMinutes()]).toEqual([2026, 10, 5, 8, 0]);
  });

  it("'indefinite' is until: null", () => {
    expect(pauseFor('indefinite', new Date())).toEqual({ until: null });
  });
});

describe('isPaused', () => {
  it('is false once until has passed', () => {
    const nowMs = Date.parse('2026-11-04T12:00:00.000Z');
    expect(isPaused({ v: 1, pause: { until: '2026-11-04T11:00:00.000Z' }, muted: [] }, nowMs)).toBe(false);
    expect(isPaused({ v: 1, pause: { until: '2026-11-04T13:00:00.000Z' }, muted: [] }, nowMs)).toBe(true);
    expect(isPaused({ v: 1, pause: { until: null }, muted: [] }, nowMs)).toBe(true);
    expect(isPaused({ v: 1, pause: null, muted: [] }, nowMs)).toBe(false);
  });
});

describe('readNotificationPrefs / writeNotificationPrefs', () => {
  it('round-trips and increments the revision on each write', () => {
    expect(readNotificationPrefs()).toEqual({ revision: 0, prefs: { v: 1, pause: null, muted: [] } });
    const prefs = { v: 1 as const, pause: null, muted: ['failed' as const] };
    expect(writeNotificationPrefs(prefs)).toBe(1);
    expect(readNotificationPrefs()).toEqual({ revision: 1, prefs });
    expect(writeNotificationPrefs(prefs)).toBe(2);
    expect(readNotificationPrefs()).toEqual({ revision: 2, prefs });
  });

  it('notifies listeners on write', () => {
    const listener = vi.fn();
    const unsubscribe = onNotificationPrefsChange(listener);
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns a stable reference across reads until the value actually changes (useSyncExternalStore contract)', () => {
    expect(readNotificationPrefs()).toBe(readNotificationPrefs());
    const prefs = { v: 1 as const, pause: null, muted: [] };
    writeNotificationPrefs(prefs);
    const after = readNotificationPrefs();
    expect(after).toBe(readNotificationPrefs());
  });

  it('reads a corrupt stored value as the default', () => {
    localStorage.setItem(NOTIFICATION_PREFS_KEY, 'not json');
    expect(readNotificationPrefs()).toEqual({ revision: 0, prefs: { v: 1, pause: null, muted: [] } });
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify({ revision: 1, prefs: { v: 2 } }));
    expect(readNotificationPrefs()).toEqual({ revision: 0, prefs: { v: 1, pause: null, muted: [] } });
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify({ revision: -1, prefs: { v: 1, pause: null, muted: [] } }));
    expect(readNotificationPrefs()).toEqual({ revision: 0, prefs: { v: 1, pause: null, muted: [] } });
  });
});

describe('syncedRevision / markSynced', () => {
  it('is 0 when absent, then tracks the revision marked for that machine only', () => {
    expect(syncedRevision('env-1')).toBe(0);
    markSynced('env-1', 3);
    expect(syncedRevision('env-1')).toBe(3);
    expect(syncedRevision('env-2')).toBe(0);
    markSynced('env-1', 4);
    expect(syncedRevision('env-1')).toBe(4);
  });
});
