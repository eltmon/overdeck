/**
 * The host side of a Shared Sessions share's WebRTC (PRD PAN-4474 WI-6..WI-8). One `PeerHub` per
 * live share, owned by `ShareManager` (`../services/share-host.ts`).
 *
 * Content gate (NFR-4 of the parent PRD, D-12): the hub keeps its own host-admitted set, fed only by
 * the `admit`, `kick` and `revoke` frames this host process sent. A room snapshot can remove an id
 * (the viewer is no longer listed) but never add one. An eligible viewer is in that set and listed
 * as `admitted` and `connected` in the latest snapshot; only eligible viewers get a peer connection.
 *
 * Signaling (D-13, D-14, D-16): the host always offers. Each peer connection carries the five
 * labeled channels, ordered and reliable, created before the offer. ICE servers come from the share
 * service's `ice-servers` frame; `turn_unavailable` or 5 s without an answer falls back to host
 * candidates only. A peer whose viewer is no longer eligible, or whose connection fails, is closed;
 * the next snapshot that shows the viewer eligible offers a new one.
 *
 * Plain async class with injected seams (slice 2's D-8). Nothing here logs signaling data, ICE
 * credentials or content.
 */
import {
  SHARED_CHANNELS,
  type HostFrame,
  type IceServer,
  type RoomSnapshot,
  type ShareScope,
  type SharedChannel,
  type SignalData,
} from '@overdeck/contracts';
import { RTCPeerConnection } from 'werift';

import { ChannelWriter, type WritableDataChannel } from './channel-writer.js';
import {
  ConversationBridge,
  conversationLabel,
  productionBridgeDeps,
  type ConversationSink,
} from './conversation-bridge.js';

export const ICE_SERVERS_TIMEOUT_MS = 5_000;
export const ICE_SERVERS_CACHE_MS = 50 * 60_000;

/** What the hub needs from ShareManager. `sendFrame` returns false when the host socket cannot send. */
export interface PeerHubContext {
  readonly shortCode: string;
  readonly scope: ShareScope;
  sendFrame(frame: HostFrame): boolean;
}

/** The part of a werift RTCPeerConnection the hub uses; tests supply a fake. */
export interface HubPeerConnection {
  createDataChannel(label: string, options: { ordered: boolean }): HubDataChannel;
  createOffer(): Promise<{ type: string; sdp: string }>;
  setLocalDescription(description: { type: string; sdp: string }): Promise<unknown>;
  setRemoteDescription(description: { type: 'answer'; sdp: string }): Promise<unknown>;
  addIceCandidate(candidate: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }): Promise<unknown>;
  readonly localDescription?: { sdp: string } | null;
  readonly onIceCandidate: {
    subscribe(
      listener: (
        candidate: { toJSON(): { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null } } | undefined,
      ) => void,
    ): unknown;
  };
  readonly connectionStateChange: { subscribe(listener: (state: string) => void): unknown };
  close(): Promise<unknown>;
}

export interface HubDataChannel extends WritableDataChannel {
  readonly label: string;
  readonly onMessage: { subscribe(listener: (data: string | Buffer) => void): unknown };
  readonly stateChanged: { subscribe(listener: (state: string) => void): unknown };
  close(): void;
}

/** The hub surface ShareManager calls (D-12, D-15). */
export interface HostHub {
  admit(githubId: number): void;
  remove(githubId: number): void;
  onSnapshot(snapshot: RoomSnapshot): void;
  onSignal(githubId: number, data: SignalData): void;
  onIceServers(iceServers: readonly IceServer[]): void;
  onIceServersUnavailable(): void;
  close(): void;
}

export interface PeerHubDeps {
  createPeerConnection(config: {
    iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
  }): HubPeerConnection;
  bridge: { attach(sink: ConversationSink): Promise<() => void>; close(): void };
  streamLabel(): Promise<string>;
  now(): number;
}

type Candidate = NonNullable<SignalData['candidate']>;

interface PeerEntry {
  readonly githubId: number;
  /** Null while ICE servers are being fetched. */
  pc: HubPeerConnection | null;
  readonly channels: Map<SharedChannel, HubDataChannel>;
  readonly writers: Map<SharedChannel, ChannelWriter>;
  readonly open: Set<SharedChannel>;
  readonly pendingLocal: Candidate[];
  readonly pendingRemote: Candidate[];
  localSent: boolean;
  remoteSet: boolean;
  closed: boolean;
}

