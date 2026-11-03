/**
 * The phone's machine dialer (PAN-4833 FR-8, D-8; pan-4823 W-WEB1 step 6): a WebRTC data channel
 * to one of the account's machines, signalled through the directory socket.
 *
 * It mirrors the server's `RtcTransport.dial`: the machine closes an older peer connection when a
 * new offer arrives for the same peer (Fact 12), so the dialer keeps one `RTCPeerConnection` per
 * `(environmentId, relay)` and opens one more ordered `ovdl` data channel on it per dial. The first
 * channel exists before the offer so the SDP carries the SCTP section. A dial resolves with an
 * {@link RtcDuplexWeb} once its channel opens.
 */
import type { IceServer, SignalData } from '@overdeck/contracts';

import type { DirectoryWebClient } from './directory-web.js';
import { RtcDuplexWeb } from './rtc-duplex-web.js';

export const RTC_DATA_CHANNEL_LABEL = 'ovdl';
export const DIAL_TIMEOUT_MS = 15_000;

/** What the dialer needs from the directory socket. */
export type ClientSignaling = Pick<DirectoryWebClient, 'send' | 'on' | 'iceServers'>;

export interface MachineDialer {
  dialMachine(environmentId: string, opts: { relay: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<RtcDuplexWeb>;
  /** Close the peer connections to one machine, or all of them. */
  close(environmentId?: string): void;
}

type Candidate = NonNullable<SignalData['candidate']>;

interface PeerEntry {
  readonly key: string;
  readonly peer: string;
  readonly session: string;
  readonly relay: boolean;
  readonly pc: RTCPeerConnection;
  /** Remote candidates that arrived before the answer. */
  readonly pendingRemote: Candidate[];
  /** Our own candidates gathered before the offer went out. */
  readonly pendingLocal: Candidate[];
  /** Pending dials on this connection; each is told when the connection dies. */
  readonly waiters: Set<(error: Error) => void>;
  readonly unsubscribe: Array<() => void>;
  remoteSet: boolean;
  localSent: boolean;
  closed: boolean;
  /** A data channel on this connection has opened at least once. */
  everOpen: boolean;
}

function entryKey(environmentId: string, relay: boolean): string {
  return `${environmentId}|${relay ? 'relay' : 'direct'}`;
}

function randomSessionId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function abortError(): Error {
  const error = new Error('Dial aborted');
  error.name = 'AbortError';
  return error;
}

function toRtcIceServers(servers: readonly IceServer[]): RTCIceServer[] {
  return servers.map((server) => ({
    urls: [...server.urls],
    ...(server.username !== undefined ? { username: server.username } : {}),
    ...(server.credential !== undefined ? { credential: server.credential } : {}),
  }));
}

export function createMachineDialer(
  directory: ClientSignaling,
  deps: { RTCPeerConnection?: typeof RTCPeerConnection } = {},
): MachineDialer {
  const PeerConnection = deps.RTCPeerConnection ?? globalThis.RTCPeerConnection;
  const byKey = new Map<string, PeerEntry>();
  /** Peer connections being created, so concurrent dials to one machine share one connection. */
  const creating = new Map<string, Promise<{ entry: PeerEntry; channel: RTCDataChannel }>>();

  function closeEntry(entry: PeerEntry, error: Error): void {
    if (entry.closed) return;
    entry.closed = true;
    if (byKey.get(entry.key) === entry) byKey.delete(entry.key);
    for (const off of entry.unsubscribe.splice(0)) off();
    try {
      entry.pc.close();
    } catch {
      // Already closed.
    }
    for (const waiter of [...entry.waiters]) waiter(error);
  }

  function send(entry: PeerEntry, data: SignalData): void {
    directory.send({ type: 'signal', to: entry.peer, session: entry.session, purpose: 'link', relay: entry.relay, data });
  }

  async function addRemoteCandidate(entry: PeerEntry, candidate: Candidate): Promise<void> {
    if (!entry.remoteSet) {
      entry.pendingRemote.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      });
    } catch {
      // A malformed or stale candidate; ICE carries on with the others.
    }
  }

