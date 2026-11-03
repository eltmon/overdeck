/**
 * The viewer browser's WebRTC peer for a Shared Session (PRD PAN-4475 WI-8).
 *
 * The host always offers; this side answers. Signals reach it from the viewer server's event
 * stream (`onSignal`) and leave through `deps.sendSignal` (`POST /api/joins/:code/signal`). The
 * peer reads all five channels: `control` (the hello handshake, submit acks, draft-sent),
 * `conversation` (history, append, update), `presence` (the roster header and queue status),
 * `drafts` (the other participants' drafts, PAN-4476) and `terminal` (the host's read-only terminal,
 * PAN-4477). Every message is read with `SharedChannelReader`, and one `SeqTracker` per peer reports
 * a missed update once.
 *
 * Outbound (PAN-4476): after the hello reply (`control` seq 1), `sendDraft` writes the viewer's whole
 * draft on `drafts` and `submit` writes a contributor prompt on `control`, each with that channel's
 * next seq. A message keeps `author` only when it has a string login and an https avatar URL.
 *
 * Terminal (PAN-4477): `setTerminalWatch` sends a `terminal-watch` control payload once the hello
 * reply is out, and again after the hello of every new peer while the watch is on. The viewer
 * never sends on `terminal`.
 *
 * Control (PAN-4478): the host's `identity` (this viewer's own id) and `command-ack` come in on
 * `control`; a viewer-controller's `command` and `controller-send` go out on it.
 *
 * A new offer closes the old peer first (D-11). A peer that fails or closes on its own reports
 * phase `lost`; `close()` stops every callback.
 */
import {
  encodeSharedMessage,
  negotiateHello,
  readDraftPayload,
  SeqTracker,
  SHARED_SCOPE_KINDS,
  SHARED_WIRE_VERSION,
  SharedChannelReader,
  type ConversationPayload,
  type DraftPayload,
  type IceServer,
  type PresenceParticipant,
  type PresencePayload,
  type SharedChannel,
  type SharedCommandRefusal,
  type SharedControllerCommand,
  type SharedEnvelope,
  type SharedHello,
  type SharedMessage,
  type SharedSubmitReason,
  type SignalData,
  type TerminalPayload,
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

/** A host `submit-ack`, rebuilt from known keys. */
export interface SubmitAck {
  readonly clientId: string;
  readonly status: 'queued' | 'sent' | 'rejected';
  readonly position?: number;
  readonly reason?: SharedSubmitReason;
}

/** A host `command-ack`, rebuilt from known keys (PAN-4478). */
export interface CommandAck {
  readonly clientId: string;
  readonly status: 'accepted' | 'rejected';
  readonly position?: number;
  readonly reason?: SharedCommandRefusal;
}

export interface WebRtcViewerCallbacks {
  /** The full list after every change. */
  onMessages(messages: readonly SharedMessage[]): void;
  onPresence(presence: PresencePayload): void;
  onPhase(phase: ViewerPeerPhase): void;
  onNotice(notice: ViewerNotice): void;
  /** Another participant's whole draft; an empty text deletes it. */
  onDraft?(draft: DraftPayload): void;
  onSubmitAck?(ack: SubmitAck): void;
  /** The host sent this viewer's draft as a prompt. */
  onDraftSent?(): void;
  /** Once per negotiation, right after the hello reply: `sendDraft` and `submit` now work. */
  onReady?(): void;
  onTerminal(payload: TerminalPayload): void;
  /** The host told this viewer its own GitHub id (PAN-4478). */
  onIdentity?(githubId: number): void;
  onCommandAck?(ack: CommandAck): void;
}

type Candidate = NonNullable<SignalData['candidate']>;

const ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'system']);
const ACK_STATUSES: ReadonlySet<string> = new Set(['queued', 'sent', 'rejected']);
const SUBMIT_REASONS: ReadonlySet<string> = new Set([
  'not_contributor', 'invalid_prompt', 'too_long', 'queue_full', 'grant_revoked', 'delivery_refused', 'delivery_unknown',
]);
const COMMAND_ACK_STATUSES: ReadonlySet<string> = new Set(['accepted', 'rejected']);
const COMMAND_REFUSALS: ReadonlySet<string> = new Set([
  'not_controller', 'unknown_participant', 'invalid_target', 'invalid_command', 'not_connected',
  'invalid_prompt', 'too_long', 'queue_full',
]);

