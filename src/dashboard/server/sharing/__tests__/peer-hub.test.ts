import type {
  ConversationPayload,
  HostFrame,
  RoomParticipant,
  RoomSnapshot,
  ShareScope,
  SharedEnvelope,
  SignalData,
} from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationSink } from '../conversation-bridge.js';
import {
  ICE_SERVERS_CACHE_MS,
  ICE_SERVERS_TIMEOUT_MS,
  PeerHub,
  type HubDataChannel,
  type HubPeerConnection,
  type PeerHubDeps,
} from '../peer-hub.js';
import { QUEUE_TICK_MS, type SubmitQueueDeps } from '../submit-queue.js';

const scope: ShareScope = { kind: 'conversation', conversationId: 'conv-a' };

type Listener<T extends unknown[]> = (...args: T) => void;

class Emitter<T extends unknown[]> {
  private readonly listeners = new Set<Listener<T>>();
  subscriptions = 0;
  readonly subscribe = (listener: Listener<T>) => {
    this.subscriptions++;
    this.listeners.add(listener);
    return { unSubscribe: () => void this.listeners.delete(listener) };
  };
  emit(...args: T): void {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

class FakeChannel implements HubDataChannel {
  readyState = 'connecting';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readonly sent: string[] = [];
  closed = false;
  readonly bufferedAmountLow = new Emitter<[]>();
  readonly onMessage = new Emitter<[string | Buffer]>();
  readonly stateChanged = new Emitter<[string]>();

  constructor(
    readonly label: string,
    readonly ordered: boolean,
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.readyState = 'open';
    this.stateChanged.emit('open');
  }
}

class FakePeer implements HubPeerConnection {
  readonly channels: FakeChannel[] = [];
  readonly remote: Array<{ type: string; sdp: string }> = [];
  readonly candidates: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }> = [];
  localDescription: { sdp: string } | null = null;
  closed = false;
  candidateOnSetLocal: string | null = null;
  readonly onIceCandidate = new Emitter<
    [{ toJSON(): { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null } } | undefined]
  >();
  readonly connectionStateChange = new Emitter<[string]>();

  constructor(readonly config: { iceServers: Array<{ urls: string[]; username?: string; credential?: string }> }) {}

  createDataChannel(label: string, options: { ordered: boolean }): FakeChannel {
    const channel = new FakeChannel(label, options.ordered);
    this.channels.push(channel);
    return channel;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = { sdp: description.sdp };
    if (this.candidateOnSetLocal) this.emitCandidate(this.candidateOnSetLocal);
  }

  async setRemoteDescription(description: { type: 'answer'; sdp: string }) {
    this.remote.push(description);
  }

  async addIceCandidate(candidate: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }) {
    this.candidates.push(candidate);
  }

  async close() {
    this.closed = true;
  }

  emitCandidate(candidate: string): void {
    this.onIceCandidate.emit({ toJSON: () => ({ candidate, sdpMid: '0', sdpMLineIndex: 0 }) });
  }

  channel(label: string): FakeChannel {
    const channel = this.channels.find((c) => c.label === label);
    if (!channel) throw new Error(`no channel ${label}`);
    return channel;
  }
}

function participant(githubId: number, state: 'lobby' | 'admitted', connected = true): RoomParticipant {
  return { githubId, login: `user${githubId}`, avatarUrl: `https://a/${githubId}`, state, contributor: false, connected };
}

function snapshot(...participants: RoomParticipant[]): RoomSnapshot {
  return {
    shortCode: 'ABC123',
    scope,
    dataOwner: { githubId: 1, login: 'owner', avatarUrl: 'https://a/1' },
    controllerGithubId: 1,
    hostConnected: true,
    participants,
    blocked: [],
  };
}

/** Every hub a test built; closed after each test so no queue ticker outlives it. */
const hubs: PeerHub[] = [];

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
});

