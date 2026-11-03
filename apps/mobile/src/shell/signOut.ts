/**
 * Sign out (PAN-4837 FR-12). In order: remove this phone on each paired machine
 * (`DELETE /api/phones/self`, best effort, 5 s each; a dropped connection counts as success because
 * the machine closes the caller's own channel, PAN-4835 D-12), delete the FCM token (PAN-4840
 * FR-10, whatever the directory state), tell the directory (`push-unregister`, `forget-client`)
 * when online, revoke the overdeck.ai device, delete every
 * key and secret, clear `localStorage`, and reload. A failing step is logged and never stops the
 * next one.
 */
import { CapacitorHttp } from '@capacitor/core';
import { ChannelHttpError, requestOnChannel } from '@overdeck/anywhere-channel/web';
import type { ClientToDirectoryFrame } from '@overdeck/contracts';

import { OverdeckKeys } from '../native/keys';
import { ACCOUNT_BASE_URL } from './config';
import type { Connection } from './connection';
import type { AccountRecord, PairedMachine } from './types';

export const SIGN_OUT_STEP_TIMEOUT_MS = 5_000;

export interface SignOutDeps {
  machines: readonly PairedMachine[];
  account: AccountRecord | null;
  /** `DELETE /api/phones/self` on one machine; rejects or never settles when the machine is away. */
  removeSelf(machine: PairedMachine, signal: AbortSignal): Promise<void>;
  /** The directory socket, or null when there is none. */
  directory: { readonly state: string; send(frame: ClientToDirectoryFrame): boolean } | null;
  deleteDevice(account: AccountRecord, signal: AbortSignal): Promise<void>;
  /** Deletes this install's push token (`PushNotifications.unregister()`); a no-op where push is unavailable. */
  unregisterPush(): Promise<void>;
  resetKeys(): Promise<void>;
  clearStorage(): void;
  reload(): void;
  log?: (step: string, error: unknown) => void;
}

/** Run `work` with an abort signal that fires after `ms`; settles by then either way. */
function bounded(ms: number, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`timed out after ${ms} ms`));
      reject(controller.signal.reason);
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

export async function signOut(deps: SignOutDeps): Promise<void> {
  const log = deps.log ?? ((step, error) => console.warn(`[sign-out] ${step} failed`, error));
  const step = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run();
    } catch (error) {
      log(name, error);
    }
  };

  for (const machine of deps.machines) {
    await step(`remove from ${machine.label}`, () => bounded(SIGN_OUT_STEP_TIMEOUT_MS, (signal) => deps.removeSelf(machine, signal)));
  }
  await step('push token', () => deps.unregisterPush());
  const directory = deps.directory;
  if (directory?.state === 'online') {
    await step('push-unregister', () => void directory.send({ type: 'push-unregister' }));
    await step('forget-client', () => void directory.send({ type: 'forget-client' }));
  }
  const account = deps.account;
  if (account) {
    await step('revoke device', () => bounded(SIGN_OUT_STEP_TIMEOUT_MS, (signal) => deps.deleteDevice(account, signal)));
  }
  await step('reset keys', () => deps.resetKeys());
  await step('clear storage', () => deps.clearStorage());
  deps.reload();
}

/** `DELETE /api/phones/self` on a link channel to the machine, with its phone token. */
export function removeSelfOver(connection: Pick<Connection, 'openLink'>) {
  return async (machine: PairedMachine, signal: AbortSignal): Promise<void> => {
    const stream = await connection.openLink(machine, { signal });
    try {
      const { response } = await requestOnChannel(
        stream,
        { method: 'DELETE', path: '/api/phones/self', headers: { Authorization: `Bearer ${machine.token}` } },
        { signal },
      );
      if (response.status >= 400 && response.status !== 401) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      // The machine closes the caller's own channel as it revokes it, so the answer may never arrive.
      if (!(error instanceof ChannelHttpError && error.code === 'channel-closed')) throw error;
    } finally {
      stream.destroy();
    }
  };
}

/** `DELETE /v1/devices/<id>` on overdeck.ai with the device's own token. */
export async function deleteAccountDevice(account: AccountRecord): Promise<void> {
  const response = await CapacitorHttp.request({
    method: 'DELETE',
    url: `${ACCOUNT_BASE_URL}/v1/devices/${encodeURIComponent(account.deviceId)}`,
    headers: { Authorization: `Bearer ${account.token}` },
  });
  if (response.status >= 400 && response.status !== 401 && response.status !== 404) throw new Error(`HTTP ${response.status}`);
}

export const resetAllKeys = (): Promise<void> => OverdeckKeys.reset();
