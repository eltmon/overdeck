/**
 * Two in-process RtcTransports joined by an in-memory signalling hub, connecting over loopback host
 * candidates (PAN-2356 WI-10). Real timers: the subject is real UDP I/O, so no faked clock gates it.
 */
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SignalData } from '@overdeck/contracts';

import { RtcDialAbortedError, type RtcPurpose, type RtcSignalingPort, RtcTransport } from '../rtc-transport.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

type SignalHandler = (from: string, session: string, purpose: RtcPurpose, relay: boolean, data: SignalData) => void;

/** Delivers each signal on a later turn, stamping `from` the way the directory does. */
function hub() {
  const handlers = new Map<string, Set<SignalHandler>>();
  /** The `relay` argument of every `iceServers` call, in order. */
  const iceRelays: boolean[] = [];
  /** Every frame sent through the hub, in order. */
  const sent: Array<{ from: string; to: string; session: string; data: SignalData }> = [];
  /** Hand a frame straight to `to`'s handlers, as the directory would. */
  const deliver = (to: string, from: string, session: string, purpose: RtcPurpose, relay: boolean, data: SignalData): void => {
    for (const handler of handlers.get(to) ?? []) handler(from, session, purpose, relay, data);
  };
  const port = (self: string, iceServers?: RtcSignalingPort['iceServers']): RtcSignalingPort => ({
    send(to, session, purpose, relay, data) {
      sent.push({ from: self, to, session, data });
      setImmediate(() => {
        for (const handler of handlers.get(to) ?? []) handler(self, session, purpose, relay, data);
      });
    },
    onSignal(handler) {
      let set = handlers.get(self);
      if (!set) handlers.set(self, (set = new Set()));
      set.add(handler);
      return () => set.delete(handler);
    },
    iceServers: iceServers ?? (async (relay) => {
      iceRelays.push(relay);
      return [];
    }),
  });
  return { port, iceRelays, sent, deliver };
}

function readBytes(stream: Duplex, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.byteLength;
      if (total >= count) {
        stream.off('data', onData);
        resolve(Buffer.concat(chunks));
      }
    };
    stream.on('data', onData);
    stream.once('error', reject);
  });
}

const transports: RtcTransport[] = [];
afterEach(() => {
  for (const t of transports.splice(0)) t.close();
});

function pair() {
  const h = hub();
  const incoming: Array<{ raw: Duplex; purpose: RtcPurpose; from: string; relay: boolean }> = [];
  const waiters: Array<() => void> = [];
  const a = new RtcTransport(h.port(A), () => undefined);
  const b = new RtcTransport(h.port(B), (raw, purpose, from, relay) => {
    incoming.push({ raw, purpose, from, relay });
    for (const w of waiters.splice(0)) w();
  });
  transports.push(a, b);
  const nextIncoming = async (index: number) => {
    while (incoming.length <= index) await new Promise<void>((resolve) => waiters.push(resolve));
    return incoming[index]!;
  };
  return { a, b, nextIncoming };
}