/** Lets the hub's promise chains (ICE wait, label, offer) run; setImmediate stays real. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(
  options: {
    sendFrame?: (frame: HostFrame) => boolean;
    streamLabel?: () => Promise<string>;
    onPeer?: (peer: FakePeer) => void;
    attach?: PeerHubDeps['bridge']['attach'];
    queue?: Partial<SubmitQueueDeps>;
  } = {},
) {
  const frames: HostFrame[] = [];
  const peers: FakePeer[] = [];
  const bridge = {
    attach: vi.fn(options.attach ?? (async () => () => undefined)),
    expectAuthor: vi.fn((_text: string, _author: { login: string; avatarUrl: string }) => () => undefined),
    close: vi.fn(),
  };
  const queue = {
    deliver: vi.fn(options.queue?.deliver ?? (async () => ({ status: 200, body: {} }))),
    activity: vi.fn(options.queue?.activity ?? (async () => ({ working: false, lastMessageId: null }))),
    now: options.queue?.now ?? (() => Date.now()),
  };
  const deps: PeerHubDeps = {
    createPeerConnection: (config) => {
      const peer = new FakePeer(config);
      options.onPeer?.(peer);
      peers.push(peer);
      return peer;
    },
    bridge,
    queue,
    streamLabel: options.streamLabel ?? (async () => 'Fixture conversation'),
    now: () => Date.now(),
  };
  const hub = new PeerHub(
    {
      shortCode: 'ABC123',
      scope,
      sendFrame: (frame) => {
        frames.push(frame);
        return options.sendFrame?.(frame) ?? true;
      },
    },
    deps,
  );
  hubs.push(hub);
  const ofType = <T extends HostFrame['type']>(type: T) =>
    frames.filter((frame): frame is Extract<HostFrame, { type: T }> => frame.type === type);
  return { hub, frames, peers, bridge, queue, ofType };
}

/** Admits a viewer and brings its peer connection up to a sent offer. */
async function connected(s: ReturnType<typeof setup>, githubId = 7): Promise<FakePeer> {
  s.hub.admit(githubId);
  s.hub.onSnapshot(snapshot(participant(githubId, 'admitted')));
  await settle();
  if (s.ofType('ice-servers').length > 0 && s.peers.length === 0) s.hub.onIceServers([]);
  await settle();
  const peer = s.peers.at(-1);
  if (!peer) throw new Error('no peer');
  return peer;
}

