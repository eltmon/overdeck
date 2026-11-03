import type { HostFrame, RoomParticipant, RoomSnapshot, ShareScope, SignalData } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ICE_SERVERS_CACHE_MS,
  ICE_SERVERS_TIMEOUT_MS,
  PeerHub,
  type HubDataChannel,
  type HubPeerConnection,
  type PeerHubDeps,
} from '../peer-hub.js';

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

/** Lets the hub's promise chains (ICE wait, label, offer) run; setImmediate stays real. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(
  options: {
    sendFrame?: (frame: HostFrame) => boolean;
    streamLabel?: () => Promise<string>;
    onPeer?: (peer: FakePeer) => void;
  } = {},
) {
  const frames: HostFrame[] = [];
  const peers: FakePeer[] = [];
  const bridge = { attach: vi.fn(async () => () => undefined), close: vi.fn() };
  const deps: PeerHubDeps = {
    createPeerConnection: (config) => {
      const peer = new FakePeer(config);
      options.onPeer?.(peer);
      peers.push(peer);
      return peer;
    },
    bridge,
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
  const ofType = <T extends HostFrame['type']>(type: T) =>
    frames.filter((frame): frame is Extract<HostFrame, { type: T }> => frame.type === type);
  return { hub, frames, peers, bridge, ofType };
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