  async function onSignal(entry: PeerEntry, data: SignalData): Promise<void> {
    try {
      if (data.sdp?.type === 'answer' && !entry.remoteSet) {
        await entry.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp.sdp });
        entry.remoteSet = true;
        for (const candidate of entry.pendingRemote.splice(0)) await addRemoteCandidate(entry, candidate);
      }
      if (data.candidate) await addRemoteCandidate(entry, data.candidate);
    } catch (error) {
      closeEntry(entry, error instanceof Error ? error : new Error(String(error)));
    }
  }

  function register(pc: RTCPeerConnection, key: string, peer: string, relay: boolean): PeerEntry {
    const entry: PeerEntry = {
      key,
      peer,
      session: randomSessionId(),
      relay,
      pc,
      pendingRemote: [],
      pendingLocal: [],
      waiters: new Set(),
      unsubscribe: [],
      remoteSet: false,
      localSent: false,
      closed: false,
      everOpen: false,
    };
    byKey.set(key, entry);
    entry.unsubscribe.push(
      directory.on('signal', (frame) => {
        if (frame.session !== entry.session || frame.from !== entry.peer || entry.closed) return;
        void onSignal(entry, frame.data);
      }),
      // `peer_offline` and any other failure of this signalling session.
      directory.on('error', (frame) => {
        if (frame.session === entry.session) closeEntry(entry, new Error(frame.message));
      }),
    );
    pc.addEventListener('icecandidate', (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate || entry.closed) return;
      const out: Candidate = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? null,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
      };
      if (entry.localSent) send(entry, { candidate: out });
      else entry.pendingLocal.push(out);
    });
    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'closed') closeEntry(entry, new Error(`direct connection ${state}`));
    });
    // The machine never opens a channel toward the phone.
    pc.addEventListener('datachannel', (event: RTCDataChannelEvent) => event.channel.close());
    return entry;
  }

  /** A new peer connection, its first data channel and the offer. */
  async function create(key: string, peer: string, relay: boolean): Promise<{ entry: PeerEntry; channel: RTCDataChannel }> {
    const iceServers = toRtcIceServers(await directory.iceServers(relay));
    const pc = new PeerConnection({ iceServers, iceTransportPolicy: relay ? 'relay' : 'all' });
    const entry = register(pc, key, peer, relay);
    // The first channel must exist before the offer so the SDP carries the SCTP section.
    const channel = pc.createDataChannel(RTC_DATA_CHANNEL_LABEL, { ordered: true });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send(entry, { sdp: { type: 'offer', sdp: pc.localDescription?.sdp ?? offer.sdp ?? '' } });
    } catch (error) {
      closeEntry(entry, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    entry.localSent = true;
    for (const candidate of entry.pendingLocal.splice(0)) send(entry, { candidate });
    return { entry, channel };
  }

  /** `ownsEntry`: this dial created the connection, so a failure before any channel opened closes it. */
  function awaitOpen(entry: PeerEntry, channel: RTCDataChannel, signal: AbortSignal, ownsEntry: boolean): Promise<RtcDuplexWeb> {
    return new Promise<RtcDuplexWeb>((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        channel.removeEventListener('open', onOpen);
        channel.removeEventListener('close', onClose);
        entry.waiters.delete(onEntryClosed);
        if (error) {
          try {
            channel.close();
          } catch {
            // Never opened.
          }
          if (ownsEntry && !entry.everOpen) closeEntry(entry, error);
          reject(error);
          return;
        }
        entry.everOpen = true;
        resolve(new RtcDuplexWeb(channel, entry.peer));
      };
      const onOpen = (): void => finish(null);
      const onClose = (): void => finish(new Error('data channel closed before it opened'));
      const onAbort = (): void => finish(signal.reason instanceof Error ? signal.reason : abortError());
      const onEntryClosed = (error: Error): void => finish(error);
      entry.waiters.add(onEntryClosed);
      channel.addEventListener('open', onOpen);
      channel.addEventListener('close', onClose);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      else if (entry.closed) finish(new Error('direct connection closed'));
      else if (channel.readyState === 'open') finish(null);
    });
  }

  async function dial(environmentId: string, relay: boolean, signal: AbortSignal): Promise<RtcDuplexWeb> {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
    const key = entryKey(environmentId, relay);
    let entry = byKey.get(key);
    if (entry && (entry.closed || ['failed', 'closed', 'disconnected'].includes(entry.pc.connectionState))) {
      closeEntry(entry, new Error(`direct connection ${entry.pc.connectionState}`));
      entry = undefined;
    }
    if (!entry) {
      const pending = creating.get(key);
      if (pending) {
        entry = (await pending).entry;
      } else {
        const created = create(key, environmentId, relay);
        creating.set(key, created);
        let first: { entry: PeerEntry; channel: RTCDataChannel };
        try {
          first = await created;
        } finally {
          creating.delete(key);
        }
        return awaitOpen(first.entry, first.channel, signal, true);
      }
    }
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
    return awaitOpen(entry, entry.pc.createDataChannel(RTC_DATA_CHANNEL_LABEL, { ordered: true }), signal, false);
  }

  return {
    async dialMachine(environmentId, opts) {
      const timeoutMs = opts.timeoutMs ?? DIAL_TIMEOUT_MS;
      const controller = new AbortController();
      const onAbort = (): void => controller.abort(abortError());
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error(`No direct connection to ${environmentId} within ${timeoutMs} ms`)),
        timeoutMs,
      );
      try {
        return await dial(environmentId, opts.relay, controller.signal);
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    },
    close(environmentId) {
      for (const entry of [...byKey.values()]) {
        if (environmentId === undefined || entry.peer === environmentId) closeEntry(entry, new Error('dialer closed'));
      }
    },
  };
}