/** One answered offer: its peer connection, channels and decoding state. */
interface Negotiation {
  pc: RTCPeerConnection | null;
  readonly channels: RTCDataChannel[];
  readonly channelsByLabel: Map<string, RTCDataChannel>;
  /** The next outbound seq per channel; the hello reply is `control` seq 1. */
  readonly outSeq: Map<SharedChannel, number>;
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

/** A shared message rebuilt field by field from known keys; unknown keys never copy, `author` only when well formed. */
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
    author?: { login: string; avatarUrl: string };
  } = { id: raw.id, role: raw.role as SharedMessage['role'], text: raw.text, createdAt: raw.createdAt };
  if (typeof raw.turnId === 'string') message.turnId = raw.turnId;
  if (typeof raw.completedAt === 'string') message.completedAt = raw.completedAt;
  if (typeof raw.streaming === 'boolean') message.streaming = raw.streaming;
  if (typeof raw.sequence === 'number' && Number.isFinite(raw.sequence)) message.sequence = raw.sequence;
  const author = raw.author as Record<string, unknown> | null | undefined;
  if (typeof author === 'object' && author !== null && typeof author.login === 'string'
    && typeof author.avatarUrl === 'string' && author.avatarUrl.startsWith('https://')) {
    message.author = { login: author.login, avatarUrl: author.avatarUrl };
  }
  return message;
}

function readSubmitAck(raw: Record<string, unknown>): SubmitAck | null {
  if (typeof raw.clientId !== 'string' || typeof raw.status !== 'string' || !ACK_STATUSES.has(raw.status)) return null;
  const ack: { clientId: string; status: SubmitAck['status']; position?: number; reason?: SharedSubmitReason } = {
    clientId: raw.clientId,
    status: raw.status as SubmitAck['status'],
  };
  if (typeof raw.position === 'number' && Number.isSafeInteger(raw.position) && raw.position > 0) ack.position = raw.position;
  if (typeof raw.reason === 'string' && SUBMIT_REASONS.has(raw.reason)) ack.reason = raw.reason as SharedSubmitReason;
  return ack;
}

function readCommandAck(raw: Record<string, unknown>): CommandAck | null {
  if (typeof raw.clientId !== 'string' || typeof raw.status !== 'string' || !COMMAND_ACK_STATUSES.has(raw.status)) return null;
  const ack: { clientId: string; status: CommandAck['status']; position?: number; reason?: SharedCommandRefusal } = {
    clientId: raw.clientId,
    status: raw.status as CommandAck['status'],
  };
  if (typeof raw.position === 'number' && Number.isSafeInteger(raw.position) && raw.position > 0) ack.position = raw.position;
  if (typeof raw.reason === 'string' && COMMAND_REFUSALS.has(raw.reason)) ack.reason = raw.reason as SharedCommandRefusal;
  return ack;
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
  const stream: { streamId: string; label: string; kind: 'conversation'; agentWorking?: boolean; queued?: number } = {
    streamId: raw.streamId,
    label: raw.label,
    kind: 'conversation',
  };
  if (typeof raw.agentWorking === 'boolean') stream.agentWorking = raw.agentWorking;
  if (typeof raw.queued === 'number' && Number.isSafeInteger(raw.queued) && raw.queued >= 0) stream.queued = raw.queued;
  return stream;
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

function readDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value : null;
}

/** A terminal payload rebuilt field by field; anything malformed is null and dropped. */
export function readTerminalPayload(value: unknown): TerminalPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  switch (raw.kind) {
    case 'snapshot': {
      const cols = readDimension(raw.cols);
      const rows = readDimension(raw.rows);
      if (cols === null || rows === null || typeof raw.data !== 'string') return null;
      return { kind: 'snapshot', cols, rows, data: raw.data };
    }
    case 'output':
      return typeof raw.data === 'string' ? { kind: 'output', data: raw.data } : null;
    case 'size': {
      const cols = readDimension(raw.cols);
      const rows = readDimension(raw.rows);
      return cols === null || rows === null ? null : { kind: 'size', cols, rows };
    }
    case 'unavailable':
      return raw.reason === 'terminal_not_found' || raw.reason === 'terminal_ended'
        ? { kind: 'unavailable', reason: raw.reason }
        : null;
    default:
      return null;
  }
}

export class WebRtcViewer {
  private current: Negotiation | null = null;
  private closed = false;
  private chunkId = 0;
  private terminalWatch = false;

  constructor(
    private readonly deps: WebRtcViewerDeps,
    private readonly callbacks: WebRtcViewerCallbacks,
  ) {}

  onSignal(data: SignalData): void {
    if (this.closed) return;
    if (data.sdp?.type === 'offer') void this.answer(data.sdp.sdp);
    if (data.candidate) this.addRemoteCandidate(data.candidate);
  }

