/**
 * The host side of a Shared Sessions share's WebRTC (PRD PAN-4474 WI-6..WI-8). One `PeerHub` per
 * live share, owned by `ShareManager` (`../services/share-host.ts`).
 *
 * Content gate (NFR-4 of the parent PRD, D-12): the hub keeps its own host-admitted set, fed only by
 * the `admit`, `kick` and `revoke` frames this host process sent. A room snapshot can remove an id
 * (the viewer is no longer listed) but never add one. An eligible viewer is in that set and listed
 * as `admitted` and `connected` in the latest snapshot; only eligible viewers get a peer connection.
 * One exception (PAN-4479 D-4): after a dashboard restart, `ShareManager.resume()` seeds the set once
 * from the first snapshot's admitted participants.
 *
 * Signaling (D-13, D-14, D-16): the host always offers. Each peer connection carries the five
 * labeled channels, ordered and reliable, created before the offer. ICE servers come from the share
 * service's `ice-servers` frame; `turn_unavailable` or 5 s without an answer falls back to host
 * candidates only. A peer whose viewer is no longer eligible, or whose connection fails, is closed;
 * the next snapshot that shows the viewer eligible offers a new one.
 *
 * Content (FR-7, FR-8, D-4..D-6): each side's first `control` envelope is a hello. The host sends
 * its hello when `control` opens and sends no content until the viewer's hello negotiates; a failed
 * negotiation answers with a `control` error and nothing else. A negotiated peer's `conversation`
 * channel carries the bridge's `history`, then `append` and `update`. The hub reads inbound messages
 * on `control` and `drafts` only, reassembled with the 64 Ki inbound cap; `terminal` carries nothing.
 *
 * Drafts (PRD PAN-4476 FR-1, FR-2, D-5): a negotiated viewer's `drafts` envelope `{ text }` updates
 * that viewer's draft in the DraftBoard, with the author fields taken from the peer and the snapshot,
 * never from the payload. The board's throttled relays go to every other peer whose `drafts` channel
 * and hello are both ready; such a peer first gets the current drafts (minus its own). A viewer who
 * leaves the snapshot's admitted set loses their draft.
 *
 * Prompts (FR-5..FR-10, D-1, D-10): a `control` `submit` from a negotiated, eligible viewer whose
 * snapshot entry is `contributor` goes into the share's SubmitQueue; anyone else is answered
 * `rejected not_contributor`. Controller sends from ShareManager use the same queue. Each contributor
 * submit is acknowledged `queued`, then `sent` or `rejected`; a snapshot that removes the grant drops
 * the author's queued items as `grant_revoked`. Right before a delivery the bridge is told whom to
 * credit, and presence carries the queue's `agentWorking` and `queued`.
 *
 * Presence (FR-9, D-17, D-18): a negotiated peer's `presence` channel carries the roster (data owner
 * first), the controller and the stream when it opens, and again after every snapshot that changes
 * them. The block list and `connected` never cross the wire.
 *
 * Plain async class with injected seams (slice 2's D-8). Nothing here logs signaling data, ICE
 * credentials or content.
 */
import {
  SHARED_CHANNELS,
  SHARED_SCOPE_KINDS,
  SHARED_WIRE_VERSION,
  SHARE_MAX_INBOUND_ENVELOPE_CHARS,
  SharedChannelReader,
  negotiateHello,
  type ControlPayload,
  type ConversationPayload,
  type DraftPayload,
  type SendSharePromptRequest,
  type HostFrame,
  type IceServer,
  type PresencePayload,
  type RoomSnapshot,
  type ShareDraftView,
  type ShareIdentity,
  type ShareQueueView,
  type ShareScope,
  type SharedSubmitReason,
  type SharedChannel,
  type SharedHello,
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
import { DraftBoard } from './draft-board.js';
import { productionSubmitQueueDeps, SubmitQueue, type QueuedPrompt, type SubmitQueueDeps } from './submit-queue.js';

export const ICE_SERVERS_TIMEOUT_MS = 5_000;
export const ICE_SERVERS_CACHE_MS = 50 * 60_000;
/** A contributor submit's client id (D-12). */
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ControllerSendResult =
  | { ok: true; position: number }
  | { ok: false; reason: 'invalid_prompt' | 'too_long' | 'queue_full' };

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
  /** The viewers' current drafts, oldest started first (PAN-4476). */
  draftsView(): ShareDraftView[];
  queueView(): ShareQueueView;
  /** Queues a controller send; `draftGithubId` credits and clears that viewer's draft (D-1). */
  sendFromController(input: SendSharePromptRequest, controller: ShareIdentity | null): ControllerSendResult;
  close(): void;
}

