/** PAN-4833 WI-9: the machine dialer over fake peer connections, a fake directory and fake timers. */
import { createRequire } from 'node:module';

import type { ClientToDirectoryFrame, DirectoryToClientFrame, SignalData } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ClientSignaling, createMachineDialer, DISCONNECT_GRACE_MS, ICE_RESTART_TIMEOUT_MS } from '../dial-machine.js';
import { ChannelOpenError } from '../initiator.js';
import type { StaticKeyPair } from '../noise.js';
import { RtcDuplexWeb } from '../rtc-duplex-web.js';
import { openSecureChannel } from '../secure-channel-web.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): StaticKeyPair };

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
  signalingState: RTCSignalingState = 'stable';
  /** The options of every createOffer call. */
  readonly offers: Array<RTCOfferOptions | undefined> = [];
  /** setRemoteDescription and addIceCandidate calls, in order. */
  readonly calls: string[] = [];
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

  async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    this.offers.push(options);
    return { type: 'offer', sdp: options?.iceRestart ? 'v=0 restart offer' : 'v=0 offer' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    for (const candidate of FakePeerConnection.earlyCandidates) this.emitCandidate(candidate);
    this.localDescription = description;
    if (description.type === 'offer') this.signalingState = 'have-local-offer';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.calls.push(`remote:${description.type}`);
    this.remoteDescription = description;
    if (description.type === 'answer') this.signalingState = 'stable';
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.calls.push(`candidate:${candidate.candidate}`);
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
  const logs: string[] = [];
  const dialer = createMachineDialer(dir.directory, {
    RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection,
    log: (message) => logs.push(message),
  });
  return { ...dir, dialer, logs };
}

