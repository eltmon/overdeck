/**
 * `direct` and `relay` routes over the overdeck.ai directory (PRD PAN-2356 WI-11).
 *
 * Builds an `RtcTransport` whose signalling port is the directory socket: `signal` frames carry the
 * offer, answer and ICE candidates, and `ice-servers` frames fetch STUN servers (direct) or TURN
 * credentials (relay). It registers the dialer that `openChannel('rtc://<id>')` uses and routes
 * every incoming `link` data channel into the channel listener's handshake, so a WebRTC path is one
 * more transport under the same secure channel. Incoming `approval` data channels take the same
 * path: the listener runs the approval handshake only for this machine's own live request id
 * (`takeApproval`, WI-14).
 */
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { DirectoryMachine, DirectoryToMachineFrame, MachineToDirectoryFrame } from '@overdeck/contracts';

import { ChannelOpenError, type RtcDialer, setRtcDialer } from '../../../lib/anywhere/channel/open.js';
import { type RTCIceServerLike, type RtcSignalingPort, RtcTransport } from '../../../lib/anywhere/channel/rtc-transport.js';
import { acceptRawChannel } from '../channel-listener.js';
import type { MeteredTransport } from './relay-client.js';

export const ICE_SERVERS_TIMEOUT_MS = 10_000;

/** The part of the directory client this module uses; tests supply an in-memory directory. */
export interface DirectoryPort {
  send(frame: MachineToDirectoryFrame): boolean;
  on<T extends DirectoryToMachineFrame['type']>(type: T, handler: (frame: Extract<DirectoryToMachineFrame, { type: T }>) => void): () => void;
  isOnline(): boolean;
  machine(environmentId: string): DirectoryMachine | null;
}

/** Asks the directory for ICE servers and waits for the matching answer or refusal. */
function requestIceServers(directory: DirectoryPort, relay: boolean): Promise<RTCIceServerLike[]> {
  const requestId = randomBytes(8).toString('hex');
  return new Promise<RTCIceServerLike[]>((resolve, reject) => {
    const offs: Array<() => void> = [];
    const timer = setTimeout(() => done(new Error('the directory did not answer the ICE server request')), ICE_SERVERS_TIMEOUT_MS);
    function done(result: RTCIceServerLike[] | Error): void {
      clearTimeout(timer);
      for (const off of offs) off();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
    offs.push(
      directory.on('ice-servers', (frame) => {
        if (frame.requestId === requestId) done(frame.iceServers.map((server) => ({ ...server, urls: [...server.urls] })));
      }),
      directory.on('error', (frame) => {
        if (frame.requestId === requestId) done(new Error(frame.message));
      }),
    );
    if (!directory.send({ type: 'ice-servers', requestId, relay })) done(new Error('not connected to the overdeck.ai directory'));
  });
}

export function directorySignalingPort(directory: DirectoryPort): RtcSignalingPort {
  return {
    send(to, session, purpose, relay, data) {
      directory.send({ type: 'signal', to, session, purpose, relay, data });
    },
    onSignal(handler) {
      return directory.on('signal', (frame) => handler(frame.from, frame.session, frame.purpose, frame.relay, frame.data));
    },
    iceServers: (relay) => requestIceServers(directory, relay),
  };
}

/** The relay client's hooks (WI-17): refuse relay dials it does not allow, meter the ones it does. */
export interface RelayHooks {
  refusal(): string | null;
  track(raw: MeteredTransport): void;
}

export interface DirectoryRtc {
  readonly transport: RtcTransport;
  readonly dialer: RtcDialer;
  stop(): void;
}

/** The transport and its dialer for one directory connection. */
export function createDirectoryRtc(
  directory: DirectoryPort,
  acceptLink: (raw: Duplex) => void = (raw) => void acceptRawChannel(raw),
  relay: RelayHooks | null = null,
): DirectoryRtc {
  // Link and approval channels both run the listener's handshake; the preamble picks the mode.
  const transport = new RtcTransport(directorySignalingPort(directory), (raw) => acceptLink(raw));
  // A `peer_offline` answer fails the pending dial at once instead of at the open timeout.
  const offError = directory.on('error', (frame) => {
    if (frame.code === 'peer_offline' && frame.session) transport.abortSession(frame.session);
  });
  const dialer: RtcDialer = (url, signal) => {
    const relayRoute = url.startsWith('rtc+turn://');
    const environmentId = url.slice(relayRoute ? 'rtc+turn://'.length : 'rtc://'.length);
    if (!directory.isOnline()) {
      return Promise.reject(new ChannelOpenError('unreachable', 'Not connected to the overdeck.ai directory'));
    }
    if (directory.machine(environmentId)?.online !== true) {
      return Promise.reject(new ChannelOpenError('unreachable', 'The other machine is not online in the directory'));
    }
    if (!relayRoute) return transport.dial(environmentId, { relay: false, purpose: 'link', signal });
    const refused = relay ? relay.refusal() : 'The relay needs the relay plan';
    if (refused) return Promise.reject(new ChannelOpenError('unreachable', refused));
    return transport.dial(environmentId, { relay: true, purpose: 'link', signal }).then((raw) => {
      relay?.track(raw as MeteredTransport);
      return raw;
    });
  };
  return {
    transport,
    dialer,
    stop() {
      offError();
      transport.close();
    },
  };
}

let running: DirectoryRtc | null = null;

/** Boot: register the dialer for `rtc://` routes and accept incoming data channels. */
export function startDirectoryRtc(directory: DirectoryPort, relay: RelayHooks | null = null): DirectoryRtc {
  stopDirectoryRtc();
  running = createDirectoryRtc(directory, (raw) => void acceptRawChannel(raw), relay);
  setRtcDialer(running.dialer);
  return running;
}

export function stopDirectoryRtc(): void {
  running?.stop();
  running = null;
  setRtcDialer(null);
}

export function currentDirectoryRtc(): DirectoryRtc | null {
  return running;
}
