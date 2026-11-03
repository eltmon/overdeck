/** PAN-4475 WI-8: the viewer browser's WebRTC answerer, hello handshake and content decoding. */
import { describe, expect, it, vi } from 'vitest';
import type { IceServer, SharedEnvelope, SharedMessage, SignalData, TerminalPayload } from '@overdeck/contracts';

import {
  readPresence,
  readSharedMessage,
  readTerminalPayload,
  WebRtcViewer,
  type CommandAck,
  type SubmitAck,
  type ViewerNotice,
  type ViewerPeerPhase,
  type WebRtcViewerCallbacks,
} from '../webrtc-viewer';

type Listener = (event: never) => void;

class FakeChannel {
  readonly sent: string[] = [];
  readyState: RTCDataChannelState = 'open';
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
  drafts: unknown[];
  acks: SubmitAck[];
  events: string[];
  terminal: TerminalPayload[];
  callbacks: WebRtcViewerCallbacks;
}

function harness(ice: () => Promise<readonly IceServer[]> = async () => ICE): Harness {
  FakePeer.instances = [];
  const signals: SignalData[] = [];
  const messages: (readonly SharedMessage[])[] = [];
  const phases: ViewerPeerPhase[] = [];
  const notices: ViewerNotice[] = [];
  const drafts: unknown[] = [];
  const acks: SubmitAck[] = [];
  const events: string[] = [];
  const terminal: TerminalPayload[] = [];
  const fetchIceServers = vi.fn(ice);
  const callbacks: WebRtcViewerCallbacks = {
    onMessages: (list) => messages.push(list),
    onPresence: vi.fn(),
    onPhase: (phase) => phases.push(phase),
    onNotice: (notice) => notices.push(notice),
    onDraft: (draft) => drafts.push(draft),
    onSubmitAck: (ack) => acks.push(ack),
    onDraftSent: () => events.push('draft-sent'),
    onReady: () => events.push('ready'),
    onTerminal: (payload) => terminal.push(payload),
  };
  const viewer = new WebRtcViewer({
    RTCPeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
    sendSignal: async (data) => { signals.push(data); },
    fetchIceServers,
    now: () => 42,
  }, callbacks);
  return { viewer, signals, fetchIceServers, messages, phases, notices, drafts, acks, events, terminal, callbacks };
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

  it('drops unknown keys and an author without an https avatar from received messages', async () => {
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

  it('gives drafts and terminal a message listener', async () => {
    const h = harness();
    const peer = await offered(h);
    expect(peer.fireDataChannel('drafts').listenerCount('message')).toBe(1);
    expect(peer.fireDataChannel('terminal').listenerCount('message')).toBe(1);
    expect(peer.fireDataChannel('presence').listenerCount('message')).toBe(1);
  });

  it('forwards a presence payload', async () => {
    const h = harness();
    const peer = await offered(h);
    const presence = { controllerGithubId: 1, participants: [], streams: [{ streamId: 'conv-a', label: 'Fix it', kind: 'conversation' }] };
    peer.fireDataChannel('presence').receive(envelope('presence', 1, presence));
    expect(h.callbacks.onPresence).toHaveBeenCalledWith(presence);
  });

  it('rebuilds presence field by field and drops malformed participants and streams', () => {
    const host = { githubId: 1, login: 'owner', avatarUrl: 'https://avatars.githubusercontent.com/u/1', state: 'admitted', contributor: false, isHost: true };
    expect(readPresence({
      controllerGithubId: 1,
      participants: [null, 'x', { ...host, login: 7 }, { ...host, state: 'gone' }, { ...host, extra: 'secret' }],
      streams: [null, { streamId: 'conv-a', label: 5, kind: 'conversation' }, { streamId: 'conv-a', label: 'Fix it', kind: 'conversation', extra: 1 }],
    })).toEqual({
      controllerGithubId: 1,
      participants: [host],
      streams: [{ streamId: 'conv-a', label: 'Fix it', kind: 'conversation' }],
    });
    expect(readPresence({ controllerGithubId: 1, participants: 'nope', streams: [] })).toBeNull();
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

describe('WebRtcViewer terminal (PAN-4477 WI-7)', () => {
  const HELLO = { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope: SCOPE } };
  const sentPayloads = (channel: FakeChannel) => channel.sent.map((part) => JSON.parse(part) as SharedEnvelope);

  it('forwards a terminal snapshot after the hello with only the known fields', async () => {
    const h = harness();
    const { peer } = await helloDone(h);
    const terminal = peer.fireDataChannel('terminal');
    terminal.receive(envelope('terminal', 1, { kind: 'snapshot', cols: 100, rows: 30, data: 'SCREEN', extra: 'x' }));
    expect(h.terminal).toEqual([{ kind: 'snapshot', cols: 100, rows: 30, data: 'SCREEN' }]);
  });

  it('ignores terminal envelopes before the hello reply', async () => {
    const h = harness();
    const peer = await offered(h);
    peer.fireDataChannel('terminal').receive(envelope('terminal', 1, { kind: 'output', data: 'x' }));
    expect(h.terminal).toEqual([]);
  });

  it('drops malformed terminal payloads', async () => {
    const h = harness();
    const { peer } = await helloDone(h);
    const terminal = peer.fireDataChannel('terminal');
    terminal.receive(envelope('terminal', 1, { kind: 'snapshot', cols: 0, rows: 30, data: '' }));
    terminal.receive(envelope('terminal', 2, { kind: 'size', cols: 1.5, rows: 30 }));
    terminal.receive(envelope('terminal', 3, { kind: 'unavailable', reason: 'x' }));
    expect(h.terminal).toEqual([]);
  });

  it('rebuilds each payload kind and rejects bad dimensions and data', () => {
    expect(readTerminalPayload({ kind: 'output', data: 'a' })).toEqual({ kind: 'output', data: 'a' });
    expect(readTerminalPayload({ kind: 'size', cols: 1000, rows: 1 })).toEqual({ kind: 'size', cols: 1000, rows: 1 });
    expect(readTerminalPayload({ kind: 'unavailable', reason: 'terminal_ended' })).toEqual({ kind: 'unavailable', reason: 'terminal_ended' });
    expect(readTerminalPayload({ kind: 'size', cols: 1001, rows: 1 })).toBeNull();
    expect(readTerminalPayload({ kind: 'output', data: 7 })).toBeNull();
    expect(readTerminalPayload({ kind: 'exit' })).toBeNull();
    expect(readTerminalPayload(null)).toBeNull();
  });

  it('sends the watch on control as seq 2 after the hello', async () => {
    const h = harness();
    const { control } = await helloDone(h);
    h.viewer.setTerminalWatch(true);
    expect(sentPayloads(control).map((e) => [e.seq, e.payload])).toEqual([
      [1, HELLO],
      [2, { kind: 'terminal-watch', watch: true }],
    ]);
  });

  it('holds a watch set before the hello until the hello reply is out', async () => {
    const h = harness();
    const peer = await offered(h);
    const control = peer.fireDataChannel('control');
    h.viewer.setTerminalWatch(true);
    expect(control.sent).toEqual([]);
    control.receive(envelope('control', 1, HELLO));
    expect(sentPayloads(control).map((e) => e.payload)).toEqual([HELLO, { kind: 'terminal-watch', watch: true }]);
  });

  it('re-sends the watch after the hello of a new peer', async () => {
    const h = harness();
    await helloDone(h);
    h.viewer.setTerminalWatch(true);
    const { control } = await helloDone(h);
    expect(sentPayloads(control).map((e) => [e.seq, e.payload])).toEqual([
      [1, HELLO],
      [2, { kind: 'terminal-watch', watch: true }],
    ]);
  });

  it('sends watch false and never sends on the terminal channel', async () => {
    const h = harness();
    const { peer, control } = await helloDone(h);
    const terminal = peer.fireDataChannel('terminal');
    h.viewer.setTerminalWatch(true);
    terminal.receive(envelope('terminal', 1, { kind: 'output', data: 'x' }));
    h.viewer.setTerminalWatch(false);
    expect(sentPayloads(control).map((e) => [e.seq, e.payload])).toEqual([
      [1, HELLO],
      [2, { kind: 'terminal-watch', watch: true }],
      [3, { kind: 'terminal-watch', watch: false }],
    ]);
    expect(terminal.sent).toEqual([]);
  });

  it('shares the control seq with submits', async () => {
    const h = harness();
    const { control } = await helloDone(h);
    expect(h.viewer.submit('c1', 'Do it')).toBe(true);
    h.viewer.setTerminalWatch(true);
    expect(sentPayloads(control).map((e) => [e.seq, e.payload])).toEqual([
      [1, HELLO],
      [2, { kind: 'submit', clientId: 'c1', text: 'Do it' }],
      [3, { kind: 'terminal-watch', watch: true }],
    ]);
  });
});

describe('WebRtcViewer drafts and submits (PAN-4476 WI-10)', () => {
  const sentEnvelopes = (channel: FakeChannel) => channel.sent.map((part) => JSON.parse(part) as SharedEnvelope);

  it('forwards a host draft rebuilt from known keys and ignores a malformed one', async () => {
    const h = harness();
    const { peer } = await helloDone(h);
    const drafts = peer.fireDataChannel('drafts');
    drafts.receive(envelope('drafts', 1, { authorGithubId: 7, authorLogin: 'alice', text: 'hi', updatedAt: 5, avatarUrl: 'javascript:x' }));
    drafts.receive(envelope('drafts', 2, { authorGithubId: 0, authorLogin: 'alice', text: 'hi', updatedAt: 5 }));
    expect(h.drafts).toEqual([{ authorGithubId: 7, authorLogin: 'alice', text: 'hi', updatedAt: 5 }]);
  });

  it('sends drafts and submits with per-channel seq after the hello, and nothing before it', async () => {
    const h = harness();
    const peer = await offered(h);
    const control = peer.fireDataChannel('control');
    const drafts = peer.fireDataChannel('drafts');
    expect(h.viewer.sendDraft('early')).toBe(false);
    expect(h.viewer.submit('c0', 'early')).toBe(false);
    expect(drafts.sent).toEqual([]);
    control.receive(envelope('control', 1, { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope: SCOPE } }));
    expect(h.events).toEqual(['ready']);
    expect(h.viewer.sendDraft('x')).toBe(true);
    expect(h.viewer.sendDraft('xy')).toBe(true);
    expect(sentEnvelopes(drafts)).toEqual([
      { v: 1, ch: 'drafts', streamId: 'conv-a', seq: 1, t: 42, payload: { text: 'x' } },
      { v: 1, ch: 'drafts', streamId: 'conv-a', seq: 2, t: 42, payload: { text: 'xy' } },
    ]);
    expect(h.viewer.submit('c1', 'Do it')).toBe(true);
    expect(sentEnvelopes(control).at(-1)).toEqual({ v: 1, ch: 'control', streamId: 'conv-a', seq: 2, t: 42, payload: { kind: 'submit', clientId: 'c1', text: 'Do it' } });
  });

  it('returns false when the channel is not open', async () => {
    const h = harness();
    const { peer } = await helloDone(h);
    const drafts = peer.fireDataChannel('drafts');
    drafts.readyState = 'closing';
    expect(h.viewer.sendDraft('x')).toBe(false);
    expect(drafts.sent).toEqual([]);
  });

  it('fires onReady once per negotiation', async () => {
    const h = harness();
    const { control } = await helloDone(h);
    control.receive(envelope('control', 2, { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope: SCOPE } }));
    expect(h.events).toEqual(['ready']);
  });

  it('calls onSubmitAck and onDraftSent', async () => {
    const h = harness();
    const { control } = await helloDone(h);
    control.receive(envelope('control', 2, { kind: 'submit-ack', clientId: 'c1', status: 'queued', position: 2, extra: 'x' }));
    control.receive(envelope('control', 3, { kind: 'submit-ack', clientId: 'c1', status: 'rejected', reason: 'grant_revoked' }));
    control.receive(envelope('control', 4, { kind: 'submit-ack', clientId: 'c1', status: 'maybe' }));
    control.receive(envelope('control', 5, { kind: 'draft-sent' }));
    expect(h.acks).toEqual([
      { clientId: 'c1', status: 'queued', position: 2 },
      { clientId: 'c1', status: 'rejected', reason: 'grant_revoked' },
    ]);
    expect(h.events).toEqual(['ready', 'draft-sent']);
  });

  it('keeps an author with an https avatar and drops a javascript: one', () => {
    const alice = { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' };
    expect(readSharedMessage(message('m1', 'hi', { role: 'user', author: { ...alice, extra: 1 } }))?.author).toEqual(alice);
    expect(readSharedMessage(message('m1', 'hi', { role: 'user', author: { login: 'alice', avatarUrl: 'javascript:x' } }))).not.toHaveProperty('author');
  });

  it('keeps agentWorking and queued on a presence stream', () => {
    const stream = { streamId: 'conv-a', label: 'Fix it', kind: 'conversation', agentWorking: true, queued: 2 };
    expect(readPresence({ controllerGithubId: 1, participants: [], streams: [stream] })?.streams).toEqual([stream]);
    expect(readPresence({ controllerGithubId: 1, participants: [], streams: [{ ...stream, agentWorking: 'yes', queued: -1 }] })?.streams).toEqual([
      { streamId: 'conv-a', label: 'Fix it', kind: 'conversation' },
    ]);
  });
});

describe('WebRtcViewer controller commands (PAN-4478 WI-5)', () => {
  const sentEnvelopes = (channel: FakeChannel) => channel.sent.map((part) => JSON.parse(part) as SharedEnvelope);

  it('reports the host identity and command acks, dropping unknown reasons', async () => {
    const h = harness();
    const identities: number[] = [];
    const acks: CommandAck[] = [];
    h.callbacks.onIdentity = (githubId) => identities.push(githubId);
    h.callbacks.onCommandAck = (ack) => acks.push(ack);
    const { control } = await helloDone(h);
    control.receive(envelope('control', 2, { kind: 'identity', githubId: 100 }));
    control.receive(envelope('control', 3, { kind: 'identity', githubId: -1 }));
    control.receive(envelope('control', 4, { kind: 'identity', githubId: '100' }));
    control.receive(envelope('control', 5, { kind: 'command-ack', clientId: 'k1', status: 'accepted', extra: 'x' }));
    control.receive(envelope('control', 6, { kind: 'command-ack', clientId: 's1', status: 'accepted', position: 2 }));
    control.receive(envelope('control', 7, { kind: 'command-ack', clientId: 'k2', status: 'rejected', reason: 'not_controller' }));
    control.receive(envelope('control', 8, { kind: 'command-ack', clientId: 'k3', status: 'rejected', reason: 'made_up' }));
    control.receive(envelope('control', 9, { kind: 'command-ack', clientId: 'k4', status: 'maybe' }));
    expect(identities).toEqual([100]);
    expect(acks).toEqual([
      { clientId: 'k1', status: 'accepted' },
      { clientId: 's1', status: 'accepted', position: 2 },
      { clientId: 'k2', status: 'rejected', reason: 'not_controller' },
      { clientId: 'k3', status: 'rejected' },
    ]);
  });

  it('sends command and controller-send on control with the next seq after the hello reply', async () => {
    const h = harness();
    const peer = await offered(h);
    const control = peer.fireDataChannel('control');
    expect(h.viewer.command('k0', { type: 'kick', githubId: 200 })).toBe(false);
    expect(h.viewer.controllerSend('s0', 'early')).toBe(false);
    control.receive(envelope('control', 1, { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope: SCOPE } }));
    expect(h.viewer.command('k1', { type: 'admit', githubId: 200 })).toBe(true);
    expect(h.viewer.controllerSend('s1', 'Run it')).toBe(true);
    expect(h.viewer.controllerSend('s2', 'Edited', 200)).toBe(true);
    expect(sentEnvelopes(control).slice(1)).toEqual([
      { v: 1, ch: 'control', streamId: 'conv-a', seq: 2, t: 42, payload: { kind: 'command', clientId: 'k1', command: { type: 'admit', githubId: 200 } } },
      { v: 1, ch: 'control', streamId: 'conv-a', seq: 3, t: 42, payload: { kind: 'controller-send', clientId: 's1', text: 'Run it' } },
      { v: 1, ch: 'control', streamId: 'conv-a', seq: 4, t: 42, payload: { kind: 'controller-send', clientId: 's2', text: 'Edited', draftGithubId: 200 } },
    ]);
  });
});
