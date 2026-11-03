/**
 * WebRTC transport for the `direct` and `relay` routes (PRD PAN-2356 WI-10, D-2356-11).
 *
 * One werift `RTCPeerConnection` per (peer environment id, relay, purpose). Each `dial` opens a new
 * ordered, reliable data channel labelled `ovdl` on it, because `LinkAgent` pools several channels
 * per machine. The offer, the answer and ICE candidates travel through a `RtcSignalingPort`, which
 * the dashboard builds over the directory socket (WI-11). The responder creates its peer connection
 * on an incoming offer and hands every data channel the initiator opens to `onIncoming`.
 *
 * Only ciphertext crosses a data channel: the secure channel runs on top of it.
 * `relay: true` forces TURN on the initiator (`iceTransportPolicy: 'relay'`), and both ends pass the relay
 * route's list through `relayIceServers` (TLS TURN first, no STUN).
 */
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { SignalData } from '@overdeck/contracts';
import { RTCPeerConnection, type RTCDataChannel } from 'werift';

import { relayIceServers, type RTCIceServerLike } from './relay-ice-servers.js';
import { RtcDuplex } from './rtc-duplex.js';

export type { RTCIceServerLike } from './relay-ice-servers.js';

export const RTC_DATA_CHANNEL_LABEL = 'ovdl';

export type RtcPurpose = 'link' | 'approval';

export interface RtcSignalingPort {
  send(to: string, session: string, purpose: RtcPurpose, relay: boolean, data: SignalData): void;
  onSignal(handler: (from: string, session: string, purpose: RtcPurpose, relay: boolean, data: SignalData) => void): () => void;
  iceServers(relay: boolean): Promise<RTCIceServerLike[]>;
}

export type IncomingRtcChannel = (raw: Duplex, purpose: RtcPurpose, from: string, relay: boolean) => void;

export class RtcDialAbortedError extends Error {
  constructor() {
    super('direct connection aborted');
    this.name = 'AbortError';
  }
}

interface PeerEntry {
  readonly key: string;
  readonly peer: string;
  readonly session: string;
  readonly purpose: RtcPurpose;
  readonly relay: boolean;
  readonly pc: RTCPeerConnection;
  /** Candidates that arrived before the remote description. */
  readonly pendingRemote: SignalData['candidate'][];
  /** Our own candidates gathered before the offer or answer went out. */
  readonly pendingLocal: SignalData['candidate'][];
  remoteSet: boolean;
  localSent: boolean;
  closed: boolean;
  /** A data channel on this connection has opened at least once. */
  everOpen: boolean;
}

function entryKey(peer: string, relay: boolean, purpose: RtcPurpose): string {
  return `${peer}|${relay ? 'relay' : 'direct'}|${purpose}`;
}