describe('RtcTransport (PAN-2356 WI-10)', () => {
  it('dials a peer and round-trips 10 bytes over the data channel', async () => {
    const { a, nextIncoming } = pair();
    const raw = await a.dial(B, { relay: false, purpose: 'link', signal: new AbortController().signal });
    const accepted = await nextIncoming(0);
    expect(accepted).toMatchObject({ purpose: 'link', from: A, relay: false });
    expect((raw as Duplex & { remoteAddress: string }).remoteAddress).toBe('rtc:0000000000004000');

    const ping = Buffer.from('0123456789');
    raw.write(ping);
    expect(await readBytes(accepted.raw, 10)).toEqual(ping);
    accepted.raw.write(Buffer.from('9876543210'));
    expect((await readBytes(raw, 10)).toString()).toBe('9876543210');
  }, 20_000);

  // A relay dial would reach a real TURN server, so only the direct branch is dialled here; the relay
  // list itself is covered by relay-ice-servers.test.ts.
  it('asks both ends for the direct list on a direct dial and still connects', async () => {
    const h = hub();
    const incoming: Duplex[] = [];
    const a = new RtcTransport(h.port(A), () => undefined);
    const b = new RtcTransport(h.port(B), (raw) => incoming.push(raw));
    transports.push(a, b);
    const raw = await a.dial(B, { relay: false, purpose: 'link', signal: new AbortController().signal });
    while (incoming.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.iceRelays).toEqual([false, false]);
    raw.write(Buffer.from('direct'));
    expect((await readBytes(incoming[0]!, 6)).toString()).toBe('direct');
  }, 20_000);

  it('carries 1 MiB written in one write intact in under 5 s', async () => {
    const { a, nextIncoming } = pair();
    const raw = await a.dial(B, { relay: false, purpose: 'link', signal: new AbortController().signal });
    const accepted = await nextIncoming(0);
    const payload = randomBytes(1024 * 1024);
    const started = Date.now();
    const received = readBytes(accepted.raw, payload.byteLength);
    raw.write(payload);
    const got = await received;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(got.equals(payload)).toBe(true);
  }, 20_000);

  it('shares one peer connection between two dials to the same peer', async () => {
    const { a, b, nextIncoming } = pair();
    const signal = new AbortController().signal;
    const [one, two] = await Promise.all([
      a.dial(B, { relay: false, purpose: 'link', signal }),
      a.dial(B, { relay: false, purpose: 'link', signal }),
    ]);
    await nextIncoming(1);
    expect(a.peerConnectionCount()).toBe(1);
    expect(b.peerConnectionCount()).toBe(1);
    expect(one).not.toBe(two);
    expect(one.destroyed || two.destroyed).toBe(false);
  }, 20_000);

  it('lets the responder dial back over the same connection, and the initiator accepts it', async () => {
    const h = hub();
    const incomingA: Duplex[] = [];
    const incomingB: Duplex[] = [];
    const a = new RtcTransport(h.port(A), (raw) => incomingA.push(raw));
    const b = new RtcTransport(h.port(B), (raw) => incomingB.push(raw));
    transports.push(a, b);
    const signal = new AbortController().signal;
    await a.dial(B, { relay: false, purpose: 'link', signal });
    while (incomingB.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    // B now holds A's connection as its responder entry; dialing A reuses it.
    const back = await b.dial(A, { relay: false, purpose: 'link', signal });
    while (incomingA.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(a.peerConnectionCount()).toBe(1);
    expect(b.peerConnectionCount()).toBe(1);
    back.write(Buffer.from('hello A'));
    expect((await readBytes(incomingA[0]!, 7)).toString()).toBe('hello A');
  }, 20_000);

  it('rejects a dial whose signal aborts before the connection opens', async () => {
    const { a } = pair();
    const controller = new AbortController();
    const dial = a.dial(B, { relay: false, purpose: 'link', signal: controller.signal });
    controller.abort();
    await expect(dial).rejects.toBeInstanceOf(RtcDialAbortedError);
    expect(a.peerConnectionCount()).toBe(0);
  }, 20_000);

  it('ends the far side when one side destroys its stream', async () => {
    const { a, nextIncoming } = pair();
    const raw = await a.dial(B, { relay: false, purpose: 'link', signal: new AbortController().signal });
    const accepted = await nextIncoming(0);
    const closed = new Promise<void>((resolve) => accepted.raw.once('close', () => resolve()));
    raw.destroy();
    await closed;
    expect(accepted.raw.destroyed).toBe(true);
  }, 20_000);
});

describe('RtcTransport diagnostics (PAN-5018 FR-6)', () => {
  const C = 'cccccccc-0000-4000-8000-00000000000c';

  function loggedPair(bIceServers?: RtcSignalingPort['iceServers']) {
    const h = hub();
    const aLogs = { log: vi.fn(), debug: vi.fn() };
    const bLogs = { log: vi.fn(), debug: vi.fn() };
    const incoming: Duplex[] = [];
    const a = new RtcTransport(h.port(A), () => undefined, aLogs);
    const b = new RtcTransport(h.port(B, bIceServers), (raw) => incoming.push(raw), bLogs);
    transports.push(a, b);
    const lines = (logs: { log: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> }): string[] =>
      [...logs.log.mock.calls, ...logs.debug.mock.calls].map(([line]) => line as string);
    return { h, a, b, aLogs, bLogs, incoming, lines };
  }

  it('logs the offer and the answer for an accepted dial', async () => {
    const { a, bLogs, incoming } = loggedPair();
    await a.dial(B, { relay: false, purpose: 'link', signal: new AbortController().signal });
    await vi.waitFor(() => expect(incoming).toHaveLength(1));
    const lines = bLogs.log.mock.calls.map(([line]) => line as string);
    expect(lines).toContainEqual(expect.stringMatching(/^rtc offer from 00000000 session [0-9a-f]{8} \(link, direct\)$/));
    expect(lines).toContainEqual(expect.stringMatching(/^rtc session [0-9a-f]{8} answered$/));
  }, 20_000);

  it('logs the failing step when ICE servers cannot be fetched', async () => {
    const { a, bLogs } = loggedPair(async () => {
      throw new Error('no directory');
    });
    const controller = new AbortController();
    const dialed = a.dial(B, { relay: false, purpose: 'link', signal: controller.signal }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(bLogs.log).toHaveBeenCalledWith(expect.stringMatching(/failed at ice-servers: no directory$/)));
    controller.abort();
    expect(await dialed).toBeInstanceOf(RtcDialAbortedError);
  }, 20_000);

  it('logs a dropped offer whose session belongs to another peer', async () => {
    const { h, a, bLogs, incoming } = loggedPair();
    await a.dial(B, { relay: false, purpose: 'link', signal: new AbortController().signal });
    await vi.waitFor(() => expect(incoming).toHaveLength(1));
    const offer = h.sent.find((frame) => frame.from === A && frame.data.sdp?.type === 'offer')!;
    h.deliver(B, C, offer.session, 'link', false, offer.data);
    await vi.waitFor(() =>
      expect(bLogs.log).toHaveBeenCalledWith(`rtc offer dropped: session ${offer.session.slice(0, 8)} belongs to 00000000, not cccccccc`),
    );
  }, 20_000);

  it('logs a candidate for an unknown session through debug only', async () => {
    const { h, bLogs } = loggedPair();
    h.deliver(B, A, 'f'.repeat(32), 'link', false, { candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
    await vi.waitFor(() => expect(bLogs.debug).toHaveBeenCalledWith('rtc candidate dropped: unknown session ffffffff from 00000000'));
    expect(bLogs.log).not.toHaveBeenCalled();
  });

  it('never logs SDP or candidate text', async () => {
    const { a, aLogs, bLogs, incoming, lines } = loggedPair();
    await a.dial(B, { relay: false, purpose: 'link', signal: new AbortController().signal });
    await vi.waitFor(() => expect(incoming).toHaveLength(1));
    const all = [...lines(aLogs), ...lines(bLogs)];
    expect(all.length).toBeGreaterThan(0);
    for (const line of all) {
      expect(line).not.toContain('v=0');
      expect(line).not.toContain('a=');
      expect(line).not.toContain('candidate:');
    }
  }, 20_000);
});