describe('PeerHub admission gate, signaling and ICE', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never connects a viewer the host did not admit, whatever the snapshot says (NFR-4)', async () => {
    const s = setup();
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    s.hub.onSignal(7, { sdp: { type: 'answer', sdp: 'answer-sdp' } });
    await settle();
    expect(s.peers).toEqual([]);
    expect(s.frames).toEqual([]);
    expect(s.hub.peerCount()).toBe(0);
  });

  it('offers an admitted, connected viewer one connection with five ordered channels', async () => {
    const s = setup();
    s.hub.admit(7);
    s.hub.onSnapshot(snapshot(participant(7, 'lobby')));
    await settle();
    expect(s.frames).toEqual([]);

    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    expect(s.frames).toEqual([{ type: 'ice-servers' }]);
    expect(s.peers).toEqual([]);

    s.hub.onIceServers([{ urls: ['stun:x'] }]);
    await settle();
    expect(s.peers).toHaveLength(1);
    const peer = s.peers[0] as FakePeer;
    expect(peer.config).toEqual({ iceServers: [{ urls: ['stun:x'] }] });
    expect(peer.channels.map((c) => c.label)).toEqual(['control', 'conversation', 'drafts', 'terminal', 'presence']);
    expect(peer.channels.every((c) => c.ordered)).toBe(true);
    expect(s.ofType('signal')).toEqual([{ type: 'signal', githubId: 7, data: { sdp: { type: 'offer', sdp: 'offer-sdp' } } }]);

    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    expect(s.peers).toHaveLength(1);
    expect(s.hub.peerCount()).toBe(1);
  });

  it('passes TURN credentials through to the peer connection', async () => {
    const s = setup();
    s.hub.admit(7);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    s.hub.onIceServers([{ urls: ['turn:t?transport=udp', 'turns:t:443'], username: 'u', credential: 'c' }]);
    await settle();
    expect(s.peers[0]?.config).toEqual({
      iceServers: [{ urls: ['turn:t?transport=udp', 'turns:t:443'], username: 'u', credential: 'c' }],
    });
  });

  it('sends a candidate gathered before the offer after the offer', async () => {
    const s = setup({ onPeer: (peer) => (peer.candidateOnSetLocal = 'candidate:1') });
    await connected(s);
    expect(s.ofType('signal').map((frame) => frame.data)).toEqual([
      { sdp: { type: 'offer', sdp: 'offer-sdp' } },
      { candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } },
    ]);
  });

  it('sends a candidate gathered after the offer at once and skips an empty one', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.emitCandidate('');
    peer.onIceCandidate.emit(undefined);
    peer.emitCandidate('candidate:2');
    expect(s.ofType('signal').slice(1).map((frame) => frame.data)).toEqual([
      { candidate: { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 } },
    ]);
  });

  it('applies remote candidates only after the answer and ignores an inbound offer', async () => {
    const s = setup();
    const peer = await connected(s);
    const candidate: SignalData = { candidate: { candidate: 'candidate:r', sdpMid: '0', sdpMLineIndex: null } };
    s.hub.onSignal(7, candidate);
    await settle();
    expect(peer.candidates).toEqual([]);

    s.hub.onSignal(7, { sdp: { type: 'offer', sdp: 'viewer-offer' } });
    await settle();
    expect(peer.remote).toEqual([]);

    s.hub.onSignal(7, { sdp: { type: 'answer', sdp: 'answer-sdp' } });
    await settle();
    expect(peer.remote).toEqual([{ type: 'answer', sdp: 'answer-sdp' }]);
    expect(peer.candidates).toEqual([{ candidate: 'candidate:r', sdpMid: '0', sdpMLineIndex: undefined }]);

    s.hub.onSignal(7, { candidate: { candidate: 'candidate:s', sdpMid: null, sdpMLineIndex: 0 } });
    await settle();
    expect(peer.candidates.at(-1)).toEqual({ candidate: 'candidate:s', sdpMid: undefined, sdpMLineIndex: 0 });
  });

  it('closes the peer of a viewer who disconnects and offers again when it returns', async () => {
    const s = setup();
    const first = await connected(s);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted', false)));
    expect(first.closed).toBe(true);
    expect(first.channels.every((c) => c.closed)).toBe(true);
    expect(s.hub.peerCount()).toBe(0);

    s.hub.onSnapshot(snapshot(participant(7, 'admitted', true)));
    await settle();
    expect(s.peers).toHaveLength(2);
    expect(s.hub.peerCount()).toBe(1);
  });

  it('closes a removed viewer at once and never offers it again', async () => {
    const s = setup();
    const peer = await connected(s);
    s.hub.remove(7);
    expect(peer.closed).toBe(true);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    expect(s.peers).toHaveLength(1);
    expect(s.hub.peerCount()).toBe(0);
  });

  it('drops a viewer the snapshot no longer lists from the host-admitted set', async () => {
    const s = setup();
    const peer = await connected(s);
    s.hub.onSnapshot(snapshot());
    expect(peer.closed).toBe(true);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    expect(s.peers).toHaveLength(1);
  });

  it('shares one ice-servers request between viewers starting together', async () => {
    const s = setup();
    s.hub.admit(7);
    s.hub.admit(8);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'admitted')));
    await settle();
    expect(s.ofType('ice-servers')).toHaveLength(1);
    s.hub.onIceServersUnavailable();
    await settle();
    expect(s.peers.map((peer) => peer.config)).toEqual([{ iceServers: [] }, { iceServers: [] }]);
  });

  it('does not cache an unavailable answer', async () => {
    const s = setup();
    s.hub.admit(7);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    s.hub.onIceServersUnavailable();
    await settle();
    s.hub.admit(8);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'admitted')));
    await settle();
    expect(s.ofType('ice-servers')).toHaveLength(2);
  });

  it('falls back to host candidates when the service does not answer within 5 s', async () => {
    const s = setup();
    s.hub.admit(7);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    await vi.advanceTimersByTimeAsync(ICE_SERVERS_TIMEOUT_MS - 1);
    expect(s.peers).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(s.peers.map((peer) => peer.config)).toEqual([{ iceServers: [] }]);
  });

  it('reuses a cached ICE list for 50 minutes', async () => {
    const s = setup();
    s.hub.admit(7);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    s.hub.onIceServers([{ urls: ['stun:x'] }]);
    await settle();

    await vi.advanceTimersByTimeAsync(ICE_SERVERS_CACHE_MS - 1);
    s.hub.admit(8);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'admitted')));
    await settle();
    expect(s.ofType('ice-servers')).toHaveLength(1);
    expect(s.peers[1]?.config).toEqual({ iceServers: [{ urls: ['stun:x'] }] });

    await vi.advanceTimersByTimeAsync(1);
    s.hub.admit(9);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'admitted'), participant(9, 'admitted')));
    await settle();
    expect(s.ofType('ice-servers')).toHaveLength(2);
  });

  it('removes a failed peer and offers a new one on the next eligible snapshot', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.connectionStateChange.emit('failed');
    expect(peer.closed).toBe(true);
    expect(s.hub.peerCount()).toBe(0);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    await settle();
    expect(s.peers).toHaveLength(2);
  });

  it('closes the peer when the host socket cannot send its signal', async () => {
    const s = setup({ sendFrame: (frame) => frame.type !== 'signal' });
    const peer = await connected(s);
    expect(peer.closed).toBe(true);
    expect(s.hub.peerCount()).toBe(0);
  });

  it('closes every peer and the bridge on close, then ignores everything', async () => {
    const s = setup();
    const peer = await connected(s);
    s.hub.close();
    expect(peer.closed).toBe(true);
    expect(s.bridge.close).toHaveBeenCalledTimes(1);
    s.hub.admit(8);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'admitted')));
    await settle();
    expect(s.peers).toHaveLength(1);
    expect(s.hub.peerCount()).toBe(0);
  });
});

