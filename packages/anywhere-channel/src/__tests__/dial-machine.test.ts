/** PAN-4833 WI-9: the machine dialer over fake peer connections, a fake directory and fake timers. */
import type { ClientToDirectoryFrame, DirectoryToClientFrame, SignalData } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ClientSignaling, createMachineDialer } from '../dial-machine.js';
import { RtcDuplexWeb } from '../rtc-duplex-web.js';

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType: BinaryType = 'blob';
  closed = false;

  constructor(
    readonly label: string,
    readonly init: RTCDataChannelInit | undefined,
  ) {
    super();
  }

  open(): void {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }

  send(): void {}

  close(): void {
    this.closed = true;
    this.readyState = 'closed';
  }
}

class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = [];
  /** Candidates to emit while the local description is being set (before the offer goes out). */
  static earlyCandidates: RTCIceCandidateInit[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  readonly channels: FakeDataChannel[] = [];
  readonly remoteCandidates: RTCIceCandidateInit[] = [];
  closed = false;

  constructor(readonly config: RTCConfiguration) {
    super();
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(label: string, init?: RTCDataChannelInit): FakeDataChannel {
    const channel = new FakeDataChannel(label, init);
    this.channels.push(channel);
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0 offer' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    for (const candidate of FakePeerConnection.earlyCandidates) this.emitCandidate(candidate);
    this.localDescription = description;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.remoteCandidates.push(candidate);
  }

  emitCandidate(candidate: RTCIceCandidateInit): void {
    this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate }));
  }

  setState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.dispatchEvent(new Event('connectionstatechange'));
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }
}

type SignalFrame = Extract<ClientToDirectoryFrame, { type: 'signal' }>;