interface PendingIce {
  readonly promise: Promise<readonly IceServer[]>;
  readonly resolve: (servers: readonly IceServer[]) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class PeerHub implements HostHub {
  private readonly hostAdmitted = new Set<number>();
  private readonly peers = new Map<number, PeerEntry>();
  private snapshot: RoomSnapshot | null = null;
  private closed = false;
  private iceCache: { servers: readonly IceServer[]; fetchedAt: number } | null = null;
  private pendingIce: PendingIce | null = null;
  private readonly label: Promise<string>;

  constructor(
    private readonly ctx: PeerHubContext,
    private readonly deps: PeerHubDeps,
  ) {
    this.label = deps.streamLabel().catch(() => ctx.scope.conversationId);
  }

  /** Live (not closed) peer connections, for tests and diagnostics. */
  peerCount(): number {
    return this.peers.size;
  }

  admit(githubId: number): void {
    if (this.closed) return;
    this.hostAdmitted.add(githubId);
    this.reconcile();
  }

  remove(githubId: number): void {
    if (this.closed) return;
    this.hostAdmitted.delete(githubId);
    const entry = this.peers.get(githubId);
    if (entry) this.closePeer(entry);
  }

  onSnapshot(snapshot: RoomSnapshot): void {
    if (this.closed) return;
    this.snapshot = snapshot;
    const listed = new Set(snapshot.participants.map((participant) => participant.githubId));
    for (const githubId of [...this.hostAdmitted]) {
      if (!listed.has(githubId)) this.hostAdmitted.delete(githubId);
    }
    this.reconcile();
  }

  onSignal(githubId: number, data: SignalData): void {
    if (this.closed) return;
    const entry = this.peers.get(githubId);
    if (!entry || entry.closed || entry.pc === null) return;
    void this.applySignal(entry, entry.pc, data);
  }

  onIceServers(iceServers: readonly IceServer[]): void {
    if (this.closed) return;
    this.iceCache = { servers: iceServers, fetchedAt: this.deps.now() };
    if (this.pendingIce) this.resolveIce(this.pendingIce, iceServers);
  }

  onIceServersUnavailable(): void {
    if (this.closed) return;
    if (this.pendingIce) this.resolveIce(this.pendingIce, []);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of [...this.peers.values()]) this.closePeer(entry);
    this.hostAdmitted.clear();
    if (this.pendingIce) this.resolveIce(this.pendingIce, []);
    this.deps.bridge.close();
  }

  private reconcile(): void {
    const eligible = new Set<number>();
    for (const participant of this.snapshot?.participants ?? []) {
      if (this.hostAdmitted.has(participant.githubId) && participant.state === 'admitted' && participant.connected) {
        eligible.add(participant.githubId);
      }
    }
    for (const entry of [...this.peers.values()]) {
      if (!eligible.has(entry.githubId)) this.closePeer(entry);
    }
    for (const githubId of eligible) {
      if (!this.peers.has(githubId)) this.startPeer(githubId);
    }
  }

  private startPeer(githubId: number): void {
    const entry: PeerEntry = {
      githubId,
      pc: null,
      channels: new Map(),
      writers: new Map(),
      open: new Set(),
      pendingLocal: [],
      pendingRemote: [],
      localSent: false,
      remoteSet: false,
      closed: false,
    };
    this.peers.set(githubId, entry);
    void this.connect(entry);
  }