function viewerHello(hello: Record<string, unknown> = {}, seq = 1): string {
  return JSON.stringify({
    v: 1,
    ch: 'control',
    streamId: 'conv-a',
    seq,
    t: 1,
    payload: { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope, ...hello } },
  });
}

const envelopes = (channel: FakeChannel) => channel.sent.map((part) => JSON.parse(part) as SharedEnvelope);

describe('PeerHub hello and conversation content', () => {
  it('sends the host hello as the first control envelope', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.channel('control').open();
    expect(envelopes(peer.channel('control'))).toEqual([
      {
        v: 1,
        ch: 'control',
        streamId: 'conv-a',
        seq: 1,
        t: expect.any(Number),
        payload: { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope } },
      },
    ]);
  });

  it('sends no conversation content before the viewer hello, then the history as seq 1', async () => {
    const history: ConversationPayload = {
      kind: 'history',
      messages: [{ id: 'm1', role: 'user', text: 'hi', createdAt: '2026-11-03T00:00:00Z' }],
    };
    const s = setup({
      attach: async (sink: ConversationSink) => {
        sink.send(history);
        return () => undefined;
      },
    });
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('conversation').open();
    await settle();
    expect(s.bridge.attach).not.toHaveBeenCalled();
    expect(peer.channel('conversation').sent).toEqual([]);

    peer.channel('control').onMessage.emit(viewerHello());
    await settle();
    expect(s.bridge.attach).toHaveBeenCalledTimes(1);
    expect(envelopes(peer.channel('conversation'))).toEqual([
      { v: 1, ch: 'conversation', streamId: 'conv-a', seq: 1, t: expect.any(Number), payload: history },
    ]);

    peer.channel('control').onMessage.emit(viewerHello({}, 2));
    await settle();
    expect(s.bridge.attach).toHaveBeenCalledTimes(1);
    expect(peer.channel('control').sent).toHaveLength(1);
  });

  it('attaches when the conversation channel opens after the hello negotiated', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('control').onMessage.emit(viewerHello());
    expect(s.bridge.attach).not.toHaveBeenCalled();
    peer.channel('conversation').open();
    expect(s.bridge.attach).toHaveBeenCalledTimes(1);
  });

  it('answers a failed negotiation with a control error and never attaches', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('conversation').open();
    peer.channel('control').onMessage.emit(viewerHello({ scopeKinds: [] }));
    peer.channel('control').onMessage.emit(viewerHello({}, 2));
    await settle();
    expect(envelopes(peer.channel('control')).map((e) => e.payload)).toEqual([
      { kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope } },
      { kind: 'error', code: 'scope_kind_unsupported' },
    ]);
    expect(s.bridge.attach).not.toHaveBeenCalled();
  });

  it('ignores a binary control message and a control message that is not a hello', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('conversation').open();
    peer.channel('control').onMessage.emit(Buffer.from(viewerHello()));
    peer.channel('control').onMessage.emit('not json');
    await settle();
    expect(s.bridge.attach).not.toHaveBeenCalled();
    expect(peer.channel('control').sent).toHaveLength(1);
  });

  it('sends unavailable history_too_large when the history is over the envelope limit', async () => {
    const s = setup({
      attach: async (sink: ConversationSink) => {
        sink.send({
          kind: 'history',
          messages: [{ id: 'm1', role: 'user', text: 'a'.repeat(33 * 1024 * 1024), createdAt: '2026-11-03T00:00:00Z' }],
        });
        return () => undefined;
      },
    });
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('conversation').open();
    peer.channel('control').onMessage.emit(viewerHello());
    await settle();
    expect(envelopes(peer.channel('conversation'))).toEqual([
      {
        v: 1,
        ch: 'conversation',
        streamId: 'conv-a',
        seq: 1,
        t: expect.any(Number),
        payload: { kind: 'unavailable', reason: 'history_too_large' },
      },
    ]);
  });

  it('detaches the conversation when the peer closes', async () => {
    const detach = vi.fn();
    const s = setup({ attach: async () => detach });
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('conversation').open();
    peer.channel('control').onMessage.emit(viewerHello());
    await settle();
    s.hub.remove(7);
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('never writes to or reads from terminal', async () => {
    const s = setup();
    const peer = await connected(s);
    for (const channel of peer.channels) channel.open();
    peer.channel('control').onMessage.emit(viewerHello());
    await settle();
    expect(peer.channel('drafts').sent).toEqual([]);
    expect(peer.channel('terminal').sent).toEqual([]);
    expect(peer.channels.map((c) => [c.label, c.onMessage.subscriptions])).toEqual([
      ['control', 1],
      ['conversation', 0],
      ['drafts', 1],
      ['terminal', 0],
      ['presence', 0],
    ]);
  });

  it('ignores a control message over the 64 Ki inbound cap (NFR-3)', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('conversation').open();
    const big = viewerHello({ padding: 'x'.repeat(70_000) });
    expect(big.length).toBeGreaterThan(70_000);
    peer.channel('control').onMessage.emit(big);
    await settle();
    expect(s.bridge.attach).not.toHaveBeenCalled();
    expect(peer.channel('control').sent).toHaveLength(1);
  });
});