function fakeDirectory() {
  const sent: ClientToDirectoryFrame[] = [];
  const handlers = new Map<string, Set<(frame: DirectoryToClientFrame) => void>>();
  const directory = {
    send: (frame: ClientToDirectoryFrame) => {
      sent.push(frame);
      return true;
    },
    on: (type: string, handler: (frame: DirectoryToClientFrame) => void) => {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => set.delete(handler);
    },
    iceServers: vi.fn(async () => [{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' }]),
  };
  return {
    directory: directory as unknown as ClientSignaling,
    iceServers: directory.iceServers,
    signals: () => sent.filter((f): f is SignalFrame => f.type === 'signal'),
    emit: (frame: DirectoryToClientFrame) => {
      for (const handler of [...(handlers.get(frame.type) ?? [])]) handler(frame);
    },
  };
}

function answer(from: string, session: string, data: SignalData = { sdp: { type: 'answer', sdp: 'v=0 answer' } }): DirectoryToClientFrame {
  return { type: 'signal', from, session, purpose: 'link', relay: false, data };
}

/** Let the dialer's awaited promises run. */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

function setup() {
  const dir = fakeDirectory();
  const dialer = createMachineDialer(dir.directory, { RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection });
  return { ...dir, dialer };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakePeerConnection.instances = [];
  FakePeerConnection.earlyCandidates = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createMachineDialer', () => {
  it('sends one offer with a fresh session and resolves with an RtcDuplexWeb when the channel opens', async () => {
    const { dialer, signals, emit, iceServers } = setup();
    const dialing = dialer.dialMachine('env-1', { relay: true });
    await flush();

    expect(iceServers).toHaveBeenCalledWith(true);
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.config.iceTransportPolicy).toBe('relay');
    expect(pc.channels.map((c) => [c.label, c.init?.ordered])).toEqual([['ovdl', true]]);
    const [offer] = signals();
    expect(signals()).toHaveLength(1);
    expect(offer).toMatchObject({ to: 'env-1', purpose: 'link', relay: true, data: { sdp: { type: 'offer', sdp: 'v=0 offer' } } });
    expect(offer!.session).toMatch(/^[0-9a-f]{32}$/);

    emit(answer('env-1', offer!.session));
    await flush();
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    pc.channels[0]!.open();
    expect(await dialing).toBeInstanceOf(RtcDuplexWeb);
  });

  it('uses every route but relay-only when relay is false', async () => {
    const { dialer } = setup();
    void dialer.dialMachine('env-1', { relay: false }).catch(() => {});
    await flush();
    expect(FakePeerConnection.instances[0]!.config.iceTransportPolicy).toBe('all');
    dialer.close();
  });

  it('sends candidates gathered before the offer after it', async () => {
    const { dialer, signals } = setup();
    FakePeerConnection.earlyCandidates = [{ candidate: 'candidate:1 1 udp 1 10.0.0.2 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 }];
    void dialer.dialMachine('env-1', { relay: false }).catch(() => {});
    await flush();
    expect(signals().map((s) => Object.keys(s.data))).toEqual([['sdp'], ['candidate']]);
    expect(signals()[1]!.data.candidate).toEqual({ candidate: 'candidate:1 1 udp 1 10.0.0.2 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 });
    dialer.close();
  });

  it('queues remote candidates until the answer and ignores an answer from another machine', async () => {
    const { dialer, signals, emit } = setup();
    void dialer.dialMachine('env-1', { relay: false }).catch(() => {});
    await flush();
    const pc = FakePeerConnection.instances[0]!;
    const session = signals()[0]!.session;

    emit(answer('env-2', session));
    emit(answer('env-1', session, { candidate: { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 } }));
    await flush();
    expect(pc.remoteDescription).toBeNull();
    expect(pc.remoteCandidates).toEqual([]);

    emit(answer('env-1', session));
    await flush();
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    expect(pc.remoteCandidates).toEqual([{ candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 }]);
    dialer.close();
  });

  it('opens a second ovdl channel on the one peer connection for a second dial', async () => {
    const { dialer } = setup();
    const first = dialer.dialMachine('env-1', { relay: false });
    const second = dialer.dialMachine('env-1', { relay: false });
    await flush();
    expect(FakePeerConnection.instances).toHaveLength(1);
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.channels.map((c) => c.label)).toEqual(['ovdl', 'ovdl']);
    for (const channel of pc.channels) channel.open();
    expect(await first).toBeInstanceOf(RtcDuplexWeb);
    expect(await second).toBeInstanceOf(RtcDuplexWeb);
  });

  it('creates a new peer connection after the old one reports failed', async () => {
    const { dialer } = setup();
    const first = dialer.dialMachine('env-1', { relay: false });
    await flush();
    FakePeerConnection.instances[0]!.channels[0]!.open();
    await first;
    FakePeerConnection.instances[0]!.setState('failed');
    expect(FakePeerConnection.instances[0]!.closed).toBe(true);

    void dialer.dialMachine('env-1', { relay: false }).catch(() => {});
    await flush();
    expect(FakePeerConnection.instances).toHaveLength(2);
    dialer.close();
  });

  it('rejects the pending dial on an error frame for its session', async () => {
    const { dialer, signals, emit } = setup();
    const dialing = dialer.dialMachine('env-1', { relay: false }).catch((e: unknown) => e);
    await flush();
    const session = signals()[0]!.session;
    emit({ type: 'error', code: 'peer_offline', message: 'That machine is offline', session });
    const error = await dialing;
    expect((error as Error).message).toBe('That machine is offline');
    expect(FakePeerConnection.instances[0]!.closed).toBe(true);
  });

  it('rejects a dial to a silent machine after 15 s', async () => {
    const { dialer } = setup();
    const dialing = dialer.dialMachine('env-1', { relay: false }).catch((e: unknown) => e);
    await flush();
    await vi.advanceTimersByTimeAsync(14_999);
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await dialing).toBeInstanceOf(Error);
    expect(pc.channels[0]!.closed).toBe(true);
    expect(pc.closed).toBe(true);
  });

  it('rejects with an AbortError when the caller aborts', async () => {
    const { dialer } = setup();
    const controller = new AbortController();
    const dialing = dialer.dialMachine('env-1', { relay: false, signal: controller.signal }).catch((e: unknown) => e);
    await flush();
    controller.abort();
    expect(((await dialing) as Error).name).toBe('AbortError');
  });
});
