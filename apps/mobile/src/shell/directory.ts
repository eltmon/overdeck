/**
 * The shell's overdeck.ai directory socket and machine dialer (PAN-4837 WI-9). The app connects as
 * a client; `hello-client.publicKeyHex` carries the install's push public key (C-2).
 */
import { createMachineDialer, DirectoryWebClient, type DirectoryWebState, type MachineDialer } from '@overdeck/anywhere-channel/web';
import type { ClientPlatform, DirectoryMachine } from '@overdeck/contracts';
import { useSyncExternalStore } from 'react';

import type { DeviceIdentity } from '../native/keys';
import { APP_VERSION, DIRECTORY_BASE_URL } from './config';

export interface ShellDirectory {
  readonly client: DirectoryWebClient;
  readonly dialer: MachineDialer;
  /** The directory's last `relay-status` said this month's relay allowance is used. */
  relayStopped(): boolean;
}

export interface DirectoryOptions {
  identity: DeviceIdentity;
  /** The account token, or null when signed out. */
  accountToken: () => Promise<string | null>;
  /** The phone's name, shown on the machine's Settings. */
  label: string;
  platform: ClientPlatform;
}

export function createDirectory({ identity, accountToken, label, platform }: DirectoryOptions): ShellDirectory {
  const client = new DirectoryWebClient({
    baseUrl: DIRECTORY_BASE_URL,
    token: accountToken,
    clientId: identity.clientId,
    label,
    publicKeyHex: identity.pushPublicKeyHex,
    appVersion: APP_VERSION,
    platform,
  });
  let stopped = false;
  client.on('relay-status', (frame) => {
    stopped = frame.stopped;
  });
  return { client, dialer: createMachineDialer(client), relayStopped: () => stopped };
}

/** The directory socket's state, re-rendering on every change. */
export function useDirectoryState(client: DirectoryWebClient): DirectoryWebState {
  return useSyncExternalStore(
    (onChange) => client.onStateChange(onChange),
    () => client.state,
  );
}

/** The account's machines as the directory last reported them. */
export function useDirectoryMachines(client: DirectoryWebClient): readonly DirectoryMachine[] {
  return useSyncExternalStore(
    (onChange) => client.onStateChange(onChange),
    () => client.machines,
  );
}