describe('PeerHub presence', () => {
  async function negotiatedWithPresence(s: ReturnType<typeof setup>): Promise<FakePeer> {
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('control').onMessage.emit(viewerHello());
    peer.channel('presence').open();
    return peer;
  }

  it('sends the roster with the data owner first and no connected or blocked fields', async () => {
    const s = setup();
    const peer = await negotiatedWithPresence(s);
    const sent = envelopes(peer.channel('presence'));
    expect(sent).toEqual([
      {
        v: 1,
        ch: 'presence',
        streamId: 'conv-a',
        seq: 1,
        t: expect.any(Number),
        payload: {
          controllerGithubId: 1,
          participants: [
            { githubId: 1, login: 'owner', avatarUrl: 'https://a/1', state: 'admitted', contributor: false, isHost: true },
            { githubId: 7, login: 'user7', avatarUrl: 'https://a/7', state: 'admitted', contributor: false, isHost: false },
          ],
          streams: [{ streamId: 'conv-a', label: 'Fixture conversation', kind: 'conversation', agentWorking: false, queued: 0 }],
        },
      },
    ]);
    expect(peer.channel('presence').sent[0]).not.toMatch(/"connected"|"blocked"/);
  });

  it('sends nothing for an unchanged roster and a new envelope when someone joins the lobby', async () => {
    const s = setup();
    const peer = await negotiatedWithPresence(s);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'lobby', false)));
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'lobby', true)));
    const sent = envelopes(peer.channel('presence'));
    expect(sent.map((e) => e.seq)).toEqual([1, 2]);
    const roster = (sent[1]?.payload as { participants: Array<{ githubId: number; state: string }> }).participants;
    expect(roster.map((p) => [p.githubId, p.state])).toEqual([
      [1, 'admitted'],
      [7, 'admitted'],
      [8, 'lobby'],
    ]);
  });

  it('sends no presence to a peer whose hello has not negotiated', async () => {
    const s = setup();
    const peer = await connected(s);
    peer.channel('control').open();
    peer.channel('presence').open();
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'lobby')));
    expect(peer.channel('presence').sent).toEqual([]);
  });

  it('labels the stream with the conversation name when the label lookup fails', async () => {
    const s = setup({ streamLabel: async () => Promise.reject(new Error('db down')) });
    const peer = await negotiatedWithPresence(s);
    const payload = envelopes(peer.channel('presence'))[0]?.payload as { streams: unknown };
    expect(payload.streams).toEqual([{ streamId: 'conv-a', label: 'conv-a', kind: 'conversation', agentWorking: false, queued: 0 }]);
  });
});

