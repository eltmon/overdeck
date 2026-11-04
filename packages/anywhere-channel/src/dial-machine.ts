/**
 * The phone's machine dialer (PAN-4833 FR-8, D-8; pan-4823 W-WEB1 step 6): a WebRTC data channel
 * to one of the account's machines, signalled through the directory socket.
 *
 * It mirrors the server's `RtcTransport.dial`: the machine closes an older peer connection when a
 * new offer arrives for the same peer (Fact 12), so the dialer keeps one `RTCPeerConnection` per
 * `(environmentId, relay)` and opens one more ordered `ovdl` data channel on it per dial. The first
 * channel exists before the offer so the SDP carries the SCTP section. A dial resolves with an
 * {@link RtcDuplexWeb} once its channel opens.
 *
 * Closing a peer connection ends every raw channel the dialer handed out on it (PAN-5046 FR-1):
 * `RTCPeerConnection.close()` fires no `close` on its data channels, so without this an open stream
 * or an in-flight handshake would hang until its own timeout.
 *
 * A connection that turns `disconnected` (a network change, a cell handover) is kept and reused. If it
 * is still `disconnected` after {@link DISCONNECT_GRACE_MS}, the dialer sends one ICE-restart offer on
 * the same session, so every open channel survives once the new path connects; if it is not
 * connected {@link ICE_RESTART_TIMEOUT_MS} after that offer, the dialer closes it and the next dial
 * sends a fresh offer (PAN-5046 FR-4).
 */
import type { IceServer, SignalData } from '@overdeck/contracts';

import type { DirectoryWebClient } from './directory-web.js';
import { RtcDuplexWeb } from './rtc-duplex-web.js';

export const RTC_DATA_CHANNEL_LABEL = 'ovdl';
export const DIAL_TIMEOUT_MS = 15_000;
/** How long a connection may stay `disconnected` before the dialer restarts ICE on it. */
export const DISCONNECT_GRACE_MS = 2_000;
/** How long an ICE restart may take, from its offer, before the dialer closes the connection. */
export const ICE_RESTART_TIMEOUT_MS = 10_000;

/** What the dialer needs from the directory socket. */
export type ClientSignaling = Pick<DirectoryWebClient, 'send' | 'on' | 'iceServers'>;

