/** PAN-4475 WI-8: the viewer browser's WebRTC answerer, hello handshake and content decoding. */
import { describe, expect, it, vi } from 'vitest';
import type { IceServer, SharedEnvelope, SharedMessage, SignalData } from '@overdeck/contracts';

import { WebRtcViewer, type ViewerNotice, type ViewerPeerPhase, type WebRtcViewerCallbacks } from '../webrtc-viewer';

type Listener = (event: never) => void;

class FakeChannel {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly label: string) {}
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
  receive(data: string): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data } as never);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

class FakePeer {
  static instances: FakePeer[] = [];
  readonly remoteDescriptions: RTCSessionDescriptionInit[] = [];
  readonly localDescriptions: RTCSessionDescriptionInit[] = [];
  readonly candidates: RTCIceCandidateInit[] = [];
  readonly events: string[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly config: RTCConfiguration) {
    FakePeer.instances.push(this);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  private fire(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.events.push('remote');
    this.remoteDescriptions.push(description);
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0 answer' };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescriptions.push(description);
  }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.events.push(`candidate:${candidate.candidate}`);
    this.candidates.push(candidate);
  }
  close(): void {
    this.closed = true;
  }
  fireDataChannel(label: string): FakeChannel {
    const channel = new FakeChannel(label);
    this.fire('datachannel', { channel });
    return channel;
  }
  fireIceCandidate(candidate: string): void {
    this.fire('icecandidate', { candidate: { candidate, sdpMid: '0', sdpMLineIndex: 0 } });
  }
  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.fire('connectionstatechange', {});
  }
}

