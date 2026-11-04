/**
 * Sync the phone's notification preferences to every paired machine (PAN-5019 WI-8, D-10).
 *
 * `syncNow` sends one `PUT /api/phones/self/notification-preferences` per machine that is behind
 * the current revision, online, not already in flight, not in a 60 s failure back-off, and not
 * marked outdated for this revision. It runs on every `onNotificationPrefsChange` and on every
 * directory `onStateChange` while the directory is online (the directory also fires this on a
 * machine-list update, which is how a machine coming online gets its turn).
 */
import { requestOnChannel, type DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import type { PhoneNotificationPreferences } from '@overdeck/contracts';

import type { Connection } from './connection';
import { markSynced, onNotificationPrefsChange, readNotificationPrefs, syncedRevision } from './notificationPrefs';
import type { PairedMachine } from './types';

export const PREFS_SYNC_SEND_TIMEOUT_MS = 10_000;
export const PREFS_SYNC_RETRY_BACKOFF_MS = 60_000;

export type PrefsSyncStatus = 'synced' | 'pending' | 'outdated' | 'failed';

export interface PrefsSyncDeps {
  directory: Pick<DirectoryWebClient, 'state' | 'machines' | 'onStateChange'>;
  paired(): readonly PairedMachine[];
  /** One PUT over a link channel; resolves with the HTTP status. Default `putPrefsOver(connection)`. */
  send(machine: PairedMachine, prefs: PhoneNotificationPreferences, signal: AbortSignal): Promise<number>;
  now?: () => number;
}

export interface PrefsSync {
  syncNow(): void;
  status(environmentId: string): PrefsSyncStatus;
  onChange(listener: () => void): () => void;
  stop(): void;
}

interface MachineState {
  inFlight: boolean;
  outdatedAtRevision?: number;
  failedAt?: number;
}

/** Run `work` with an abort signal that fires after `ms`; settles by then either way (as `signOut.ts`'s `bounded`). */
function bounded(ms: number, work: (signal: AbortSignal) => Promise<number>): Promise<number> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`timed out after ${ms} ms`));
      reject(controller.signal.reason);
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

export function createPrefsSync(deps: PrefsSyncDeps): PrefsSync {
  const now = deps.now ?? Date.now;
  const states = new Map<string, MachineState>();
  const listeners = new Set<() => void>();
  let stopped = false;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function machineOnline(environmentId: string): boolean {
    return deps.directory.machines.some((machine) => machine.environmentId === environmentId && machine.online);
  }

  function status(environmentId: string): PrefsSyncStatus {
    const current = readNotificationPrefs().revision;
    if (syncedRevision(environmentId) >= current) return 'synced';
    if (!machineOnline(environmentId)) return 'pending';
    const state = states.get(environmentId);
    if (state?.failedAt !== undefined && now() - state.failedAt < PREFS_SYNC_RETRY_BACKOFF_MS) return 'failed';
    if (state?.outdatedAtRevision === current) return 'outdated';
    return 'pending';
  }

  function shouldSend(environmentId: string, current: number): boolean {
    if (syncedRevision(environmentId) >= current) return false;
    if (!machineOnline(environmentId)) return false;
    const state = states.get(environmentId);
    if (state?.inFlight) return false;
    if (state?.failedAt !== undefined && now() - state.failedAt < PREFS_SYNC_RETRY_BACKOFF_MS) return false;
    if (state?.outdatedAtRevision === current) return false;
    return true;
  }

  async function sendTo(machine: PairedMachine, revision: number, prefs: PhoneNotificationPreferences): Promise<void> {
    states.set(machine.environmentId, { inFlight: true });
    notify();
    try {
      const httpStatus = await bounded(PREFS_SYNC_SEND_TIMEOUT_MS, (signal) => deps.send(machine, prefs, signal));
      if (httpStatus === 200) {
        markSynced(machine.environmentId, revision);
        states.set(machine.environmentId, { inFlight: false });
      } else if (httpStatus === 404 || httpStatus === 405) {
        states.set(machine.environmentId, { inFlight: false, outdatedAtRevision: revision });
      } else {
        states.set(machine.environmentId, { inFlight: false, failedAt: now() });
      }
    } catch {
      states.set(machine.environmentId, { inFlight: false, failedAt: now() });
    }
    if (!stopped) {
      notify();
      // D-10: a prefs change that arrived while this machine was in flight was skipped by that
      // pass; re-run now so the latest prefs still reach it instead of waiting for another trigger.
      syncNow();
    }
  }

  function syncNow(): void {
    if (stopped) return;
    const { revision, prefs } = readNotificationPrefs();
    for (const machine of deps.paired()) {
      if (shouldSend(machine.environmentId, revision)) void sendTo(machine, revision, prefs);
    }
  }

  const unsubscribePrefs = onNotificationPrefsChange(syncNow);
  const unsubscribeDirectory = deps.directory.onStateChange((state) => {
    if (state === 'online') syncNow();
  });

  return {
    syncNow,
    status,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      stopped = true;
      unsubscribePrefs();
      unsubscribeDirectory();
      listeners.clear();
    },
  };
}

const encoder = new TextEncoder();

/** `PUT /api/phones/self/notification-preferences` on a link channel to the machine, with its phone token (follows `removeSelfOver`). */
export function putPrefsOver(connection: Pick<Connection, 'openLink'>): PrefsSyncDeps['send'] {
  return async (machine, prefs, signal) => {
    const stream = await connection.openLink(machine, { signal });
    try {
      const { response } = await requestOnChannel(
        stream,
        {
          method: 'PUT',
          path: '/api/phones/self/notification-preferences',
          headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
          body: encoder.encode(JSON.stringify(prefs)),
        },
        { signal },
      );
      return response.status;
    } finally {
      stream.destroy();
    }
  };
}
