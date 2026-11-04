/**
 * The connector's overdeck.ai directory socket (PAN-4927 W-CONN2, PAN-4950 D-14, D-15, D-20).
 *
 * The connector joins the directory as a client with `platform: 'node'` (W-DIR1,
 * PAN-4927 D-18): `DirectoryWebClient` sends the account token as the
 * `overdeck.bearer.<token>` subprotocol, says `hello-client` with the home's
 * `clientId` and install public key, relays WebRTC signalling and hands out ICE
 * servers. Node 22's global `WebSocket` is the default; a caller may inject
 * another class (checkpoint CP-11).
 */
import { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import type { DirectoryMachine } from '@overdeck/contracts';

import type { ConnectorAccount, ConnectorIdentity } from './home.js';

export const DIRECTORY_ONLINE_TIMEOUT_MS = 15_000;

export function createConnectorDirectory(input: {
  account: ConnectorAccount;
  identity: ConnectorIdentity;
  label: string;
  appVersion: string;
  WebSocket?: typeof WebSocket;
}): DirectoryWebClient {
  const { account, identity } = input;
  return new DirectoryWebClient({
    baseUrl: account.directoryUrl,
    token: async () => account.accessToken,
    clientId: identity.clientId,
    label: input.label,
    publicKeyHex: identity.installPublicKey,
    appVersion: input.appVersion,
    platform: 'node',
    ...(input.WebSocket ? { WebSocket: input.WebSocket } : {}),
  });
}

/** Resolves once the directory says `welcome-client`; rejects on a refusal or after `timeoutMs`. */
export function waitDirectoryOnline(
  directory: Pick<DirectoryWebClient, 'state' | 'refusal' | 'onStateChange'>,
  timeoutMs: number = DIRECTORY_ONLINE_TIMEOUT_MS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let off: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (finish: () => void): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      off();
      finish();
    };
    const check = (): boolean => {
      if (directory.state === 'online') {
        settle(resolve);
        return true;
      }
      if (directory.state === 'refused') {
        settle(() => reject(new Error(directory.refusal ?? 'overdeck.ai directory refused this connector')));
        return true;
      }
      return false;
    };
    if (check()) return;
    off = directory.onStateChange(() => {
      check();
    });
    timer = setTimeout(() => {
      settle(() => reject(new Error(`Could not reach the overdeck.ai directory within ${Math.round(timeoutMs / 1000)} s`)));
    }, timeoutMs);
  });
}

export type MachineLookup = { ok: true; machine: DirectoryMachine } | { ok: false; error: string };

/** D-14: the paired machine must be in this account's directory and online. */
export function machineInDirectory(directory: Pick<DirectoryWebClient, 'machines'>, environmentId: string): MachineLookup {
  const machine = directory.machines.find((entry) => entry.environmentId === environmentId);
  if (!machine) {
    return {
      ok: false,
      error: `This connector is signed in to an overdeck.ai account that does not include machine ${environmentId}. Sign in with the account the machine uses: pan mcp connector logout, then login.`,
    };
  }
  if (!machine.online) return { ok: false, error: `${machine.label} is offline in the overdeck.ai directory.` };
  return { ok: true, machine };
}
