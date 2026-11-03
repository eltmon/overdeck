/**
 * The viewer browser's WebRTC peer for a Shared Session (PRD PAN-4475 WI-8).
 *
 * The host always offers; this side answers. Signals reach it from the viewer server's event
 * stream (`onSignal`) and leave through `deps.sendSignal` (`POST /api/joins/:code/signal`). The
 * peer reads three of the five channels: `control` (the hello handshake), `conversation` (history,
 * append, update) and `presence` (the roster header). `drafts` and `terminal` get no listener in
 * this slice. Every message is read with `SharedChannelReader`, and one `SeqTracker` per peer
 * reports a missed update once.
 *
 * A new offer closes the old peer first (D-11). A peer that fails or closes on its own reports
 * phase `lost`; `close()` stops every callback.
 */
import {
  encodeSharedMessage,
  negotiateHello,
  SeqTracker,
  SHARED_SCOPE_KINDS,
  SHARED_WIRE_VERSION,
  SharedChannelReader,
  type ConversationPayload,
  type IceServer,
  type PresenceParticipant,
  type PresencePayload,
  type SharedEnvelope,
  type SharedHello,
  type SharedMessage,
  type SignalData,
} from '@overdeck/contracts';

export type ViewerPeerPhase = 'waiting' | 'connecting' | 'connected' | 'lost';
export type ViewerNotice =
  | { kind: 'host_newer' } | { kind: 'scope_unsupported' } | { kind: 'hello_failed'; code: string }
  | { kind: 'transcript_unavailable' } | { kind: 'history_too_large' } | { kind: 'updates_missed' };

export interface WebRtcViewerDeps {
  RTCPeerConnection?: typeof RTCPeerConnection;
  sendSignal(data: SignalData): Promise<void>;
  fetchIceServers(): Promise<readonly IceServer[]>;
  now?(): number;
}

export interface WebRtcViewerCallbacks {
  /** The full list after every change. */
  onMessages(messages: readonly SharedMessage[]): void;
  onPresence(presence: PresencePayload): void;
  onPhase(phase: ViewerPeerPhase): void;
  onNotice(notice: ViewerNotice): void;
}

type Candidate = NonNullable<SignalData['candidate']>;

const ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'system']);

/** One answered offer: its peer connection, channels and decoding state. */
interface Negotiation {
  pc: RTCPeerConnection | null;
  readonly channels: RTCDataChannel[];
  readonly remoteCandidates: Candidate[];
  readonly localCandidates: Candidate[];
  remoteSet: boolean;
  answerSent: boolean;
  readonly seq: SeqTracker;
  gapReported: boolean;
  helloDone: boolean;
  streamId: string | null;
  readonly messages: Map<string, SharedMessage>;
  closedByViewer: boolean;
}

/** A shared message rebuilt field by field from known keys; `author` and unknown keys never copy. */
export function readSharedMessage(value: unknown): SharedMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.text !== 'string' || typeof raw.createdAt !== 'string') return null;
  if (typeof raw.role !== 'string' || !ROLES.has(raw.role)) return null;
  const message: {
    id: string;
    role: SharedMessage['role'];
    text: string;
    createdAt: string;
    turnId?: string;
    completedAt?: string;
    streaming?: boolean;
    sequence?: number;
  } = { id: raw.id, role: raw.role as SharedMessage['role'], text: raw.text, createdAt: raw.createdAt };
  if (typeof raw.turnId === 'string') message.turnId = raw.turnId;
  if (typeof raw.completedAt === 'string') message.completedAt = raw.completedAt;
  if (typeof raw.streaming === 'boolean') message.streaming = raw.streaming;
  if (typeof raw.sequence === 'number' && Number.isFinite(raw.sequence)) message.sequence = raw.sequence;
  return message;
}

function readParticipant(value: unknown): PresenceParticipant | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.githubId !== 'number' || !Number.isSafeInteger(raw.githubId)) return null;
  if (typeof raw.login !== 'string' || typeof raw.avatarUrl !== 'string') return null;
  if (raw.state !== 'lobby' && raw.state !== 'admitted') return null;
  if (typeof raw.contributor !== 'boolean' || typeof raw.isHost !== 'boolean') return null;
  return { githubId: raw.githubId, login: raw.login, avatarUrl: raw.avatarUrl, state: raw.state, contributor: raw.contributor, isHost: raw.isHost };
}

function readStream(value: unknown): PresencePayload['streams'][number] | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.streamId !== 'string' || typeof raw.label !== 'string' || raw.kind !== 'conversation') return null;
  return { streamId: raw.streamId, label: raw.label, kind: 'conversation' };
}

