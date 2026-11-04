import type { DirectoryWebState } from '@overdeck/anywhere-channel/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrefsSync, PREFS_SYNC_RETRY_BACKOFF_MS, PREFS_SYNC_SEND_TIMEOUT_MS, type PrefsSyncDeps } from '../notificationPrefsSync';
import { markSynced, writeNotificationPrefs } from '../notificationPrefs';
import type { PairedMachine } from '../types';

function machine(id: string, label: string): PairedMachine {
  return {
    environmentId: id,
    label,
    machineKeyHex: 'ab'.repeat(32),
    linkPublicKeyHex: 'cd'.repeat(32),
    linkSecretKeyHex: 'ef'.repeat(32),
    token: `opt_${label}`,
    tokenId: `tok-${label}`,
    pairedAt: '2026-11-03T00:00:00.000Z',
  };
}

const DESK = machine('e-desk', 'desk');

interface DirectoryMachineLike {
  environmentId: string;
  online: boolean;
}

function fakeDirectory(initialMachines: DirectoryMachineLike[]) {
  const listeners = new Set<(state: DirectoryWebState) => void>();
  let machines = initialMachines;
  let state: DirectoryWebState = 'online';
  return {
    directory: {
      get state() {
        return state;
      },
      get machines() {
        return machines;
      },
      onStateChange(listener: (s: DirectoryWebState) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as PrefsSyncDeps['directory'],
    setMachines(next: DirectoryMachineLike[]) {
      machines = next;
      for (const listener of listeners) listener(state);
    },
    setState(next: DirectoryWebState) {
      state = next;
      for (const listener of listeners) listener(state);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createPrefsSync (PAN-5019 WI-8)', () => {
  it('sends one PUT to a stale online machine and marks it synced', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: ['failed'] });
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: true }]);
    const send = vi.fn(async () => 200);
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });

    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(DESK, { v: 1, pause: null, muted: ['failed'] }, expect.any(AbortSignal));
    expect(sync.status(DESK.environmentId)).toBe('synced');

    // A second syncNow with nothing new to sync sends nothing more.
    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it('stays pending while offline, then sends once an onStateChange lists the machine online', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: false }]);
    const send = vi.fn(async () => 200);
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });

    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
    expect(sync.status(DESK.environmentId)).toBe('pending');

    fake.setMachines([{ environmentId: DESK.environmentId, online: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.status(DESK.environmentId)).toBe('synced');
    sync.stop();
  });

  it('marks a machine outdated on 404 and sends nothing more for this revision', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: true }]);
    const send = vi.fn(async () => 404);
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });

    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.status(DESK.environmentId)).toBe('outdated');

    fake.setMachines([{ environmentId: DESK.environmentId, online: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it('backs off a failure for 60 s, then retries', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: true }]);
    const send = vi.fn(async () => 500);
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });

    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.status(DESK.environmentId)).toBe('failed');

    await vi.advanceTimersByTimeAsync(PREFS_SYNC_RETRY_BACKOFF_MS - 1);
    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    sync.stop();
  });

  it('sends nothing for a machine already at the current revision', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    markSynced(DESK.environmentId, 1);
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: true }]);
    const send = vi.fn(async () => 200);
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });

    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
    expect(sync.status(DESK.environmentId)).toBe('synced');
    sync.stop();
  });

  it('re-syncs with the latest prefs once an in-flight send settles, instead of dropping the update', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: true }]);
    const resolvers: Array<(status: number) => void> = [];
    const send = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });

    sync.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    writeNotificationPrefs({ v: 1, pause: null, muted: ['failed'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1); // still in flight; skipped by the prefs-change trigger

    resolvers[0]?.(200);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(DESK, { v: 1, pause: null, muted: ['failed'] }, expect.any(AbortSignal));

    resolvers[1]?.(200);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.status(DESK.environmentId)).toBe('synced');
    sync.stop();
  });

  it('times out a send after 10 s and treats it as a failure', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: true }]);
    const send = vi.fn(() => new Promise<number>(() => undefined));
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });

    sync.syncNow();
    await vi.advanceTimersByTimeAsync(PREFS_SYNC_SEND_TIMEOUT_MS);
    expect(sync.status(DESK.environmentId)).toBe('failed');
    sync.stop();
  });

  it('stop() unsubscribes from both prefs and directory changes', async () => {
    writeNotificationPrefs({ v: 1, pause: null, muted: [] });
    const fake = fakeDirectory([{ environmentId: DESK.environmentId, online: true }]);
    const send = vi.fn(async () => 200);
    const sync = createPrefsSync({ directory: fake.directory, paired: () => [DESK], send });
    sync.stop();

    writeNotificationPrefs({ v: 1, pause: null, muted: ['failed'] });
    fake.setState('online');
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
  });
});
