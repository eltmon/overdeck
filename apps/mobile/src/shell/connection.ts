/**
 * Dialing a machine and opening a secure channel to it (PAN-4837 FR-7, FR-10, D-7, D-8).
 *
 * Dial policy: direct first (8 s when the relay could take over, else the dialer's 15 s), then
 * through TURN when the directory allows the relay and this month's allowance is not used. The route
 * that worked is remembered per machine until `forgetRoutes()`. Every relayed raw channel is metered.
 * Failures become a {@link ConnectionError} whose message is the exact text the shell shows.
 */
import { ChannelOpenError, type MachineDialer, openSecureChannel, type RtcDuplexWeb, type SecureChannel, type StaticKeyPair } from '@overdeck/anywhere-channel/web';
import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import { hexToBytes } from '@noble/hashes/utils.js';

import { MIN_PAN_VERSION } from './config';
import type { RelayMeter } from './relayMeter';
import type { PairedMachine } from './types';

export const DIRECT_TIMEOUT_WITH_RELAY_MS = 8_000;

export type ConnectionErrorKind = 'directory-offline' | 'no-path' | 'removed' | 'pairing-refused' | 'identity' | 'outdated' | 'other';

export class ConnectionError extends Error {
  constructor(
    readonly kind: ConnectionErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ConnectionError';
  }
}

export const connectionText = {
  directoryOffline: () => 'Not connected to overdeck.ai.',
  noPath: (label: string) => `No direct path to ${label}. Install Tailscale on it or use the relay plan.`,
  removed: (label: string) => `This phone was removed from ${label}. Pair again.`,
  pairingRefused: (label: string) => `This pairing code expired or was already used. Create a new one on ${label}.`,
  identity: (label: string) => `${label} did not prove the identity in the pairing code. Pair again from its Settings.`,
  outdated: (label: string) => `Update Overdeck on ${label} to use the app (pan ${MIN_PAN_VERSION} or later).`,
  unreachable: (label: string) => `Could not reach ${label} directly or through the relay.`,
  channelFailed: (label: string) => `Could not open a secure channel to ${label}.`,
};

/** What the connection layer needs from the directory: its state and the relay gates. */
export interface ConnectionDirectory {
  readonly client: Pick<DirectoryWebClient, 'state' | 'relayAllowed'>;
  readonly dialer: MachineDialer;
  relayStopped(): boolean;
}

export interface ConnectionDeps {
  directory: ConnectionDirectory;
  meter: RelayMeter;
  /** Default `openSecureChannel` from `@overdeck/anywhere-channel/web`. */
  openSecureChannel?: typeof openSecureChannel;
}

export interface Connection {
  /** A raw data channel to the machine, by the D-7 policy. */
  dialRaw(environmentId: string, label: string, opts?: { signal?: AbortSignal }): Promise<RtcDuplexWeb>;
  /** A link-mode secure channel to a paired machine; resolves with the plaintext stream. */
  openLink(machine: PairedMachine, opts?: { signal?: AbortSignal }): Promise<SecureChannel['stream']>;
  /** A pairing-mode secure channel keyed by an `odp_` code, with the phone's fresh link key. */
  openPairing(environmentId: string, label: string, code: string, localKey: StaticKeyPair, opts?: { signal?: AbortSignal }): Promise<SecureChannel>;
  /** Forget the remembered routes and close every peer connection (FR-13 resume). */
  forgetRoutes(): void;
}

/** The {@link ConnectionError} for a channel that failed to open. */
export function channelError(error: unknown, label: string): ConnectionError {
  if (error instanceof ConnectionError) return error;
  if (error instanceof ChannelOpenError) {
    switch (error.code) {
      case 'unknown-peer':
        return new ConnectionError('removed', connectionText.removed(label), { cause: error });
      case 'pairing-refused':
        return new ConnectionError('pairing-refused', connectionText.pairingRefused(label), { cause: error });
      case 'identity-refused':
        return new ConnectionError('identity', connectionText.identity(label), { cause: error });
      case 'unsupported':
        return new ConnectionError('outdated', connectionText.outdated(label), { cause: error });
      default:
        break;
    }
  }
  return new ConnectionError('other', connectionText.channelFailed(label), { cause: error });
}

export function createConnection({ directory, meter, openSecureChannel: open = openSecureChannel }: ConnectionDeps): Connection {
  /** environment id → whether the route that last worked was the relay. */
  const routes = new Map<string, boolean>();

  const relayAvailable = (): boolean => directory.client.relayAllowed && !directory.relayStopped();

  async function dialRelay(environmentId: string, signal: AbortSignal | undefined): Promise<RtcDuplexWeb> {
    const raw = await directory.dialer.dialMachine(environmentId, { relay: true, ...(signal ? { signal } : {}) });
    meter.track(raw);
    routes.set(environmentId, true);
    return raw;
  }

  async function dialRaw(environmentId: string, label: string, opts: { signal?: AbortSignal } = {}): Promise<RtcDuplexWeb> {
    if (directory.client.state !== 'online') throw new ConnectionError('directory-offline', connectionText.directoryOffline());
    const signal = opts.signal;
    if (routes.get(environmentId) === true && relayAvailable()) {
      try {
        return await dialRelay(environmentId, signal);
      } catch {
        routes.delete(environmentId);
      }
    }
    const withRelay = relayAvailable();
    try {
      const raw = await directory.dialer.dialMachine(environmentId, {
        relay: false,
        ...(withRelay ? { timeoutMs: DIRECT_TIMEOUT_WITH_RELAY_MS } : {}),
        ...(signal ? { signal } : {}),
      });
      routes.set(environmentId, false);
      return raw;
    } catch (directError) {
      if (signal?.aborted) throw directError;
      if (!relayAvailable()) throw new ConnectionError('no-path', connectionText.noPath(label), { cause: directError });
    }
    try {
      return await dialRelay(environmentId, signal);
    } catch (relayError) {
      if (signal?.aborted) throw relayError;
      throw new ConnectionError('other', connectionText.unreachable(label), { cause: relayError });
    }
  }

  async function secure<T>(raw: RtcDuplexWeb, label: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      raw.destroy();
      throw channelError(error, label);
    }
  }

  return {
    dialRaw,
    async openLink(machine, opts = {}) {
      const raw = await dialRaw(machine.environmentId, machine.label, opts);
      const localKey = { publicKey: hexToBytes(machine.linkPublicKeyHex), secretKey: hexToBytes(machine.linkSecretKeyHex) };
      const { stream } = await secure(raw, machine.label, () =>
        open(raw, { mode: 'link', localKey, remoteKeyHex: machine.machineKeyHex, ...(opts.signal ? { signal: opts.signal } : {}) }, machine.label),
      );
      return stream;
    },
    async openPairing(environmentId, label, code, localKey, opts = {}) {
      const raw = await dialRaw(environmentId, label, opts);
      return secure(raw, label, () =>
        open(raw, { mode: 'pairing', localKey, pairingCode: code, ...(opts.signal ? { signal: opts.signal } : {}) }, label),
      );
    },
    forgetRoutes() {
      routes.clear();
      directory.dialer.close();
    },
  };
}