export interface PeerHubDeps {
  createPeerConnection(config: {
    iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
  }): HubPeerConnection;
  bridge: {
    attach(sink: ConversationSink): Promise<() => void>;
    expectAuthor(text: string, author: { login: string; avatarUrl: string }): () => void;
    close(): void;
  };
  queue: SubmitQueueDeps;
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
  readonly seq: Map<SharedChannel, number>;
  readonly pendingLocal: Candidate[];
  readonly pendingRemote: Candidate[];
  /** Reassembles inbound `control` messages (inbound cap, NFR-3). */
  readonly reader: SharedChannelReader;
  /** Reassembles inbound `drafts` messages (inbound cap, NFR-3). */
  readonly draftReader: SharedChannelReader;
  /** The current drafts were sent; later relays follow. */
  draftsSynced: boolean;
  /** Client ids this peer has queued; a repeat is ignored while the item waits (D-12). */
  readonly pendingAcks: Set<string>;
  localSent: boolean;
  remoteSet: boolean;
  helloState: 'waiting' | 'negotiated' | 'failed';
  detachConversation: (() => void) | null;
  conversationAttached: boolean;
  /** The presence JSON last sent to this peer; an unchanged roster is not sent again. */
  presenceSent: string | null;
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
  /** The resolved label; every peer awaits it before its channels exist. */
  private labelValue: string | null = null;
  private readonly hostHello: SharedHello;
  private readonly drafts: DraftBoard;
  private readonly queue: SubmitQueue;
  private queueStatus = { agentWorking: false, queued: 0 };