  /** Sends the viewer's whole draft on `drafts`; false before the hello reply or when the channel is not open. */
  sendDraft(text: string): boolean {
    return this.sendOn('drafts', { text });
  }

  /** Sends a contributor prompt on `control`; false before the hello reply or when the channel is not open. */
  submit(clientId: string, text: string): boolean {
    return this.sendOn('control', { kind: 'submit', clientId, text });
  }

  /** Turns the host terminal stream on or off; a new peer re-sends `true` after its hello (FR-7). */
  setTerminalWatch(watch: boolean): void {
    this.terminalWatch = watch;
    this.sendOn('control', { kind: 'terminal-watch', watch });
  }

  /** Sends a controller command on `control`; false before the hello reply or when the channel is not open. */
  command(clientId: string, command: SharedControllerCommand): boolean {
    return this.sendOn('control', { kind: 'command', clientId, command });
  }

  /** Sends a controller prompt on `control`; same conditions as `command`. */
  controllerSend(clientId: string, text: string, draftGithubId?: number): boolean {
    return this.sendOn('control', draftGithubId === undefined
      ? { kind: 'controller-send', clientId, text }
      : { kind: 'controller-send', clientId, text, draftGithubId });
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
      channelsByLabel: new Map(),
      outSeq: new Map(),
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
    negotiation.channelsByLabel.set(label, channel);
    if (label !== 'control' && label !== 'conversation' && label !== 'presence' && label !== 'drafts' && label !== 'terminal') return;
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
      else if (label === 'drafts') this.onDraftEnvelope(negotiation, envelope);
      else if (label === 'terminal') this.onTerminalEnvelope(negotiation, envelope);
      else this.onPresenceEnvelope(envelope);
    });
  }

  private onControl(negotiation: Negotiation, channel: RTCDataChannel, envelope: SharedEnvelope): void {
    const payload = envelope.payload as { kind?: unknown; hello?: unknown; code?: unknown; githubId?: unknown } | null;
    if (typeof payload !== 'object' || payload === null) return;
    if (payload.kind === 'identity') {
      const githubId = payload.githubId;
      if (typeof githubId === 'number' && Number.isSafeInteger(githubId) && githubId > 0) this.callbacks.onIdentity?.(githubId);
      return;
    }
    if (payload.kind === 'command-ack') {
      const ack = readCommandAck(payload as Record<string, unknown>);
      if (ack) this.callbacks.onCommandAck?.(ack);
      return;
    }
    if (payload.kind === 'submit-ack') {
      const ack = readSubmitAck(payload as Record<string, unknown>);
      if (ack) this.callbacks.onSubmitAck?.(ack);
      return;
    }
    if (payload.kind === 'draft-sent') {
      this.callbacks.onDraftSent?.();
      return;
    }
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
      negotiation.outSeq.set('control', 1);
    } catch {
      this.emitPhase(negotiation, 'lost');
      return;
    }
    if (this.terminalWatch) this.sendOn('control', { kind: 'terminal-watch', watch: true });
    this.callbacks.onReady?.();
  }

  private onDraftEnvelope(negotiation: Negotiation, envelope: SharedEnvelope): void {
    if (negotiation.streamId === null || envelope.streamId !== negotiation.streamId) return;
    const draft = readDraftPayload(envelope.payload);
    if (draft) this.callbacks.onDraft?.(draft);
  }

  private onTerminalEnvelope(negotiation: Negotiation, envelope: SharedEnvelope): void {
    if (negotiation.streamId === null || envelope.streamId !== negotiation.streamId) return;
    const payload = readTerminalPayload(envelope.payload);
    if (payload) this.callbacks.onTerminal(payload);
  }

  private sendOn(ch: SharedChannel, payload: unknown): boolean {
    const negotiation = this.current;
    if (!negotiation || this.closed || negotiation.streamId === null) return false;
    const channel = negotiation.channelsByLabel.get(ch);
    if (!channel || channel.readyState !== 'open') return false;
    const seq = (negotiation.outSeq.get(ch) ?? 0) + 1;
    const envelope: SharedEnvelope = { v: SHARED_WIRE_VERSION, ch, streamId: negotiation.streamId, seq, t: this.deps.now?.() ?? Date.now(), payload };
    try {
      for (const part of encodeSharedMessage(envelope, ++this.chunkId)) channel.send(part);
    } catch {
      return false;
    }
    negotiation.outSeq.set(ch, seq);
    return true;
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