  private async connect(entry: PeerEntry): Promise<void> {
    try {
      const [iceServers] = await Promise.all([this.iceServers(), this.label]);
      if (entry.closed) return;
      const pc = this.deps.createPeerConnection({
        iceServers: iceServers.map((server) => ({
          urls: [...server.urls],
          ...(server.username !== undefined ? { username: server.username } : {}),
          ...(server.credential !== undefined ? { credential: server.credential } : {}),
        })),
      });
      entry.pc = pc;
      pc.onIceCandidate.subscribe((candidate) => this.onLocalCandidate(entry, candidate?.toJSON()));
      pc.connectionStateChange.subscribe((state) => {
        if (state === 'failed' || state === 'closed') this.closePeer(entry);
      });
      // Every channel must exist before the offer so the SDP carries the SCTP section.
      for (const label of SHARED_CHANNELS) {
        const channel = pc.createDataChannel(label, { ordered: true });
        entry.channels.set(label, channel);
        channel.stateChanged.subscribe((state) => {
          if (state === 'open') this.onChannelOpen(entry, label);
          else if (state === 'closed') this.closePeer(entry);
        });
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (entry.closed) return;
      this.sendSignal(entry, { sdp: { type: 'offer', sdp: pc.localDescription?.sdp ?? offer.sdp } });
      if (entry.closed) return;
      entry.localSent = true;
      for (const candidate of entry.pendingLocal.splice(0)) this.sendSignal(entry, { candidate });
    } catch {
      this.closePeer(entry);
    }
  }

  private onLocalCandidate(
    entry: PeerEntry,
    json: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | undefined,
  ): void {
    if (entry.closed || !json?.candidate) return;
    const candidate: Candidate = {
      candidate: json.candidate,
      sdpMid: json.sdpMid ?? null,
      sdpMLineIndex: json.sdpMLineIndex ?? null,
    };
    if (entry.localSent) this.sendSignal(entry, { candidate });
    else entry.pendingLocal.push(candidate);
  }

  private sendSignal(entry: PeerEntry, data: SignalData): void {
    if (entry.closed) return;
    if (!this.ctx.sendFrame({ type: 'signal', githubId: entry.githubId, data })) this.closePeer(entry);
  }

  private async applySignal(entry: PeerEntry, pc: HubPeerConnection, data: SignalData): Promise<void> {
    try {
      // The host always offers (D-14): an inbound offer is ignored.
      if (data.sdp?.type === 'answer' && typeof data.sdp.sdp === 'string' && !entry.remoteSet) {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp.sdp });
        entry.remoteSet = true;
        for (const candidate of entry.pendingRemote.splice(0)) await this.addRemoteCandidate(entry, pc, candidate);
      }
      if (data.candidate && typeof data.candidate.candidate === 'string') {
        await this.addRemoteCandidate(entry, pc, data.candidate);
      }
    } catch {
      this.closePeer(entry);
    }
  }

  private async addRemoteCandidate(entry: PeerEntry, pc: HubPeerConnection, candidate: Candidate): Promise<void> {
    if (entry.closed) return;
    if (!entry.remoteSet) {
      entry.pendingRemote.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? undefined,
        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
      });
    } catch {
      // A malformed or stale candidate; ICE carries on with the others.
    }
  }

  private iceServers(): Promise<readonly IceServer[]> {
    const cache = this.iceCache;
    if (cache && this.deps.now() - cache.fetchedAt < ICE_SERVERS_CACHE_MS) return Promise.resolve(cache.servers);
    if (this.pendingIce) return this.pendingIce.promise;
    let resolve: (servers: readonly IceServer[]) => void = () => undefined;
    const promise = new Promise<readonly IceServer[]>((settle) => {
      resolve = settle;
    });
    const pending: PendingIce = {
      promise,
      resolve,
      timer: setTimeout(() => this.resolveIce(pending, []), ICE_SERVERS_TIMEOUT_MS),
    };
    this.pendingIce = pending;
    if (!this.ctx.sendFrame({ type: 'ice-servers' })) this.resolveIce(pending, []);
    return promise;
  }

  private resolveIce(pending: PendingIce, servers: readonly IceServer[]): void {
    if (this.pendingIce !== pending) return;
    clearTimeout(pending.timer);
    this.pendingIce = null;
    pending.resolve(servers);
  }

  private onChannelOpen(entry: PeerEntry, label: SharedChannel): void {
    if (entry.closed) return;
    const channel = entry.channels.get(label);
    if (!channel || entry.open.has(label)) return;
    entry.open.add(label);
    entry.writers.set(label, new ChannelWriter(channel, () => this.closePeer(entry)));
  }

  private closePeer(entry: PeerEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    if (this.peers.get(entry.githubId) === entry) this.peers.delete(entry.githubId);
    for (const writer of entry.writers.values()) writer.close();
    for (const channel of entry.channels.values()) {
      try {
        channel.close();
      } catch {
        // Already closing.
      }
    }
    try {
      void entry.pc?.close().catch(() => undefined);
    } catch {
      // Already closed.
    }
  }
}

export function productionPeerHubDeps(conversationName: string): PeerHubDeps {
  return {
    createPeerConnection: (config) => new RTCPeerConnection(config) as unknown as HubPeerConnection,
    bridge: new ConversationBridge(conversationName, productionBridgeDeps()),
    streamLabel: () => conversationLabel(conversationName),
    now: () => Date.now(),
  };
}