function viewerDraft(payload: Record<string, unknown>, seq = 1): string {
  return JSON.stringify({ v: 1, ch: 'drafts', streamId: 'conv-a', seq, t: 1, payload });
}

const draftsSent = (peer: FakePeer) => envelopes(peer.channel('drafts')).map((e) => e.payload as Record<string, unknown>);

describe('PeerHub drafts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Admits viewers 7 and 8 and brings both peers to a sent offer. */
  async function twoViewers(s: ReturnType<typeof setup>): Promise<[FakePeer, FakePeer]> {
    s.hub.admit(7);
    s.hub.admit(8);
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'admitted')));
    await settle();
    s.hub.onIceServers([]);
    await settle();
    const [seven, eight] = s.peers;
    if (!seven || !eight) throw new Error('no peers');
    return [seven, eight];
  }

  function negotiate(peer: FakePeer): void {
    peer.channel('control').open();
    peer.channel('control').onMessage.emit(viewerHello());
  }

  function ready(peer: FakePeer): void {
    negotiate(peer);
    peer.channel('drafts').open();
  }

  it('relays a draft to the other viewers with the sender\'s identity, never to the sender (FR-1)', async () => {
    const s = setup();
    const [seven, eight] = await twoViewers(s);
    ready(seven);
    ready(eight);
    seven.channel('drafts').onMessage.emit(viewerDraft({ text: 'hi', authorGithubId: 999, authorLogin: 'mallory' }));
    expect(draftsSent(eight)).toEqual([{ authorGithubId: 7, authorLogin: 'user7', text: 'hi', updatedAt: expect.any(Number) }]);
    expect(envelopes(eight.channel('drafts'))[0]?.seq).toBe(1);
    expect(seven.channel('drafts').sent).toEqual([]);
    expect(s.hub.draftsView()).toEqual([
      expect.objectContaining({ githubId: 7, login: 'user7', avatarUrl: 'https://a/7', text: 'hi' }),
    ]);
  });

  it('reads no draft before the hello negotiates', async () => {
    const s = setup();
    const [seven, eight] = await twoViewers(s);
    seven.channel('drafts').open();
    ready(eight);
    seven.channel('drafts').onMessage.emit(viewerDraft({ text: 'early' }));
    expect(s.hub.draftsView()).toEqual([]);
    expect(eight.channel('drafts').sent).toEqual([]);
  });

  it('sends a later viewer the existing drafts, minus its own, once', async () => {
    const s = setup();
    const [seven, eight] = await twoViewers(s);
    ready(seven);
    seven.channel('drafts').onMessage.emit(viewerDraft({ text: 'from seven' }));
    negotiate(eight);
    eight.channel('drafts').onMessage.emit(viewerDraft({ text: 'mine' }));
    expect(draftsSent(seven).map((p) => p.text)).toEqual(['mine']);
    eight.channel('drafts').open();
    s.hub.onSnapshot(snapshot(participant(7, 'admitted'), participant(8, 'admitted')));
    expect(draftsSent(eight).map((p) => [p.authorGithubId, p.text])).toEqual([[7, 'from seven']]);
  });

  it('relays the deletion of a draft whose author left the admitted set', async () => {
    const s = setup();
    const [seven, eight] = await twoViewers(s);
    ready(seven);
    ready(eight);
    seven.channel('drafts').onMessage.emit(viewerDraft({ text: 'hi' }));
    await vi.advanceTimersByTimeAsync(500);
    s.hub.onSnapshot(snapshot(participant(8, 'admitted')));
    expect(draftsSent(eight).map((p) => [p.authorGithubId, p.text])).toEqual([[7, 'hi'], [7, '']]);
    expect(s.hub.draftsView()).toEqual([]);
  });

  it('ignores a draft payload without a string text', async () => {
    const s = setup();
    const [seven] = await twoViewers(s);
    ready(seven);
    seven.channel('drafts').onMessage.emit(viewerDraft({ text: 5 }));
    seven.channel('drafts').onMessage.emit(Buffer.from(viewerDraft({ text: 'binary' })));
    expect(s.hub.draftsView()).toEqual([]);
  });
});