/** A presence payload rebuilt field by field; malformed participants and streams are dropped. */
export function readPresence(value: unknown): PresencePayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.participants) || typeof raw.controllerGithubId !== 'number' || !Array.isArray(raw.streams)) return null;
  return {
    controllerGithubId: raw.controllerGithubId,
    participants: raw.participants.flatMap((p) => readParticipant(p) ?? []),
    streams: raw.streams.flatMap((s) => readStream(s) ?? []),
  };
}

export class WebRtcViewer {
  private current: Negotiation | null = null;
  private closed = false;
  private chunkId = 0;

  constructor(
    private readonly deps: WebRtcViewerDeps,
    private readonly callbacks: WebRtcViewerCallbacks,
  ) {}

  onSignal(data: SignalData): void {
    if (this.closed) return;
    if (data.sdp?.type === 'offer') void this.answer(data.sdp.sdp);
    if (data.candidate) this.addRemoteCandidate(data.candidate);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.current) this.shut(this.current);
    this.current = null;
  }

  private async answer(sdp: string): Promise<void> {
    if (this.current) this.shut(this.current);
    const negotiation: Negotiation = {
      pc: null,
      channels: [],
      remoteCandidates: [],
      localCandidates: [],
      remoteSet: false,
      answerSent: false,
      seq: new SeqTracker(),
      gapReported: false,
      helloDone: false,
      streamId: null,
      messages: new Map(),
      closedByViewer: false,
    };
    this.current = negotiation;
    this.emitPhase(negotiation, 'connecting');
    const servers = await this.deps.fetchIceServers().catch((): readonly IceServer[] => []);
    if (!this.isCurrent(negotiation)) return;
    try {
      const PC = this.deps.RTCPeerConnection ?? globalThis.RTCPeerConnection;
      const pc = new PC({
        iceServers: servers.map((s) => ({
          urls: [...s.urls],
          ...(s.username !== undefined ? { username: s.username } : {}),
          ...(s.credential !== undefined ? { credential: s.credential } : {}),
        })),
      });
      negotiation.pc = pc;
      pc.addEventListener('icecandidate', (event) => {
        const c = event.candidate;
        if (!c?.candidate || !this.isCurrent(negotiation)) return;
        const local: Candidate = { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null };
        if (negotiation.answerSent) void this.deps.sendSignal({ candidate: local }).catch(() => undefined);
        else negotiation.localCandidates.push(local);
      });
      pc.addEventListener('datachannel', (event) => this.wireChannel(negotiation, event.channel));
      pc.addEventListener('connectionstatechange', () => {
        if (!this.isCurrent(negotiation) || negotiation.closedByViewer) return;
        if (pc.connectionState === 'connected') this.emitPhase(negotiation, 'connected');
        else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.emitPhase(negotiation, 'lost');
      });
      await pc.setRemoteDescription({ type: 'offer', sdp });
      if (!this.isCurrent(negotiation)) return;
      negotiation.remoteSet = true;
      for (const candidate of negotiation.remoteCandidates.splice(0)) await this.applyCandidate(pc, candidate);
      const answer = await pc.createAnswer();
      if (!this.isCurrent(negotiation)) return;
      await pc.setLocalDescription(answer);
      if (!this.isCurrent(negotiation)) return;
      await this.deps.sendSignal({ sdp: { type: 'answer', sdp: answer.sdp ?? '' } });
      if (!this.isCurrent(negotiation)) return;
      negotiation.answerSent = true;
      for (const candidate of negotiation.localCandidates.splice(0)) {
        void this.deps.sendSignal({ candidate }).catch(() => undefined);
      }
    } catch {
      if (this.isCurrent(negotiation)) this.emitPhase(negotiation, 'lost');
    }
  }

  private addRemoteCandidate(candidate: Candidate): void {
    const negotiation = this.current;
    if (!negotiation) return;
    if (negotiation.remoteSet && negotiation.pc) void this.applyCandidate(negotiation.pc, candidate);
    else negotiation.remoteCandidates.push(candidate);
  }

  private async applyCandidate(pc: RTCPeerConnection, candidate: Candidate): Promise<void> {
    try {
      await pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      });
    } catch {
      // A bad candidate does not end the negotiation.
    }
  }

  private wireChannel(negotiation: Negotiation, channel: RTCDataChannel): void {
    negotiation.channels.push(channel);
    const label = channel.label;
    // `drafts` and `terminal` belong to later slices: no listener.
    if (label !== 'control' && label !== 'conversation' && label !== 'presence') return;
    const reader = new SharedChannelReader();
    channel.addEventListener('message', (event: MessageEvent) => {
      if (!this.isCurrent(negotiation) || typeof event.data !== 'string') return;
      const result = reader.read(event.data);
      if (result.kind !== 'envelope') return;
      const envelope = result.envelope;
      const observed = negotiation.seq.observe(envelope.ch, envelope.streamId, envelope.seq);
      if (!observed.ok && !negotiation.gapReported) {
        negotiation.gapReported = true;
        this.callbacks.onNotice({ kind: 'updates_missed' });
      }
      if (label === 'control') this.onControl(negotiation, channel, envelope);
      else if (label === 'conversation') this.onConversation(negotiation, envelope);
      else this.onPresenceEnvelope(envelope);
    });
  }

  private onControl(negotiation: Negotiation, channel: RTCDataChannel, envelope: SharedEnvelope): void {
    const payload = envelope.payload as { kind?: unknown; hello?: unknown; code?: unknown } | null;
    if (typeof payload !== 'object' || payload === null) return;
    if (payload.kind === 'error') {
      this.callbacks.onNotice({ kind: 'hello_failed', code: typeof payload.code === 'string' ? payload.code : 'error' });
      return;
    }
    if (payload.kind !== 'hello' || negotiation.helloDone) return;
    negotiation.helloDone = true;
    const hello = payload.hello as Partial<SharedHello> | null;
    const scope = typeof hello === 'object' && hello !== null ? hello.scope : undefined;
    if (typeof scope !== 'object' || scope === null) {
      this.callbacks.onNotice({ kind: 'hello_failed', code: 'invalid_hello' });
      return;
    }
    // A scope kind this Overdeck does not know (for example `task`) has no `conversationId`, so
    // `negotiateHello` would call it malformed; report it as unsupported first.
    if (!(SHARED_SCOPE_KINDS as readonly string[]).includes(scope.kind)) {
      this.callbacks.onNotice({ kind: 'scope_unsupported' });
      return;
    }
    const local: SharedHello = { v: SHARED_WIRE_VERSION, scopeKinds: SHARED_SCOPE_KINDS, scope };
    const result = negotiateHello(local, hello);
    if (!result.ok) {
      this.callbacks.onNotice(result.code === 'scope_kind_unsupported' ? { kind: 'scope_unsupported' } : { kind: 'hello_failed', code: result.code });
      return;
    }
    if ((hello as SharedHello).v > SHARED_WIRE_VERSION) this.callbacks.onNotice({ kind: 'host_newer' });
    const reply: SharedEnvelope = {
      v: SHARED_WIRE_VERSION,
      ch: 'control',
      streamId: envelope.streamId,
      seq: 1,
      t: this.deps.now?.() ?? Date.now(),
      payload: { kind: 'hello', hello: local },
    };
    try {
      for (const part of encodeSharedMessage(reply, ++this.chunkId)) channel.send(part);
      negotiation.streamId = envelope.streamId;
    } catch {
      this.emitPhase(negotiation, 'lost');
    }
  }

  private onConversation(negotiation: Negotiation, envelope: SharedEnvelope): void {
    if (negotiation.streamId === null || envelope.streamId !== negotiation.streamId) return;
    const payload = envelope.payload as ConversationPayload | null;
    if (typeof payload !== 'object' || payload === null) return;
    const { messages } = negotiation;
    if (payload.kind === 'history') {
      if (!Array.isArray(payload.messages)) return;
      messages.clear();
      for (const value of payload.messages) {
        const message = readSharedMessage(value);
        if (message) messages.set(message.id, message);
      }
    } else if (payload.kind === 'append' || payload.kind === 'update') {
      const message = readSharedMessage(payload.message);
      if (!message) return;
      messages.set(message.id, message);
    } else if (payload.kind === 'unavailable') {
      this.callbacks.onNotice(payload.reason === 'history_too_large' ? { kind: 'history_too_large' } : { kind: 'transcript_unavailable' });
      return;
    } else {
      return;
    }
    this.callbacks.onMessages([...messages.values()]);
  }

  private onPresenceEnvelope(envelope: SharedEnvelope): void {
    const presence = readPresence(envelope.payload);
    if (presence) this.callbacks.onPresence(presence);
  }

  private isCurrent(negotiation: Negotiation): boolean {
    return !this.closed && this.current === negotiation;
  }

  private emitPhase(negotiation: Negotiation, phase: ViewerPeerPhase): void {
    if (this.isCurrent(negotiation)) this.callbacks.onPhase(phase);
  }

  private shut(negotiation: Negotiation): void {
    negotiation.closedByViewer = true;
    for (const channel of negotiation.channels) {
      try {
        channel.close();
      } catch {
        // Already closed.
      }
    }
    try {
      negotiation.pc?.close();
    } catch {
      // Already closed.
    }
  }
}