export class RtcTransport {
  private readonly byKey = new Map<string, PeerEntry>();
  private readonly bySession = new Map<string, PeerEntry>();
  /** Peer connections being created, so concurrent dials to one peer share one connection. */
  private readonly creating = new Map<string, Promise<{ entry: PeerEntry; channel: RTCDataChannel }>>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly port: RtcSignalingPort,
    private readonly onIncoming: IncomingRtcChannel,
  ) {
    this.unsubscribe = port.onSignal((from, session, purpose, relay, data) => {
      void this.onSignal(from, session, purpose, relay, data);
    });
  }

  /** Live peer connections, for tests and diagnostics. */
  peerConnectionCount(): number {
    return [...this.byKey.values()].filter((e) => !e.closed).length;
  }

  async dial(peerEnvironmentId: string, opts: { relay: boolean; purpose: RtcPurpose; signal: AbortSignal }): Promise<Duplex> {
    if (opts.signal.aborted) throw new RtcDialAbortedError();
    const key = entryKey(peerEnvironmentId, opts.relay, opts.purpose);
    let entry = this.byKey.get(key);
    if (entry && (entry.closed || ['failed', 'closed', 'disconnected'].includes(entry.pc.connectionState))) {
      this.closeEntry(entry);
      entry = undefined;
    }
    if (!entry) {
      const pending = this.creating.get(key);
      if (pending) {
        entry = (await pending).entry;
      } else {
        const created = this.create(key, peerEnvironmentId, opts.relay, opts.purpose);
        this.creating.set(key, created);
        let first: { entry: PeerEntry; channel: RTCDataChannel };
        try {
          first = await created;
        } finally {
          this.creating.delete(key);
        }
        return this.awaitOpen(first.entry, first.channel, opts.signal, true);
      }
    }
    if (opts.signal.aborted) throw new RtcDialAbortedError();
    return this.awaitOpen(entry, entry.pc.createDataChannel(RTC_DATA_CHANNEL_LABEL, { ordered: true }), opts.signal, false);
  }

  /** The relay route's list is reordered for werift's one-TURN-URL rule (PAN-4862). */
  private async peerIceServers(relay: boolean): Promise<RTCIceServerLike[]> {
    const servers = await this.port.iceServers(relay);
    return relay ? relayIceServers(servers) : servers;
  }

  /** Initiator: a new peer connection, its first data channel and the offer. */
  private async create(key: string, peer: string, relay: boolean, purpose: RtcPurpose): Promise<{ entry: PeerEntry; channel: RTCDataChannel }> {
    const iceServers = await this.peerIceServers(relay);
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: relay ? 'relay' : 'all' });
    const entry = this.register(pc, key, peer, randomBytes(16).toString('hex'), purpose, relay);
    // The first channel must exist before the offer so the SDP carries the SCTP section.
    const channel = pc.createDataChannel(RTC_DATA_CHANNEL_LABEL, { ordered: true });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch (error) {
      this.closeEntry(entry);
      throw error;
    }
    this.sendLocalDescription(entry, 'offer');
    return { entry, channel };
  }

  /** Fails the connection behind one signalling session (the directory said the peer is offline). */
  abortSession(session: string): void {
    const entry = this.bySession.get(session);
    if (entry) this.closeEntry(entry);
  }

  /** Closes the peer connections to one machine, or all of them. */
  close(peerEnvironmentId?: string): void {
    for (const entry of [...this.byKey.values()]) {
      if (peerEnvironmentId === undefined || entry.peer === peerEnvironmentId) this.closeEntry(entry);
    }
    if (peerEnvironmentId === undefined) this.unsubscribe();
  }

  private register(pc: RTCPeerConnection, key: string, peer: string, session: string, purpose: RtcPurpose, relay: boolean): PeerEntry {
    const entry: PeerEntry = {
      key,
      peer,
      session,
      purpose,
      relay,
      pc,
      pendingRemote: [],
      pendingLocal: [],
      remoteSet: false,
      localSent: false,
      closed: false,
      everOpen: false,
    };
    this.byKey.set(key, entry);
    this.bySession.set(session, entry);
    pc.onIceCandidate.subscribe((candidate) => {
      if (!candidate || entry.closed) return;
      const json = candidate.toJSON();
      const out: NonNullable<SignalData['candidate']> = {
        candidate: json.candidate,
        sdpMid: json.sdpMid ?? null,
        sdpMLineIndex: json.sdpMLineIndex ?? null,
      };
      if (entry.localSent) this.port.send(peer, session, purpose, relay, { candidate: out });
      else entry.pendingLocal.push(out);
    });
    pc.connectionStateChange.subscribe((state) => {
      if (state === 'failed' || state === 'closed') this.closeEntry(entry);
    });
    // Either side may open data channels on a connected peer connection (dial reuses whichever
    // connection exists for the peer), so both the initiator and the responder accept them.
    pc.onDataChannel.subscribe((channel) => {
      const deliver = () => {
        entry.everOpen = true;
        this.onIncoming(new RtcDuplex(channel, peer), purpose, peer, relay);
      };
      if (channel.readyState === 'open') deliver();
      else {
        const { unSubscribe } = channel.stateChanged.subscribe((state) => {
          if (state !== 'open') return;
          unSubscribe();
          deliver();
        });
      }
    });
    return entry;
  }

  private sendLocalDescription(entry: PeerEntry, type: 'offer' | 'answer'): void {
    const description = entry.pc.localDescription;
    if (!description) return;
    this.port.send(entry.peer, entry.session, entry.purpose, entry.relay, { sdp: { type, sdp: description.sdp } });
    entry.localSent = true;
    for (const candidate of entry.pendingLocal.splice(0)) {
      this.port.send(entry.peer, entry.session, entry.purpose, entry.relay, { candidate });
    }
  }

  private async addRemoteCandidate(entry: PeerEntry, candidate: SignalData['candidate']): Promise<void> {
    if (!candidate) return;
    if (!entry.remoteSet) {
      entry.pendingRemote.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? undefined,
        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
      });
    } catch {
      // A malformed or stale candidate; ICE carries on with the others.
    }
  }

  private async setRemote(entry: PeerEntry, type: 'offer' | 'answer', sdp: string): Promise<void> {
    await entry.pc.setRemoteDescription({ type, sdp });
    entry.remoteSet = true;
    for (const candidate of entry.pendingRemote.splice(0)) await this.addRemoteCandidate(entry, candidate);
  }

  private async onSignal(from: string, session: string, purpose: RtcPurpose, relay: boolean, data: SignalData): Promise<void> {
    try {
      const known = this.bySession.get(session);
      if (known) {
        // A session belongs to one peer; the directory stamps `from`, so a mismatch is a stale id.
        if (known.peer !== from || known.closed) return;
        if (data.sdp?.type === 'answer' && !known.remoteSet) await this.setRemote(known, 'answer', data.sdp.sdp);
        if (data.candidate) await this.addRemoteCandidate(known, data.candidate);
        return;
      }
      if (data.sdp?.type !== 'offer') return;
      await this.accept(from, session, purpose, relay, data.sdp.sdp, data.candidate);
    } catch {
      const entry = this.bySession.get(session);
      if (entry) this.closeEntry(entry);
    }
  }

  /** Responder: a new peer connection for an incoming offer. */
  private async accept(from: string, session: string, purpose: RtcPurpose, relay: boolean, sdp: string, candidate: SignalData['candidate']): Promise<void> {
    const key = entryKey(from, relay, purpose);
    const previous = this.byKey.get(key);
    if (previous) this.closeEntry(previous);
    const iceServers = await this.peerIceServers(relay);
    const pc = new RTCPeerConnection({ iceServers });
    const entry = this.register(pc, key, from, session, purpose, relay);
    await this.setRemote(entry, 'offer', sdp);
    if (candidate) await this.addRemoteCandidate(entry, candidate);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendLocalDescription(entry, 'answer');
  }

  /** `ownsEntry`: this dial created the connection, so a failure before any channel opened closes it. */
  private awaitOpen(entry: PeerEntry, channel: RTCDataChannel, signal: AbortSignal, ownsEntry: boolean): Promise<Duplex> {
    return new Promise<Duplex>((resolve, reject) => {
      let settled = false;
      const subscriptions: Array<{ unSubscribe: () => void }> = [];
      const finish = (error: Error | null): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        for (const s of subscriptions) s.unSubscribe();
        if (error) {
          try {
            channel.close();
          } catch {
            // Never opened.
          }
          if (ownsEntry && !entry.everOpen) this.closeEntry(entry);
          reject(error);
          return;
        }
        entry.everOpen = true;
        resolve(new RtcDuplex(channel, entry.peer));
      };
      const onAbort = (): void => finish(new RtcDialAbortedError());
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      subscriptions.push(
        channel.stateChanged.subscribe((state) => {
          if (state === 'open') finish(null);
          else if (state === 'closed') finish(new Error('data channel closed before it opened'));
        }),
        entry.pc.connectionStateChange.subscribe((state) => {
          if (state === 'failed' || state === 'closed') finish(new Error(`direct connection ${state}`));
        }),
      );
      if (channel.readyState === 'open') finish(null);
    });
  }

  private closeEntry(entry: PeerEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    if (this.byKey.get(entry.key) === entry) this.byKey.delete(entry.key);
    this.bySession.delete(entry.session);
    void entry.pc.close().catch(() => undefined);
  }
}