function viewerSubmit(clientId: string, text: string, seq = 2): string {
  return JSON.stringify({ v: 1, ch: 'control', streamId: 'conv-a', seq, t: 1, payload: { kind: 'submit', clientId, text } });
}

const controlPayloads = (peer: FakePeer) => envelopes(peer.channel('control')).map((e) => e.payload as Record<string, unknown>).slice(1);

describe('PeerHub prompts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const contributor = (githubId: number): RoomParticipant => ({ ...participant(githubId, 'admitted'), contributor: true });
  const owner = { githubId: 1, login: 'owner', avatarUrl: 'https://a/1' };

  /** Admits the participants and brings each peer to a sent offer, in order. */
  async function viewers(s: ReturnType<typeof setup>, ...participants: RoomParticipant[]): Promise<FakePeer[]> {
    for (const p of participants) s.hub.admit(p.githubId);
    s.hub.onSnapshot(snapshot(...participants));
    await settle();
    s.hub.onIceServers([]);
    await settle();
    return s.peers.slice();
  }

  function negotiate(peer: FakePeer): void {
    peer.channel('control').open();
    peer.channel('control').onMessage.emit(viewerHello());
  }

  it('acknowledges a contributor submit queued, then sent, and credits the author before delivery', async () => {
    const s = setup();
    const [seven] = await viewers(s, contributor(7));
    if (!seven) throw new Error('no peer');
    negotiate(seven);
    seven.channel('control').onMessage.emit(viewerSubmit('c1', 'Do it'));
    expect(controlPayloads(seven)).toEqual([{ kind: 'submit-ack', clientId: 'c1', status: 'queued', position: 1 }]);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(s.queue.deliver).toHaveBeenCalledWith('Do it');
    expect(s.bridge.expectAuthor).toHaveBeenCalledWith('Do it', { login: 'user7', avatarUrl: 'https://a/7' });
    expect(s.bridge.expectAuthor.mock.invocationCallOrder[0]).toBeLessThan(s.queue.deliver.mock.invocationCallOrder[0] ?? 0);
    expect(controlPayloads(seven).at(-1)).toEqual({ kind: 'submit-ack', clientId: 'c1', status: 'sent' });
    expect(envelopes(seven.channel('control')).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('rejects a non-contributor submit and never delivers it', async () => {
    const s = setup();
    const [seven] = await viewers(s, participant(7, 'admitted'));
    if (!seven) throw new Error('no peer');
    negotiate(seven);
    seven.channel('control').onMessage.emit(viewerSubmit('c1', 'Do it'));
    expect(controlPayloads(seven)).toEqual([{ kind: 'submit-ack', clientId: 'c1', status: 'rejected', reason: 'not_contributor' }]);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 3);
    expect(s.queue.deliver).not.toHaveBeenCalled();
  });

  it('ignores a submit before the hello and a submit with a bad client id', async () => {
    const s = setup();
    const [seven] = await viewers(s, contributor(7));
    if (!seven) throw new Error('no peer');
    seven.channel('control').open();
    seven.channel('control').onMessage.emit(viewerSubmit('c1', 'Too early', 1));
    seven.channel('control').onMessage.emit(viewerHello());
    seven.channel('control').onMessage.emit(viewerSubmit('a b', 'Bad id'));
    seven.channel('control').onMessage.emit(viewerSubmit('x'.repeat(65), 'Long id'));
    expect(controlPayloads(seven)).toEqual([]);
    expect(s.hub.queueView().items).toEqual([]);
  });

  it('ignores a repeated client id while its item is still queued', async () => {
    const s = setup({ queue: { activity: async () => ({ working: true, lastMessageId: null }) } });
    const [seven] = await viewers(s, contributor(7));
    if (!seven) throw new Error('no peer');
    negotiate(seven);
    seven.channel('control').onMessage.emit(viewerSubmit('c1', 'Do it'));
    seven.channel('control').onMessage.emit(viewerSubmit('c1', 'Do it', 3));
    expect(controlPayloads(seven)).toHaveLength(1);
    expect(s.hub.queueView().items).toHaveLength(1);
  });

  it('rejects queued items as grant_revoked when a snapshot removes the contributor grant (FR-7)', async () => {
    const s = setup({ queue: { activity: async () => ({ working: true, lastMessageId: null }) } });
    const [seven] = await viewers(s, contributor(7));
    if (!seven) throw new Error('no peer');
    negotiate(seven);
    seven.channel('control').onMessage.emit(viewerSubmit('c1', 'Do it'));
    s.hub.onSnapshot(snapshot(participant(7, 'admitted')));
    expect(controlPayloads(seven).at(-1)).toEqual({ kind: 'submit-ack', clientId: 'c1', status: 'rejected', reason: 'grant_revoked' });
    expect(s.hub.queueView().items).toEqual([]);
  });

  it('carries agentWorking and queued in presence after the status changes (FR-10)', async () => {
    const s = setup({ queue: { activity: async () => ({ working: true, lastMessageId: null }) } });
    const [seven] = await viewers(s, contributor(7));
    if (!seven) throw new Error('no peer');
    negotiate(seven);
    seven.channel('presence').open();
    seven.channel('control').onMessage.emit(viewerSubmit('c1', 'One'));
    seven.channel('control').onMessage.emit(viewerSubmit('c2', 'Two', 3));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    const last = envelopes(seven.channel('presence')).at(-1)?.payload as { streams: Array<Record<string, unknown>> };
    expect(last.streams[0]).toMatchObject({ agentWorking: true, queued: 2 });
  });

  it('sends a picked draft for its author: draft-sent to the author, deletion to the others', async () => {
    const s = setup();
    const [seven, eight] = await viewers(s, participant(7, 'admitted'), participant(8, 'admitted'));
    if (!seven || !eight) throw new Error('no peers');
    for (const peer of [seven, eight]) {
      negotiate(peer);
      peer.channel('drafts').open();
    }
    seven.channel('drafts').onMessage.emit(viewerDraft({ text: 'from seven' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(s.hub.sendFromController({ text: 'edited', draftGithubId: 7 }, owner)).toEqual({ ok: true, position: 1 });
    expect(controlPayloads(seven)).toEqual([{ kind: 'draft-sent' }]);
    expect(draftsSent(eight).map((p) => p.text)).toEqual(['from seven', '']);
    expect(s.hub.queueView().items).toEqual([expect.objectContaining({ login: 'user7', source: 'controller', text: 'edited' })]);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(s.bridge.expectAuthor).toHaveBeenCalledWith('edited', { login: 'user7', avatarUrl: 'https://a/7' });
    expect(s.queue.deliver).toHaveBeenCalledWith('edited');
  });

  it('refuses a controller command prefix and keeps the picked draft', async () => {
    const s = setup();
    const [seven] = await viewers(s, participant(7, 'admitted'));
    if (!seven) throw new Error('no peer');
    negotiate(seven);
    seven.channel('drafts').onMessage.emit(viewerDraft({ text: 'keep me' }));
    expect(s.hub.sendFromController({ text: '!rm' }, owner)).toEqual({ ok: false, reason: 'invalid_prompt' });
    expect(s.hub.sendFromController({ text: '/clear', draftGithubId: 7 }, owner)).toEqual({ ok: false, reason: 'invalid_prompt' });
    expect(s.hub.draftsView().map((d) => d.text)).toEqual(['keep me']);
    expect(controlPayloads(seven)).toEqual([]);
  });

  it('credits a controller send without a draft to the data owner', async () => {
    const s = setup();
    expect(s.hub.sendFromController({ text: 'From the host' }, owner)).toEqual({ ok: true, position: 1 });
    expect(s.hub.queueView().items).toEqual([expect.objectContaining({ login: 'owner', source: 'controller' })]);
  });
});