export interface MachineDialer {
  dialMachine(environmentId: string, opts: { relay: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<RtcDuplexWeb>;
  /** Close the peer connections to one machine, or all of them. */
  close(environmentId?: string): void;
  /**
   * Close the peer connection that carried `raw`, but only while it is still the current connection
   * for its machine and route, so a late failure on an older connection never closes a newer one
   * (PAN-5046 FR-3).
   */
  evict(raw: RtcDuplexWeb, reason: string): void;
  /**
   * Restart ICE on every open connection to one machine, whatever its state. Resolves once each is
   * connected again and rejects when one closes instead. A connection whose restart is already in
   * flight is not offered twice; the call waits on that restart.
   */
  restartIce(environmentId: string): Promise<void>;
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
  /** Raw channels handed out on this connection and not yet closed; each ends when the connection closes. */
  readonly duplexes: Set<RtcDuplexWeb>;
  readonly unsubscribe: Array<() => void>;
  remoteSet: boolean;
  localSent: boolean;
  closed: boolean;
  /** A data channel on this connection has opened at least once. */
  everOpen: boolean;
  /** Running from the first `disconnected` until the ICE restart starts. */
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** Running from the ICE-restart offer until the connection is back. */
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** The ICE restart in flight, if any. */
  restart: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | null;
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
  deps: { RTCPeerConnection?: typeof RTCPeerConnection; log?: (message: string) => void } = {},
): MachineDialer {
  const PeerConnection = deps.RTCPeerConnection ?? globalThis.RTCPeerConnection;
  const log = deps.log ?? ((message: string) => console.warn(`[overdeck] ${message}`));
  const byKey = new Map<string, PeerEntry>();
  /** The peer connection each handed-out raw channel runs on. */
  const owners = new WeakMap<RtcDuplexWeb, PeerEntry>();
  /** Peer connections being created, so concurrent dials to one machine share one connection. */
  const creating = new Map<string, Promise<{ entry: PeerEntry; channel: RTCDataChannel }>>();

  function closeEntry(entry: PeerEntry, error: Error): void {
    if (entry.closed) return;
    entry.closed = true;
    log(`rtc ${entry.peer.slice(0, 8)} closing session ${entry.session.slice(0, 8)}: ${error.message}`);
    clearTimers(entry);
    entry.restart?.reject(error);
    entry.restart = null;
    if (byKey.get(entry.key) === entry) byKey.delete(entry.key);
    for (const off of entry.unsubscribe.splice(0)) off();
    try {
      entry.pc.close();
    } catch {
      // Already closed.
    }
    for (const waiter of [...entry.waiters]) waiter(error);
    for (const duplex of [...entry.duplexes]) duplex.destroy(new Error(`direct connection closed: ${error.message}`));
    entry.duplexes.clear();
  }

  function clearTimers(entry: PeerEntry): void {
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    entry.graceTimer = null;
    entry.restartTimer = null;
  }

  /**
   * Start an ICE restart on `entry`, or join the one in flight. While the first offer is still
   * unanswered nothing is sent; the restart counts as done once that negotiation connects.
   */
  function restart(entry: PeerEntry): Promise<void> {
    if (entry.closed) return Promise.reject(new Error('direct connection closed'));
    if (entry.restart) return entry.restart.promise;
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    entry.graceTimer = null;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // The grace timer starts restarts nobody awaits; a failure there is already logged by closeEntry.
    promise.catch(() => {});
    entry.restart = { promise, resolve, reject };
    if (entry.pc.signalingState === 'stable') void sendRestartOffer(entry);
    return promise;
  }

  async function sendRestartOffer(entry: PeerEntry): Promise<void> {
    // Hold both sides' candidates of the new ICE generation until the new descriptions are in place:
    // ours until the offer is out, the machine's until its answer is applied.
    entry.remoteSet = false;
    entry.localSent = false;
    try {
      const offer = await entry.pc.createOffer({ iceRestart: true });
      await entry.pc.setLocalDescription(offer);
      if (entry.closed) return;
      send(entry, { sdp: { type: 'offer', sdp: entry.pc.localDescription?.sdp ?? offer.sdp ?? '' } });
    } catch (error) {
      closeEntry(entry, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    entry.localSent = true;
    for (const candidate of entry.pendingLocal.splice(0)) send(entry, { candidate });
    log(`rtc ${entry.peer.slice(0, 8)} ice restart sent`);
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      log(`rtc ${entry.peer.slice(0, 8)} ice restart timed out; closing`);
      closeEntry(entry, new Error('ice restart timed out'));
    }, ICE_RESTART_TIMEOUT_MS);
  }

  /** An ICE restart is done once its answer is applied and the connection is connected. */
  function settleRestart(entry: PeerEntry): void {
    const restarting = entry.restart;
    if (!restarting || entry.pc.signalingState !== 'stable' || entry.pc.connectionState !== 'connected') return;
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    entry.restartTimer = null;
    entry.restart = null;
    log(`rtc ${entry.peer.slice(0, 8)} ice restart recovered`);
    restarting.resolve();
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
      // The first answer and each ICE-restart answer; a repeated or stray answer is ignored.
      if (data.sdp?.type === 'answer' && entry.pc.signalingState === 'have-local-offer') {
        await entry.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp.sdp });
        entry.remoteSet = true;
        for (const candidate of entry.pendingRemote.splice(0)) await addRemoteCandidate(entry, candidate);
        settleRestart(entry);
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
      duplexes: new Set(),
      unsubscribe: [],
      remoteSet: false,
      localSent: false,
      closed: false,
      everOpen: false,
      graceTimer: null,
      restartTimer: null,
      restart: null,
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
      if (entry.closed) return;
      if (state === 'failed' || state === 'closed') {
        closeEntry(entry, new Error(`direct connection ${state}`));
      } else if (state === 'disconnected') {
        if (entry.graceTimer || entry.restart) return;
        log(`rtc ${entry.peer.slice(0, 8)} disconnected; ice restart in ${DISCONNECT_GRACE_MS} ms`);
        entry.graceTimer = setTimeout(() => {
          entry.graceTimer = null;
          if (!entry.closed && pc.connectionState === 'disconnected') void restart(entry);
        }, DISCONNECT_GRACE_MS);
      } else if (state === 'connected') {
        if (entry.graceTimer) clearTimeout(entry.graceTimer);
        entry.graceTimer = null;
        settleRestart(entry);
      }
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
        const duplex = new RtcDuplexWeb(channel, entry.peer);
        entry.duplexes.add(duplex);
        owners.set(duplex, entry);
        duplex.once('close', () => entry.duplexes.delete(duplex));
        resolve(duplex);
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
    // A `disconnected` connection is kept: ICE often recovers, and the dialer restarts it if not.
    if (entry && (entry.closed || ['failed', 'closed'].includes(entry.pc.connectionState))) {
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
    evict(raw, reason) {
      const owner = owners.get(raw);
      if (owner && !owner.closed && byKey.get(owner.key) === owner) closeEntry(owner, new Error(reason));
    },
    async restartIce(environmentId) {
      await Promise.all([...byKey.values()].filter((entry) => entry.peer === environmentId).map(restart));
    },
  };
}
