/**
 * Dialing a machine and opening a secure channel to it (PAN-4837 FR-7, FR-10, D-7, D-8).
 *
 * Dial policy: direct first (8 s when the relay could take over, else the dialer's 15 s), then
 * through TURN when the directory allows the relay and this month's allowance is not used. The route
 * that worked is remembered per machine until `forgetRoutes()`. Every relayed raw channel is metered.
 * Failures become a {@link ConnectionError} whose message is the exact text the shell shows. Each
 * failed dial and secure open is also logged with its code and route (PAN-5018 FR-1). A handshake
 * that times out or breaks protocol on an open raw channel means the peer connection under it is
 * suspect, so the phone closes its connections to that machine and forgets the route (FR-3, D-5).
 */
import { ChannelOpenError, type MachineDialer, openSecureChannel, type RtcDuplexWeb, type SecureChannel, type StaticKeyPair } from '@overdeck/anywhere-channel/web';
import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import { hexToBytes } from '@noble/hashes/utils.js';

import { DEBUG_ERRORS, MIN_PAN_VERSION } from './config';
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
  /** Diagnostic lines; never given keys, tokens or SDP. Default `console.warn` with an `[overdeck] ` prefix. */
  log?: (message: string) => void;
  /** Append ` (<code>)` to a failed secure open's text. Default {@link DEBUG_ERRORS}. */
  showErrorCodes?: boolean;
}

type Route = 'direct' | 'relay';

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

/** The {@link ConnectionError} for a channel that failed to open; `showCode` appends the `ChannelOpenError` code. */
export function channelError(error: unknown, label: string, showCode = false): ConnectionError {
  if (error instanceof ConnectionError) return error;
  const text = (message: string): string => (showCode && error instanceof ChannelOpenError ? `${message} (${error.code})` : message);
  if (error instanceof ChannelOpenError) {
    switch (error.code) {
      case 'unknown-peer':
        return new ConnectionError('removed', text(connectionText.removed(label)), { cause: error });
      case 'pairing-refused':
        return new ConnectionError('pairing-refused', text(connectionText.pairingRefused(label)), { cause: error });
      case 'identity-refused':
        return new ConnectionError('identity', text(connectionText.identity(label)), { cause: error });
      case 'unsupported':
        return new ConnectionError('outdated', text(connectionText.outdated(label)), { cause: error });
      default:
        break;
    }
  }
  return new ConnectionError('other', text(connectionText.channelFailed(label)), { cause: error });
}

/** A raw channel opened but the handshake got no valid reply: the peer connection under it is suspect (D-5). */
function suspectsPeerConnection(error: unknown): boolean {
  return error instanceof ChannelOpenError && (error.code === 'timeout' || error.code === 'protocol');
}

/** The code a log line names: the `ChannelOpenError` code, the `ConnectionError` kind, else the error name. */
function errorCode(error: unknown): string {
  if (error instanceof ChannelOpenError) return error.code;
  if (error instanceof ConnectionError) return error.kind;
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createConnection({
  directory,
  meter,
  openSecureChannel: open = openSecureChannel,
  log = (message) => console.warn(`[overdeck] ${message}`),
  showErrorCodes = DEBUG_ERRORS,
}: ConnectionDeps): Connection {
  /** environment id → whether the route that last worked was the relay. */
  const routes = new Map<string, boolean>();

  const relayAvailable = (): boolean => directory.client.relayAllowed && !directory.relayStopped();

  async function dialRelay(environmentId: string, signal: AbortSignal | undefined): Promise<RtcDuplexWeb> {
    const raw = await directory.dialer.dialMachine(environmentId, { relay: true, ...(signal ? { signal } : {}) });
    meter.track(raw);
    routes.set(environmentId, true);
    return raw;
  }

  async function dialRawWithRoute(environmentId: string, label: string, opts: { signal?: AbortSignal } = {}): Promise<{ raw: RtcDuplexWeb; route: Route }> {
    if (directory.client.state !== 'online') throw new ConnectionError('directory-offline', connectionText.directoryOffline());
    const signal = opts.signal;
    if (routes.get(environmentId) === true && relayAvailable()) {
      try {
        return { raw: await dialRelay(environmentId, signal), route: 'relay' };
      } catch (relayError) {
        log(`link ${label}: relay dial failed: ${errorMessage(relayError)}`);
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
      return { raw, route: 'direct' };
    } catch (directError) {
      if (signal?.aborted) throw directError;
      log(`link ${label}: direct dial failed: ${errorMessage(directError)}`);
      if (!relayAvailable()) throw new ConnectionError('no-path', connectionText.noPath(label), { cause: directError });
    }
    try {
      return { raw: await dialRelay(environmentId, signal), route: 'relay' };
    } catch (relayError) {
      if (signal?.aborted) throw relayError;
      log(`link ${label}: relay dial failed: ${errorMessage(relayError)}`);
      throw new ConnectionError('other', connectionText.unreachable(label), { cause: relayError });
    }
  }

  async function dialRaw(environmentId: string, label: string, opts: { signal?: AbortSignal } = {}): Promise<RtcDuplexWeb> {
    return (await dialRawWithRoute(environmentId, label, opts)).raw;
  }

  async function secure<T>(raw: RtcDuplexWeb, environmentId: string, label: string, route: Route, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      raw.destroy();
      log(`link ${label}: secure open failed over ${route} (${errorCode(error)}): ${errorMessage(error)}`);
      if (suspectsPeerConnection(error)) {
        routes.delete(environmentId);
        directory.dialer.close(environmentId);
      }
      throw channelError(error, label, showErrorCodes);
    }
  }

  return {
    dialRaw,
    async openLink(machine, opts = {}) {
      const { raw, route } = await dialRawWithRoute(machine.environmentId, machine.label, opts);
      const localKey = { publicKey: hexToBytes(machine.linkPublicKeyHex), secretKey: hexToBytes(machine.linkSecretKeyHex) };
      const { stream } = await secure(raw, machine.environmentId, machine.label, route, () =>
        open(raw, { mode: 'link', localKey, remoteKeyHex: machine.machineKeyHex, ...(opts.signal ? { signal: opts.signal } : {}) }, machine.label),
      );
      return stream;
    },
    async openPairing(environmentId, label, code, localKey, opts = {}) {
      const { raw, route } = await dialRawWithRoute(environmentId, label, opts);
      return secure(raw, environmentId, label, route, () =>
        open(raw, { mode: 'pairing', localKey, pairingCode: code, ...(opts.signal ? { signal: opts.signal } : {}) }, label),
      );
    },
    forgetRoutes() {
      routes.clear();
      directory.dialer.close();
    },
  };
}
