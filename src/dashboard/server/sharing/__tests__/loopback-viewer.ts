/**
 * A werift stand-in for the slice 4 browser viewer (PRD PAN-4474 WI-7), optionally built with ICE
 * servers and a relay-only transport policy (PAN-4482 WI-4): it answers the host's offer,
 * reassembles every channel's envelopes with `SharedChannelReader`, and replies to the host hello
 * with its own hello that echoes the host's scope (D-5). `send` writes one envelope on a channel with
 * that channel's next outbound `seq` (the hello is `control` seq 1; PAN-4476). Test helper, not a test.
 */
import {
  SHARED_SCOPE_KINDS,
  SHARED_WIRE_VERSION,
  SharedChannelReader,
  type SharedChannel,
  type SharedEnvelope,
  type SharedHello,
  type SignalData,
} from '@overdeck/contracts';
import { RTCPeerConnection, type RTCDataChannel } from 'werift';

type Candidate = NonNullable<SignalData['candidate']>;
type Predicate = (channel: string, envelope: SharedEnvelope) => boolean;

export interface LoopbackViewerConfig {
  readonly iceServers?: Array<{ urls: string[]; username?: string; credential?: string }>;
  readonly iceTransportPolicy?: 'all' | 'relay';
}

export class LoopbackViewer {
  readonly pc: RTCPeerConnection;
  /** Every signal this viewer sent, in order. */
  readonly signals: SignalData[] = [];
  readonly channels = new Map<string, RTCDataChannel>();
  /** Every envelope received, per channel label, in arrival order. */
  readonly envelopes = new Map<string, SharedEnvelope[]>();
  hostHello: SharedHello | null = null;
  private readonly readers = new Map<string, SharedChannelReader>();
  private readonly signalListeners = new Set<(data: SignalData) => void>();
  private readonly waiters = new Set<{ predicate: Predicate; resolve: (envelope: SharedEnvelope) => void }>();
  private readonly pendingRemote: Candidate[] = [];
  private readonly pendingLocal: Candidate[] = [];
  private readonly outSeq = new Map<string, number>();
  private remoteSet = false;
  private localSent = false;

  constructor(config: LoopbackViewerConfig = {}) {
    this.pc = new RTCPeerConnection({
      iceServers: config.iceServers ?? [],
      ...(config.iceTransportPolicy ? { iceTransportPolicy: config.iceTransportPolicy } : {}),
    });
    this.pc.onIceCandidate.subscribe((candidate) => {
      const json = candidate?.toJSON();
      if (!json?.candidate) return;
      const local: Candidate = { candidate: json.candidate, sdpMid: json.sdpMid ?? null, sdpMLineIndex: json.sdpMLineIndex ?? null };
      if (this.localSent) this.emitSignal({ candidate: local });
      else this.pendingLocal.push(local);
    });
    this.pc.onDataChannel.subscribe((channel) => {
      this.channels.set(channel.label, channel);
      this.readers.set(channel.label, new SharedChannelReader());
      channel.onMessage.subscribe((data) => this.onMessage(channel, data));
    });
  }

  /** Subscribes to the signals this viewer sends; returns an unsubscribe function. */
  onOutgoingSignal(listener: (data: SignalData) => void): () => void {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  }

  /** Applies a signal the host sent: answers an offer and adds candidates once the offer is set. */
  async onSignal(data: SignalData): Promise<void> {
    if (data.sdp?.type === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp.sdp });
      this.remoteSet = true;
      for (const candidate of this.pendingRemote.splice(0)) await this.addCandidate(candidate);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.emitSignal({ sdp: { type: 'answer', sdp: this.pc.localDescription?.sdp ?? answer.sdp } });
      this.localSent = true;
      for (const candidate of this.pendingLocal.splice(0)) this.emitSignal({ candidate });
    }
    if (data.candidate) {
      if (this.remoteSet) await this.addCandidate(data.candidate);
      else this.pendingRemote.push(data.candidate);
    }
  }

  /** Resolves with the first received envelope that matches, waiting for the next one if none has yet. */
  waitFor(predicate: Predicate): Promise<SharedEnvelope> {
    for (const [channel, list] of this.envelopes) {
      const found = list.find((envelope) => predicate(channel, envelope));
      if (found) return Promise.resolve(found);
    }
    return new Promise((resolve) => this.waiters.add({ predicate, resolve }));
  }

  /** Sends one envelope on `ch` with that channel's next seq; throws when the channel is not open. */
  send(ch: SharedChannel, payload: unknown): void {
    const channel = this.channels.get(ch);
    const streamId = this.hostHello?.scope.conversationId;
    if (!channel || streamId === undefined) throw new Error(`channel ${ch} is not ready`);
    const seq = (this.outSeq.get(ch) ?? 0) + 1;
    this.outSeq.set(ch, seq);
    const envelope: SharedEnvelope = { v: SHARED_WIRE_VERSION, ch, streamId, seq, t: Date.now(), payload };
    channel.send(JSON.stringify(envelope));
  }

  async close(): Promise<void> {
    await this.pc.close().catch(() => undefined);
  }

  private emitSignal(data: SignalData): void {
    this.signals.push(data);
    for (const listener of this.signalListeners) listener(data);
  }

  private async addCandidate(candidate: Candidate): Promise<void> {
    await this.pc
      .addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? undefined,
        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
      })
      .catch(() => undefined);
  }

  private onMessage(channel: RTCDataChannel, data: string | Buffer): void {
    const result = this.readers.get(channel.label)?.read(typeof data === 'string' ? data : data.toString('utf8'));
    if (result?.kind !== 'envelope') return;
    const envelope = result.envelope;
    const list = this.envelopes.get(channel.label) ?? [];
    list.push(envelope);
    this.envelopes.set(channel.label, list);
    const payload = envelope.payload as { kind?: string; hello?: SharedHello };
    if (channel.label === 'control' && payload.kind === 'hello' && payload.hello && this.hostHello === null) {
      this.hostHello = payload.hello;
      const reply: SharedEnvelope = {
        v: SHARED_WIRE_VERSION,
        ch: 'control',
        streamId: envelope.streamId,
        seq: 1,
        t: Date.now(),
        payload: { kind: 'hello', hello: { v: SHARED_WIRE_VERSION, scopeKinds: SHARED_SCOPE_KINDS, scope: payload.hello.scope } },
      };
      channel.send(JSON.stringify(reply));
      this.outSeq.set('control', 1);
    }
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(channel.label, envelope)) continue;
      this.waiters.delete(waiter);
      waiter.resolve(envelope);
    }
  }
}