/** Dial and open the first channel; resolves with the raw channel. */
async function openRaw(dialer: ReturnType<typeof setup>['dialer'], environmentId: string): Promise<RtcDuplexWeb> {
  const dialing = dialer.dialMachine(environmentId, { relay: false });
  await flush();
  FakePeerConnection.instances.at(-1)!.channels.at(-1)!.open();
  return dialing;
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
    // Closing the connection ends the raw channel with an error.
    (await first).on('error', () => {});
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

  it('ends every open raw channel with an error when the dialer closes its peer connection', async () => {
    const { dialer } = setup();
    const raw = await openRaw(dialer, 'env-1');
    const events: string[] = [];
    let error: unknown;
    raw.on('error', (e: unknown) => {
      events.push('error');
      error = e;
    });
    raw.on('close', () => events.push('close'));

    dialer.close('env-1');
    await flush();

    expect(events).toEqual(['error', 'close']);
    expect(raw.destroyed).toBe(true);
    expect((error as Error).message).toBe('direct connection closed: dialer closed');
    expect(FakePeerConnection.instances[0]!.channels[0]!.closed).toBe(true);
  });

  it('a handshake running on a closed connection fails as unreachable', async () => {
    const { dialer } = setup();
    const raw = await openRaw(dialer, 'env-1');
    const opening = openSecureChannel(raw, {
      mode: 'link',
      localKey: dh.generateKeyPair(),
      remoteKeyHex: Buffer.from(dh.generateKeyPair().publicKey).toString('hex'),
    }).catch((e: unknown) => e);
    await flush();

    dialer.close('env-1');
    await flush();

    const error = await opening;
    expect(error).toBeInstanceOf(ChannelOpenError);
    expect((error as ChannelOpenError).code).toBe('unreachable');
    // Rejected on the close, not by the 10 s open deadline.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs one line per closed connection with shortened ids and no SDP', async () => {
    const { dialer, logs } = setup();
    (await openRaw(dialer, '933e853d-6c1a-4f7e-9d2b-1a2b3c4d5e6f')).on('error', () => {});

    dialer.close();
    dialer.close();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^rtc [0-9a-f-]{8} closing session [0-9a-f]{8}: dialer closed$/);
    expect(logs.some((line) => line.includes('v=0'))).toBe(false);
  });

  it('evict closes only the owning connection while it is current', async () => {
    const { dialer } = setup();
    const stale = await openRaw(dialer, 'env-1');
    stale.on('error', () => {});
    FakePeerConnection.instances[0]!.setState('failed');
    const current = await openRaw(dialer, 'env-1');
    current.on('error', () => {});
    const relayDial = dialer.dialMachine('env-1', { relay: true });
    await flush();
    FakePeerConnection.instances[2]!.channels[0]!.open();
    (await relayDial).on('error', () => {});
    const [, directPc, relayPc] = FakePeerConnection.instances;

    // A late failure on the replaced connection leaves the current one alone.
    dialer.evict(stale, 'secure open timeout');
    expect(directPc!.closed).toBe(false);

    // The current owner closes; the machine's other connection stays open.
    dialer.evict(current, 'secure open timeout');
    await flush();
    expect(directPc!.closed).toBe(true);
    expect(current.destroyed).toBe(true);
    expect(relayPc!.closed).toBe(false);

    // A new dial builds a fresh connection.
    void dialer.dialMachine('env-1', { relay: false }).catch(() => {});
    await flush();
    expect(FakePeerConnection.instances).toHaveLength(4);
    dialer.close();
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

describe('ICE restart on a disconnected connection (PAN-5046 FR-4, FR-5)', () => {
  /** A dial that went all the way to `connected`; returns the connection and its session. */
  async function connected(ctx: ReturnType<typeof setup>) {
    const dialing = ctx.dialer.dialMachine('env-1', { relay: false });
    await flush();
    const pc = FakePeerConnection.instances.at(-1)!;
    const session = ctx.signals().at(-1)!.session;
    ctx.emit(answer('env-1', session));
    await flush();
    pc.channels[0]!.open();
    const raw = await dialing;
    raw.on('error', () => {});
    pc.setState('connected');
    return { pc, session, raw };
  }

  const offers = (ctx: ReturnType<typeof setup>) => ctx.signals().filter((s) => s.data.sdp?.type === 'offer');

  it('reuses a disconnected connection instead of sending a new offer', async () => {
    const ctx = setup();
    const { pc } = await connected(ctx);
    pc.setState('disconnected');

    void ctx.dialer.dialMachine('env-1', { relay: false }).catch(() => {});
    await flush();

    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(pc.closed).toBe(false);
    expect(pc.channels).toHaveLength(2);
    expect(offers(ctx)).toHaveLength(1);
    ctx.dialer.close();
  });

  it('sends one ice-restart offer on the same session after 2 s of disconnected', async () => {
    const ctx = setup();
    const { pc, session } = await connected(ctx);
    pc.setState('disconnected');
    expect(ctx.logs).toContain('rtc env-1 disconnected; ice restart in 2000 ms');

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS - 1);
    expect(offers(ctx)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(offers(ctx)).toHaveLength(2);
    expect(offers(ctx)[1]).toMatchObject({ session, data: { sdp: { type: 'offer', sdp: 'v=0 restart offer' } } });
    expect(pc.offers.at(-1)).toEqual({ iceRestart: true });
    expect(ctx.logs).toContain('rtc env-1 ice restart sent');

    // Still disconnected while the restart runs: no second offer.
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    expect(offers(ctx)).toHaveLength(2);
    ctx.dialer.close();
  });

  it('applies the restart answer and keeps the connection when it reconnects', async () => {
    const ctx = setup();
    const { pc, session, raw } = await connected(ctx);
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    ctx.emit(answer('env-1', session, { sdp: { type: 'answer', sdp: 'v=0 restart answer' } }));
    await flush();
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 restart answer' });
    pc.setState('connected');

    expect(ctx.logs).toContain('rtc env-1 ice restart recovered');
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
    expect(pc.closed).toBe(false);
    expect(raw.destroyed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    ctx.dialer.close();
  });

  it('closes the connection when the restart does not reconnect within 10 s', async () => {
    const ctx = setup();
    const { pc, session } = await connected(ctx);
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS - 1);
    expect(pc.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(pc.closed).toBe(true);
    expect(ctx.logs).toContain('rtc env-1 ice restart timed out; closing');
    expect(ctx.logs).toContain(`rtc env-1 closing session ${session.slice(0, 8)}: ice restart timed out`);

    void ctx.dialer.dialMachine('env-1', { relay: false }).catch(() => {});
    await flush();
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(offers(ctx)).toHaveLength(3);
    expect(offers(ctx)[2]!.session).not.toBe(session);
    ctx.dialer.close();
  });

  it('ignores an answer outside have-local-offer', async () => {
    const ctx = setup();
    const { pc, session } = await connected(ctx);
    expect(pc.signalingState).toBe('stable');

    ctx.emit(answer('env-1', session, { sdp: { type: 'answer', sdp: 'v=0 stray answer' } }));
    await flush();

    expect(pc.calls.filter((call) => call.startsWith('remote:'))).toEqual(['remote:answer']);
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    ctx.dialer.close();
  });

  it('queues server candidates that arrive before the restart answer and resolves restartIce on connected', async () => {
    const ctx = setup();
    const { pc, session } = await connected(ctx);
    let resolved = false;
    const restarting = ctx.dialer.restartIce('env-1').then(() => (resolved = true));
    await flush();
    expect(offers(ctx)).toHaveLength(2);
    expect(offers(ctx)[1]!.session).toBe(session);
    pc.setState('disconnected');

    ctx.emit(answer('env-1', session, { candidate: { candidate: 'candidate:new-generation', sdpMid: '0', sdpMLineIndex: 0 } }));
    await flush();
    expect(pc.calls).toEqual(['remote:answer']);

    ctx.emit(answer('env-1', session, { sdp: { type: 'answer', sdp: 'v=0 restart answer' } }));
    await flush();
    expect(pc.calls).toEqual(['remote:answer', 'remote:answer', 'candidate:candidate:new-generation']);
    expect(resolved).toBe(false);

    pc.setState('connected');
    await restarting;
    expect(resolved).toBe(true);
    expect(pc.closed).toBe(false);
    ctx.dialer.close();
  });

  it('rejects restartIce when the restart times out', async () => {
    const ctx = setup();
    await connected(ctx);
    const restarting = ctx.dialer.restartIce('env-1').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
    expect(((await restarting) as Error).message).toBe('ice restart timed out');
  });
});
