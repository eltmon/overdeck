/**
 * Two in-process RtcTransports joined by an in-memory signalling hub, connecting over loopback host
 * candidates (PAN-2356 WI-10). Real timers: the subject is real UDP I/O, so no faked clock gates it.
 */
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
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
  const port = (self: string): RtcSignalingPort => ({
    send(to, session, purpose, relay, data) {
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
    iceServers: async (relay) => {
      iceRelays.push(relay);
      return [];
    },
  });
  return { port, iceRelays };
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