  constructor(
    private readonly ctx: PeerHubContext,
    private readonly deps: PeerHubDeps,
  ) {
    this.label = deps.streamLabel().catch(() => ctx.scope.conversationId);
    this.hostHello = { v: SHARED_WIRE_VERSION, scopeKinds: SHARED_SCOPE_KINDS, scope: ctx.scope };
    this.drafts = new DraftBoard({ now: () => deps.now(), onRelay: (payload) => this.relayDraft(payload) });
    this.queue = new SubmitQueue(deps.queue, {
      onDelivering: (item) =>
        item.author ? deps.bridge.expectAuthor(item.text, { login: item.author.login, avatarUrl: item.author.avatarUrl }) : () => undefined,
      onOutcome: (item, outcome) => this.onOutcome(item, outcome),
      onStatus: (status) => {
        this.queueStatus = status;
        for (const entry of [...this.peers.values()]) this.maybeSendPresence(entry);
      },
    });
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
    const previous = this.snapshot;
    this.snapshot = snapshot;
    const listed = new Set(snapshot.participants.map((participant) => participant.githubId));
    for (const githubId of [...this.hostAdmitted]) {
      if (!listed.has(githubId)) this.hostAdmitted.delete(githubId);
    }
    this.reconcile();
    const admitted = new Set(snapshot.participants.filter((p) => p.state === 'admitted').map((p) => p.githubId));
    for (const draft of this.drafts.list()) {
      if (!admitted.has(draft.githubId)) this.drafts.remove(draft.githubId);
    }
    this.dropRevoked(previous, snapshot);
    for (const entry of [...this.peers.values()]) this.maybeSendPresence(entry);
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

  draftsView(): ShareDraftView[] {
    return this.drafts.list();
  }

  queueView(): ShareQueueView {
    return this.queue.view();
  }

  sendFromController(input: SendSharePromptRequest, controller: ShareIdentity | null): ControllerSendResult {
    const draft = input.draftGithubId === undefined ? undefined : this.drafts.list().find((d) => d.githubId === input.draftGithubId);
    const author = draft ? { githubId: draft.githubId, login: draft.login, avatarUrl: draft.avatarUrl } : controller;
    const result = this.queue.enqueue({ clientId: null, source: 'controller', author, text: input.text });
    if (!result.ok) return result;
    // The draft is cleared only once its send is queued, so a refused send keeps it.
    if (draft) {
      this.drafts.take(draft.githubId);
      const entry = this.peers.get(draft.githubId);
      if (entry) this.sendEnvelope(entry, 'control', { kind: 'draft-sent' });
    }
    return { ok: true, position: result.position };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of [...this.peers.values()]) this.closePeer(entry);
    this.drafts.close();
    this.queue.close();
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
      seq: new Map(),
      pendingLocal: [],
      pendingRemote: [],
      reader: new SharedChannelReader(SHARE_MAX_INBOUND_ENVELOPE_CHARS),
      draftReader: new SharedChannelReader(SHARE_MAX_INBOUND_ENVELOPE_CHARS),
      draftsSynced: false,
      pendingAcks: new Set(),
      localSent: false,
      remoteSet: false,
      helloState: 'waiting',
      detachConversation: null,
      conversationAttached: false,
      presenceSent: null,
      closed: false,
    };
    this.peers.set(githubId, entry);
    void this.connect(entry);
  }

  private async connect(entry: PeerEntry): Promise<void> {
    try {
      const [iceServers, label] = await Promise.all([this.iceServers(), this.label]);
      this.labelValue ??= label;
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
        // Inbound messages are read on `control` and `drafts` only; `terminal` stays unread.
        if (label === 'control') channel.onMessage.subscribe((data) => this.onControlMessage(entry, data));
        else if (label === 'drafts') channel.onMessage.subscribe((data) => this.onDraftMessage(entry, data));
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
    if (label === 'control') this.sendEnvelope(entry, 'control', { kind: 'hello', hello: this.hostHello });
    else if (label === 'conversation') this.maybeAttachConversation(entry);
    else if (label === 'presence') this.maybeSendPresence(entry);
    else if (label === 'drafts') this.maybeSyncDrafts(entry);
  }

  private onControlMessage(entry: PeerEntry, data: string | Buffer): void {
    if (entry.closed || typeof data !== 'string') return;
    const result = entry.reader.read(data);
    if (result.kind !== 'envelope' || result.envelope.ch !== 'control') return;
    const payload = result.envelope.payload as { kind?: unknown; hello?: unknown; clientId?: unknown; text?: unknown } | null;
    if (typeof payload !== 'object' || payload === null) return;
    if (payload.kind === 'submit') {
      if (entry.helloState === 'negotiated') this.onSubmit(entry, payload.clientId, payload.text);
      return;
    }
    if (payload.kind !== 'hello' || entry.helloState !== 'waiting') return;
    const negotiated = negotiateHello(this.hostHello, payload.hello);
    if (negotiated.ok) {
      entry.helloState = 'negotiated';
      this.queue.setWatching(true);
      this.maybeAttachConversation(entry);
      this.maybeSendPresence(entry);
      this.maybeSyncDrafts(entry);
    } else {
      entry.helloState = 'failed';
      this.sendEnvelope(entry, 'control', { kind: 'error', code: negotiated.code });
    }
  }

  private onSubmit(entry: PeerEntry, clientId: unknown, text: unknown): void {
    if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId) || typeof text !== 'string') return;
    if (entry.pendingAcks.has(clientId)) return;
    const participant = this.snapshot?.participants.find((p) => p.githubId === entry.githubId);
    const eligible = participant !== undefined && this.hostAdmitted.has(participant.githubId)
      && participant.state === 'admitted' && participant.connected;
    if (!eligible || !participant.contributor) {
      this.sendAck(entry, { kind: 'submit-ack', clientId, status: 'rejected', reason: 'not_contributor' });
      return;
    }
    const author = { githubId: participant.githubId, login: participant.login, avatarUrl: participant.avatarUrl };
    const result = this.queue.enqueue({ clientId, source: 'contributor', author, text });
    if (result.ok) {
      entry.pendingAcks.add(clientId);
      this.sendAck(entry, { kind: 'submit-ack', clientId, status: 'queued', position: result.position });
    } else {
      this.sendAck(entry, { kind: 'submit-ack', clientId, status: 'rejected', reason: result.reason });
    }
  }

  private onOutcome(item: QueuedPrompt, outcome: 'sent' | SharedSubmitReason): void {
    if (item.source !== 'contributor' || !item.author || item.clientId === null) return;
    const entry = this.peers.get(item.author.githubId);
    if (!entry) return;
    entry.pendingAcks.delete(item.clientId);
    this.sendAck(
      entry,
      outcome === 'sent'
        ? { kind: 'submit-ack', clientId: item.clientId, status: 'sent' }
        : { kind: 'submit-ack', clientId: item.clientId, status: 'rejected', reason: outcome },
    );
  }

  /** Drops the queued items of every author who is no longer an admitted contributor (FR-7). */
  private dropRevoked(previous: RoomSnapshot | null, snapshot: RoomSnapshot): void {
    const allowed = new Set(snapshot.participants.filter((p) => p.state === 'admitted' && p.contributor).map((p) => p.githubId));
    const ids = new Set([...(previous?.participants ?? []), ...snapshot.participants].map((p) => p.githubId));
    for (const githubId of ids) {
      if (allowed.has(githubId)) continue;
      for (const item of this.queue.dropAuthor(githubId)) this.onOutcome(item, 'grant_revoked');
    }
  }

  private sendAck(entry: PeerEntry, ack: Extract<ControlPayload, { kind: 'submit-ack' }>): void {
    if (!entry.closed) this.sendEnvelope(entry, 'control', ack);
  }

  private onDraftMessage(entry: PeerEntry, data: string | Buffer): void {
    if (entry.closed || entry.helloState !== 'negotiated' || typeof data !== 'string') return;
    const result = entry.draftReader.read(data);
    if (result.kind !== 'envelope' || result.envelope.ch !== 'drafts') return;
    const payload = result.envelope.payload as { text?: unknown } | null;
    if (typeof payload !== 'object' || payload === null || typeof payload.text !== 'string') return;
    const participant = this.snapshot?.participants.find((p) => p.githubId === entry.githubId);
    if (!participant) return;
    this.drafts.update({ githubId: entry.githubId, login: participant.login, avatarUrl: participant.avatarUrl }, payload.text);
  }

  /** Sends the current drafts (minus the peer's own) once its `drafts` channel and hello are both ready. */
  private maybeSyncDrafts(entry: PeerEntry): void {
    if (entry.closed || entry.draftsSynced || entry.helloState !== 'negotiated' || !entry.open.has('drafts')) return;
    entry.draftsSynced = true;
    for (const payload of this.drafts.payloads()) {
      if (payload.authorGithubId !== entry.githubId) this.sendEnvelope(entry, 'drafts', payload);
    }
  }

  private relayDraft(payload: DraftPayload): void {
    for (const entry of [...this.peers.values()]) {
      if (entry.draftsSynced && entry.githubId !== payload.authorGithubId) this.sendEnvelope(entry, 'drafts', payload);
    }
  }

  private maybeAttachConversation(entry: PeerEntry): void {
    if (entry.closed || entry.helloState !== 'negotiated' || !entry.open.has('conversation') || entry.conversationAttached) {
      return;
    }
    entry.conversationAttached = true;
    void this.deps.bridge.attach({ send: (payload) => this.sendConversation(entry, payload) }).then((detach) => {
      if (entry.closed) detach();
      else entry.detachConversation = detach;
    });
  }

  private maybeSendPresence(entry: PeerEntry): void {
    if (entry.closed || entry.helloState !== 'negotiated' || !entry.open.has('presence')) return;
    if (this.snapshot === null || this.labelValue === null) return;
    const presence = presenceOf(this.snapshot, this.ctx.scope, this.labelValue, this.queueStatus);
    const json = JSON.stringify(presence);
    if (json === entry.presenceSent) return;
    entry.presenceSent = json;
    this.sendEnvelope(entry, 'presence', presence);
  }

  private sendConversation(entry: PeerEntry, payload: ConversationPayload): void {
    try {
      this.sendEnvelope(entry, 'conversation', payload);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      this.sendEnvelope(entry, 'conversation', { kind: 'unavailable', reason: 'history_too_large' });
    }
  }

  private sendEnvelope(
    entry: PeerEntry,
    ch: SharedChannel,
    payload: ControlPayload | ConversationPayload | PresencePayload | DraftPayload,
  ): void {
    if (entry.closed) return;
    const writer = entry.writers.get(ch);
    if (!writer) return;
    const seq = (entry.seq.get(ch) ?? 0) + 1;
    // A RangeError (envelope too large) sends nothing, so it must not consume the seq.
    writer.send({ v: SHARED_WIRE_VERSION, ch, streamId: this.ctx.scope.conversationId, seq, t: this.deps.now(), payload });
    entry.seq.set(ch, seq);
  }

  private closePeer(entry: PeerEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    if (this.peers.get(entry.githubId) === entry) this.peers.delete(entry.githubId);
    if (![...this.peers.values()].some((peer) => peer.helloState === 'negotiated')) this.queue.setWatching(false);
    entry.detachConversation?.();
    entry.detachConversation = null;
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

/** The roster a viewer sees: the data owner first, then every snapshot participant; built field by field. */
export function presenceOf(
  snapshot: RoomSnapshot,
  scope: ShareScope,
  label: string,
  status: { agentWorking: boolean; queued: number } = { agentWorking: false, queued: 0 },
): PresencePayload {
  const owner = snapshot.dataOwner;
  return {
    controllerGithubId: snapshot.controllerGithubId,
    participants: [
      {
        githubId: owner.githubId,
        login: owner.login,
        avatarUrl: owner.avatarUrl,
        state: 'admitted',
        contributor: false,
        isHost: true,
      },
      ...snapshot.participants.map((participant) => ({
        githubId: participant.githubId,
        login: participant.login,
        avatarUrl: participant.avatarUrl,
        state: participant.state,
        contributor: participant.contributor,
        isHost: false,
      })),
    ],
    streams: [
      { streamId: scope.conversationId, label, kind: 'conversation', agentWorking: status.agentWorking, queued: status.queued },
    ],
  };
}

export function productionPeerHubDeps(conversationName: string): PeerHubDeps {
  return {
    createPeerConnection: (config) => new RTCPeerConnection(config) as unknown as HubPeerConnection,
    bridge: new ConversationBridge(conversationName, productionBridgeDeps()),
    queue: productionSubmitQueueDeps(conversationName),
    streamLabel: () => conversationLabel(conversationName),
    now: () => Date.now(),
  };
}
