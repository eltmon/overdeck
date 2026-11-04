/// <reference path="./types/secret-stream.d.ts" />
/**
 * The phone's secure channel (PAN-4833 FR-5, D-7): the shared initiator
 * sequence over any raw duplex with the web crypto port, finished by building
 * a `@hyperswarm/secret-stream` in the same tick as the last handshake frame.
 * Link and pairing only; the phone never runs approvals.
 */
import SecretStream from '@hyperswarm/secret-stream';
import type { Duplex } from 'streamx';

import { webCrypto } from './crypto-web.js';
import { type ChannelMarker, runInitiatorHandshake, withDeadline } from './initiator.js';
import type { StaticKeyPair } from './noise.js';
import type { RawDuplex } from './wire.js';

export type WebChannelOptions =
  | { mode: 'link'; localKey: StaticKeyPair; remoteKeyHex: string; signal?: AbortSignal; timeoutMs?: number }
  | { mode: 'pairing'; localKey: StaticKeyPair; pairingCode: string; signal?: AbortSignal; timeoutMs?: number };

export interface SecureChannel {
  /** The plaintext side of the secret stream. */
  stream: Duplex;
  channel: ChannelMarker;
}

/** Open a `link` or `pairing` secure channel as the initiator; default timeout 10 s. */
export function openSecureChannel(raw: RawDuplex, opts: WebChannelOptions, label = 'machine'): Promise<SecureChannel> {
  return withDeadline<SecureChannel, RawDuplex>(label, opts, (_signal, track) => {
    track(raw);
    return runInitiatorHandshake(raw, label, opts, webCrypto, track, ({ raw, handshake, leftover, channel }) => ({
      stream: new SecretStream(true, raw, {
        handshake: {
          tx: handshake.tx,
          rx: handshake.rx,
          hash: handshake.hash,
          publicKey: handshake.localPublicKey,
          remotePublicKey: handshake.remotePublicKey,
        },
        ...(leftover.length > 0 ? { data: leftover } : {}),
      }),
      channel,
    }));
  });
}