const SCOPE = { kind: 'conversation' as const, conversationId: 'conv-a' };
const OFFER: SignalData = { sdp: { type: 'offer', sdp: 'v=0 offer' } };
const ICE: IceServer[] = [{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' }];

function message(id: string, text: string, extra: Record<string, unknown> = {}): SharedMessage {
  return { id, role: 'assistant', text, createdAt: '2026-11-03T00:00:00.000Z', ...extra } as SharedMessage;
}

function envelope(ch: SharedEnvelope['ch'], seq: number, payload: unknown, v = 1): string {
  return JSON.stringify({ v, ch, streamId: 'conv-a', seq, t: 1, payload });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

interface Harness {
  viewer: WebRtcViewer;
  signals: SignalData[];
  fetchIceServers: ReturnType<typeof vi.fn>;
  messages: (readonly SharedMessage[])[];
  phases: ViewerPeerPhase[];
  notices: ViewerNotice[];
  callbacks: WebRtcViewerCallbacks;
}

function harness(ice: () => Promise<readonly IceServer[]> = async () => ICE): Harness {
  FakePeer.instances = [];
  const signals: SignalData[] = [];
  const messages: (readonly SharedMessage[])[] = [];
  const phases: ViewerPeerPhase[] = [];
  const notices: ViewerNotice[] = [];
  const fetchIceServers = vi.fn(ice);
  const callbacks: WebRtcViewerCallbacks = {
    onMessages: (list) => messages.push(list),
    onPresence: vi.fn(),
    onPhase: (phase) => phases.push(phase),
    onNotice: (notice) => notices.push(notice),
  };
  const viewer = new WebRtcViewer({
    RTCPeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
    sendSignal: async (data) => { signals.push(data); },
    fetchIceServers,
    now: () => 42,
  }, callbacks);
  return { viewer, signals, fetchIceServers, messages, phases, notices, callbacks };
}

async function offered(h: Harness): Promise<FakePeer> {
  h.viewer.onSignal(OFFER);
  await settle();
  return FakePeer.instances.at(-1) as FakePeer;
}

/** Opens control and conversation, completes the hello, and answers the control channel. */
async function helloDone(h: Harness): Promise<{ peer: FakePeer; control: FakeChannel; conversation: FakeChannel }> {
  const peer = await offered(h);
  const control = peer.fireDataChannel('control');
  const conversation = peer.fireDataChannel('conversation');
  control.receive(envelope('control', 1, { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope: SCOPE } }));
  return { peer, control, conversation };
}

describe('WebRtcViewer (PAN-4475 WI-8)', () => {
  it('answers an offer with the fetched ICE servers', async () => {
    const h = harness();
    const peer = await offered(h);
    expect(h.fetchIceServers).toHaveBeenCalledTimes(1);
    expect(peer.config.iceServers).toEqual([{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' }]);
    expect(peer.remoteDescriptions).toEqual([{ type: 'offer', sdp: 'v=0 offer' }]);
    expect(h.signals).toEqual([{ sdp: { type: 'answer', sdp: 'v=0 answer' } }]);
    expect(h.phases).toEqual(['connecting']);
  });

  it('applies a candidate sent before the offer after the remote description', async () => {
    const h = harness();
    h.viewer.onSignal(OFFER);
    h.viewer.onSignal({ candidate: { candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0 } });
    await settle();
    const peer = FakePeer.instances[0] as FakePeer;
    expect(peer.events).toEqual(['remote', 'candidate:candidate:early']);
    h.viewer.onSignal({ candidate: { candidate: 'candidate:late', sdpMid: '0', sdpMLineIndex: 0 } });
    await settle();
    expect(peer.events.at(-1)).toBe('candidate:candidate:late');
  });

  it('sends local candidates after the answer', async () => {
    const h = harness();
    const peer = await offered(h);
    peer.fireIceCandidate('candidate:local');
    await settle();
    expect(h.signals).toEqual([
      { sdp: { type: 'answer', sdp: 'v=0 answer' } },
      { candidate: { candidate: 'candidate:local', sdpMid: '0', sdpMLineIndex: 0 } },
    ]);
  });

  it('builds the peer with no ICE servers when fetching them fails', async () => {
    const h = harness(async () => { throw new Error('offline'); });
    const peer = await offered(h);
    expect(peer.config.iceServers).toEqual([]);
    expect(h.signals).toHaveLength(1);
  });

  it('replies to the host hello with one control envelope that echoes the scope', async () => {
    const h = harness();
    const { control } = await helloDone(h);
    expect(control.sent).toHaveLength(1);
    const reply = JSON.parse(control.sent[0] as string) as SharedEnvelope<{ kind: string; hello: { scope: unknown } }>;
    expect(reply).toMatchObject({ v: 1, ch: 'control', streamId: 'conv-a', seq: 1, t: 42 });
    expect(reply.payload.kind).toBe('hello');
    expect(reply.payload.hello.scope).toEqual(SCOPE);
    expect(h.notices).toEqual([]);
  });

  it('reports an unsupported scope kind and sends nothing', async () => {
    const h = harness();
    const peer = await offered(h);
    const control = peer.fireDataChannel('control');
    control.receive(envelope('control', 1, { kind: 'hello', hello: { v: 1, scopeKinds: ['task'], scope: { kind: 'task', taskId: 't-1' } } }));
    expect(h.notices).toEqual([{ kind: 'scope_unsupported' }]);
    expect(control.sent).toEqual([]);
  });

  it('reports a newer host and still replies', async () => {
    const h = harness();
    const peer = await offered(h);
    const control = peer.fireDataChannel('control');
    control.receive(envelope('control', 1, { kind: 'hello', hello: { v: 2, scopeKinds: ['conversation'], scope: SCOPE } }, 2));
    expect(h.notices).toEqual([{ kind: 'host_newer' }]);
    expect(control.sent).toHaveLength(1);
  });

  it('decodes history, append and update into the full list', async () => {
    const h = harness();
    const { conversation } = await helloDone(h);
    conversation.receive(envelope('conversation', 1, { kind: 'history', messages: [message('m1', 'first'), message('m2', 'second')] }));
    expect(h.messages.at(-1)?.map((m) => m.text)).toEqual(['first', 'second']);
    conversation.receive(envelope('conversation', 2, { kind: 'append', message: message('m3', 'third') }));
    expect(h.messages.at(-1)?.map((m) => m.text)).toEqual(['first', 'second', 'third']);
    conversation.receive(envelope('conversation', 3, { kind: 'update', message: message('m2', 'second, edited') }));
    expect(h.messages.at(-1)?.map((m) => m.text)).toEqual(['first', 'second, edited', 'third']);
  });

  it('drops unknown keys and author from received messages', async () => {
    const h = harness();
    const { conversation } = await helloDone(h);
    conversation.receive(envelope('conversation', 1, {
      kind: 'history',
      messages: [message('m1', 'hi', { secret: 'x', author: { login: 'mallory', avatarUrl: 'a' }, turnId: 't1', streaming: true })],
    }));
    const got = h.messages.at(-1)?.[0] as unknown as Record<string, unknown>;
    expect(got).not.toHaveProperty('secret');
    expect(got).not.toHaveProperty('author');
    expect(got).toMatchObject({ id: 'm1', text: 'hi', turnId: 't1', streaming: true });
  });

  it('reports an unavailable transcript', async () => {
    const h = harness();
    const { conversation } = await helloDone(h);
    conversation.receive(envelope('conversation', 1, { kind: 'unavailable', reason: 'transcript_not_found' }));
    expect(h.notices).toEqual([{ kind: 'transcript_unavailable' }]);
  });

  it('ignores conversation envelopes before the hello reply', async () => {
    const h = harness();
    const peer = await offered(h);
    const conversation = peer.fireDataChannel('conversation');
    conversation.receive(envelope('conversation', 1, { kind: 'history', messages: [message('m1', 'early')] }));
    expect(h.messages).toEqual([]);
  });

  it('reports a skipped seq once', async () => {
    const h = harness();
    const { conversation } = await helloDone(h);
    conversation.receive(envelope('conversation', 1, { kind: 'history', messages: [] }));
    conversation.receive(envelope('conversation', 3, { kind: 'append', message: message('m1', 'a') }));
    conversation.receive(envelope('conversation', 5, { kind: 'append', message: message('m2', 'b') }));
    expect(h.notices).toEqual([{ kind: 'updates_missed' }]);
  });

  it('gives drafts and terminal channels no message listener', async () => {
    const h = harness();
    const peer = await offered(h);
    expect(peer.fireDataChannel('drafts').listenerCount('message')).toBe(0);
    expect(peer.fireDataChannel('terminal').listenerCount('message')).toBe(0);
    expect(peer.fireDataChannel('presence').listenerCount('message')).toBe(1);
  });

  it('forwards a presence payload', async () => {
    const h = harness();
    const peer = await offered(h);
    const presence = { controllerGithubId: 1, participants: [], streams: [{ streamId: 'conv-a', label: 'Fix it', kind: 'conversation' }] };
    peer.fireDataChannel('presence').receive(envelope('presence', 1, presence));
    expect(h.callbacks.onPresence).toHaveBeenCalledWith(presence);
  });

  it('reports phase connected, then lost when the peer fails', async () => {
    const h = harness();
    const peer = await offered(h);
    peer.setConnectionState('connected');
    peer.setConnectionState('failed');
    expect(h.phases).toEqual(['connecting', 'connected', 'lost']);
  });

  it('a second offer closes the first peer', async () => {
    const h = harness();
    const first = await offered(h);
    const channel = first.fireDataChannel('control');
    const second = await offered(h);
    expect(first.closed).toBe(true);
    expect(channel.closed).toBe(true);
    expect(second).not.toBe(first);
    expect(second.closed).toBe(false);
    // The closed peer's state change does not report `lost`.
    first.setConnectionState('closed');
    expect(h.phases).toEqual(['connecting', 'connecting']);
  });

  it('fires no callback after close()', async () => {
    const h = harness();
    const { peer, conversation } = await helloDone(h);
    h.viewer.close();
    expect(peer.closed).toBe(true);
    const before = { messages: h.messages.length, phases: h.phases.length, notices: h.notices.length };
    conversation.receive(envelope('conversation', 1, { kind: 'history', messages: [message('m1', 'late')] }));
    peer.setConnectionState('failed');
    h.viewer.onSignal(OFFER);
    await settle();
    expect({ messages: h.messages.length, phases: h.phases.length, notices: h.notices.length }).toEqual(before);
    expect(FakePeer.instances).toHaveLength(1);
  });
});
