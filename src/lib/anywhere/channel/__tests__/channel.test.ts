/**
 * PAN-4645 WI-2: secure channel core over real loopback TCP between two
 * in-process endpoints, plus the wire-format encoders.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import { connect as netConnect, createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import { duplexPair, type Duplex } from 'node:stream';

import { WebSocket as WsClient, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approvalCommitment,
  approvalNonce,
  approvalSas,
  encodeFrame,
  encodePreamble,
  encodeRefusal,
  FrameReader,
  type HandshakeResult,
  MAX_HANDSHAKE_FRAME,
  pairingSecrets,
  parsePreambleHead,
  prologueFor,
  REFUSAL_CODES,
  xxInitiator,
} from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';
import type { MachineKeyPair } from '../../machine-key.js';
import { acceptChannel, type AcceptChannelOptions } from '../accept.js';
import { type ChannelSocket, createChannelSocket, isChannelSocket } from '../channel-socket.js';
import { FLY_INSTANCE_PARAM, openChannel } from '../open.js';

// A wss:// dial needs TLS; this wrapper sends it to a plain local ws server so
// the tests can read the real upgrade request (PAN-4652 WI-4). ws:// dials pass through.
vi.mock('ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ws')>();
  class PlainWebSocket extends actual.WebSocket {
    constructor(address: string | URL, ...rest: never[]) {
      super(String(address).replace(/^wss:/, 'ws:'), ...rest);
    }
  }
  return { ...actual, WebSocket: PlainWebSocket };
});

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };
const freshKey = (): MachineKeyPair => dh.generateKeyPair();
const hex = (key: MachineKeyPair): string => key.publicKey.toString('hex');

interface Responder {
  port: number;
  url: `tcp://${string}`;
  accepted: ChannelSocket[];
  acceptErrors: Error[];
  requests: string[];
  http: HttpServer;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startResponder(opts: AcceptChannelOptions): Promise<Responder> {
  const requests: string[] = [];
  const http = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      requests.push(`${req.method} ${req.url} ${body}`);
      res.end(`pong ${req.url} from=${req.socket.remoteAddress}`);
    });
  });
  const accepted: ChannelSocket[] = [];
  const acceptErrors: Error[] = [];
  const net: NetServer = createNetServer((raw: Socket) => {
    acceptChannel(raw, opts).then(
      (channel) => {
        accepted.push(channel);
        http.emit('connection', channel);
      },
      (error: Error) => { acceptErrors.push(error); },
    );
  });
  await new Promise<void>((resolve) => net.listen(0, '127.0.0.1', resolve));
  const port = (net.address() as { port: number }).port;
  const responder: Responder = {
    port,
    url: `tcp://127.0.0.1:${port}`,
    accepted,
    acceptErrors,
    requests,
    http,
    close: async () => {
      for (const channel of accepted) channel.destroy();
      await new Promise<void>((resolve) => net.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
  cleanups.push(responder.close);
  return responder;
}

function requestOverChannel(
  channel: ChannelSocket,
  init: { method?: string; path: string; body?: string },
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method: init.method ?? 'GET',
        path: init.path,
        host: 'link.invalid',
        createConnection: () => channel as unknown as Socket,
        headers: init.body ? { 'content-length': String(Buffer.byteLength(init.body)) } : {},
      },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => { text += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

const neverPairing = (): 'unknown' => 'unknown';

describe('secure channel (PAN-4645 WI-2)', () => {
  it('opens a Noise IK channel and serves an HTTP request through it', async () => {
    const initiator = freshKey();
    const responderKey = freshKey();
    const responder = await startResponder({
      localKey: responderKey,
      isPinnedPeer: (key) => key === hex(initiator),
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
    });

    const channel = await openChannel(responder.url, { mode: 'link', localKey: initiator, remoteKeyHex: hex(responderKey) });
    cleanups.push(() => channel.destroy());

    expect(isChannelSocket(channel)).toBe(true);
    expect(channel.channel).toEqual({ mode: 'link', remoteKeyHex: hex(responderKey), pairingId: null });
    expect(channel.remoteAddress).toBe(`link:${hex(responderKey).slice(0, 16)}`);

    const res = await requestOverChannel(channel, { path: '/api/ping' });
    expect(res.status).toBe(200);
    expect(res.text).toBe(`pong /api/ping from=link:${hex(initiator).slice(0, 16)}`);
    expect(responder.accepted).toHaveLength(1);
    expect(responder.accepted[0]!.channel).toEqual({ mode: 'link', remoteKeyHex: hex(initiator), pairingId: null });
    expect(channel.bytesOut).toBeGreaterThan(0);
    expect(channel.bytesIn).toBeGreaterThan(0);
  });

  it('rejects with identity-refused when the responder holds a different key, and no request reaches HTTP', async () => {
    const initiator = freshKey();
    const expected = freshKey();
    const actual = freshKey();
    const responder = await startResponder({
      localKey: actual,
      isPinnedPeer: () => true,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
    });

    await expect(openChannel(responder.url, { mode: 'link', localKey: initiator, remoteKeyHex: hex(expected) }))
      .rejects.toMatchObject({ code: 'identity-refused' });
    await vi.waitFor(() => expect(responder.acceptErrors).toHaveLength(1));
    expect(responder.acceptErrors[0]).toMatchObject({ code: 'handshake-failed' });
    expect(responder.accepted).toHaveLength(0);
    expect(responder.requests).toHaveLength(0);
  });

  it('refuses an unpinned initiator with unknown-peer', async () => {
    const initiator = freshKey();
    const responderKey = freshKey();
    const responder = await startResponder({
      localKey: responderKey,
      isPinnedPeer: () => false,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
    });

    await expect(openChannel(responder.url, { mode: 'link', localKey: initiator, remoteKeyHex: hex(responderKey) }))
      .rejects.toMatchObject({ code: 'unknown-peer' });
    await vi.waitFor(() => expect(responder.acceptErrors).toHaveLength(1));
    expect(responder.acceptErrors[0]).toMatchObject({ code: 'unknown-peer' });
    expect(responder.accepted).toHaveLength(0);
  });

  it('refuses a mismatched link protocol with unsupported, naming the responder version', async () => {
    const responderKey = freshKey();
    const responder = await startResponder({
      localKey: responderKey,
      isPinnedPeer: () => true,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
      linkProtocol: 7,
      serverVersion: '9.9.9',
    });

    await expect(openChannel(responder.url, { mode: 'link', localKey: freshKey(), remoteKeyHex: hex(responderKey) }))
      .rejects.toMatchObject({ code: 'unsupported', detail: { linkProtocol: 7, serverVersion: '9.9.9' } });
  });

  it('pairs over Noise XXpsk0 with the right code and both sides learn the other key', async () => {
    const initiator = freshKey();
    const responderKey = freshKey();
    const code = 'odp_test-code-123';
    const { pairingId, psk } = pairingSecrets(nodeCrypto, code);
    const taken: string[] = [];
    let consumed = 0;
    const responder = await startResponder({
      localKey: responderKey,
      isPinnedPeer: () => false,
      takePairing: (id) => {
        taken.push(id);
        return id === pairingId ? { psk, onSuccess: () => { consumed += 1; } } : 'unknown';
      },
      onPairingFailure: () => { throw new Error('unexpected pairing failure'); },
    });

    const channel = await openChannel(responder.url, { mode: 'pairing', localKey: initiator, pairingCode: code });
    cleanups.push(() => channel.destroy());

    expect(channel.channel).toEqual({ mode: 'pairing', remoteKeyHex: hex(responderKey), pairingId });
    await vi.waitFor(() => expect(responder.accepted).toHaveLength(1));
    expect(responder.accepted[0]!.channel).toEqual({ mode: 'pairing', remoteKeyHex: hex(initiator), pairingId });
    expect(taken).toEqual([pairingId]);
    expect(consumed).toBe(1);

    const res = await requestOverChannel(channel, { path: '/api/environment' });
    expect(res.text).toContain('pong /api/environment');
  });

  it('rejects a wrong pairing code with pairing-refused and reports the failure', async () => {
    const responderKey = freshKey();
    const { pairingId, psk } = pairingSecrets(nodeCrypto, 'right-code');
    const failures: number[] = [];
    const responder = await startResponder({
      localKey: responderKey,
      isPinnedPeer: () => false,
      takePairing: (id) => (id === pairingId ? { psk } : 'unknown'),
      onPairingFailure: () => { failures.push(1); },
    });

    // Same pairing id as the stored credential, different PSK: fails inside the handshake.
    const wrongPsk = pairingSecrets(nodeCrypto, 'wrong-code');
    const responderWithSameId = await startResponder({
      localKey: responderKey,
      isPinnedPeer: () => false,
      takePairing: () => ({ psk: wrongPsk.psk }),
      onPairingFailure: () => { failures.push(2); },
    });

    await expect(openChannel(responder.url, { mode: 'pairing', localKey: freshKey(), pairingCode: 'wrong-code' }))
      .rejects.toMatchObject({ code: 'pairing-refused' });
    await expect(openChannel(responderWithSameId.url, { mode: 'pairing', localKey: freshKey(), pairingCode: 'right-code' }))
      .rejects.toMatchObject({ code: 'pairing-refused' });
    await vi.waitFor(() => expect(failures).toEqual([1, 2]));
    expect(responder.accepted).toHaveLength(0);
    expect(responderWithSameId.accepted).toHaveLength(0);
  });

  it('carries a WebSocket upgrade and delivers a server close(4401) to the client', async () => {
    const initiator = freshKey();
    const responderKey = freshKey();
    const responder = await startResponder({
      localKey: responderKey,
      isPinnedPeer: () => true,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
    });
    const wss = new WebSocketServer({ noServer: true });
    cleanups.push(() => new Promise<void>((resolve) => wss.close(() => resolve())));
    responder.http.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(`hello ${req.socket.remoteAddress}`);
        ws.on('message', (data) => {
          if (String(data) === 'bye') ws.close(4401, 'device revoked');
        });
      });
    });

    const channel = await openChannel(responder.url, { mode: 'link', localKey: initiator, remoteKeyHex: hex(responderKey) });
    const ws = new WsClient('ws://link.invalid/ws/rpc', { createConnection: () => channel as unknown as Socket });
    cleanups.push(() => { ws.terminate(); channel.destroy(); });

    const greeting = await new Promise<string>((resolve, reject) => {
      ws.once('message', (data) => resolve(String(data)));
      ws.once('error', reject);
    });
    expect(greeting).toBe(`hello link:${hex(initiator).slice(0, 16)}`);

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: String(reason) }));
    });
    ws.send('bye');
    expect(await closed).toEqual({ code: 4401, reason: 'device revoked' });
  });

  it('drops a silent peer once the handshake timeout elapses (fake timers)', async () => {
    vi.useFakeTimers();
    const [initiatorSide, responderSide] = duplexPair();
    const pending = acceptChannel(responderSide as Duplex, {
      localKey: freshKey(),
      isPinnedPeer: () => true,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
      timeoutMs: 10_000,
    });
    const settled = pending.then(() => 'resolved' as const, (error: Error) => error);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(responderSide.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await settled;
    expect(outcome).toMatchObject({ code: 'timeout' });
    expect(responderSide.destroyed).toBe(true);
    initiatorSide.destroy();
  });

  it('respects an external abort signal while connecting', async () => {
    const controller = new AbortController();
    const pending = openChannel('tcp://127.0.0.1:9', { mode: 'link', localKey: freshKey(), remoteKeyHex: 'ab'.repeat(32), signal: controller.signal });
    const settled = pending.catch((error: Error) => error);
    controller.abort();
    const outcome = await settled;
    expect(['aborted', 'unreachable']).toContain((outcome as { code: string }).code);
  });

  it('reports an unreachable transport', async () => {
    const closed = createNetServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as { port: number }).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const url = `tcp://127.0.0.1:${port}`;
    const error: Error = await openChannel(url, { mode: 'link', localKey: freshKey(), remoteKeyHex: 'ab'.repeat(32), timeoutMs: 2_000 }).catch((caught: Error) => caught);
    expect(error).toMatchObject({ code: 'unreachable', detail: { cause: 'ECONNREFUSED' } });
    expect(error.message).toMatch(new RegExp(`^${url}: .*ECONNREFUSED`));
  });
});

describe('approval channel (PAN-2356 WI-13)', () => {
  const REQUEST_ID = 'ab'.repeat(16);

  it('completes Noise XX for a live request id and both sides derive the same six-digit SAS', async () => {
    const approver = freshKey();
    const requester = freshKey();
    const taken: string[] = [];
    const responder = await startResponder({
      localKey: requester,
      isPinnedPeer: () => false,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
      takeApproval: (id) => {
        taken.push(id);
        return id === REQUEST_ID;
      },
    });

    const channel = await openChannel(responder.url, { mode: 'approval', localKey: approver, requestId: REQUEST_ID });
    cleanups.push(() => channel.destroy());
    await vi.waitFor(() => expect(responder.accepted).toHaveLength(1));
    const sas = channel.channel.approvalSas;
    expect(sas).toMatch(/^\d{3} \d{3}$/);
    expect(responder.accepted[0]!.channel).toEqual({
      mode: 'approval',
      remoteKeyHex: hex(approver),
      pairingId: null,
      requestId: REQUEST_ID,
      approvalSas: sas,
    });
    expect(channel.channel).toMatchObject({ mode: 'approval', remoteKeyHex: hex(requester), requestId: REQUEST_ID });
    expect(taken).toEqual([REQUEST_ID]);

    const res = await requestOverChannel(channel, { path: '/api/environment' });
    expect(res.text).toContain('pong /api/environment');
  });

  it('shows two different codes when a proxy terminates and re-originates the handshake with its own key', async () => {
    const approver = freshKey();
    const requester = freshKey();
    const mitm = freshKey();
    const real = await startResponder({
      localKey: requester,
      isPinnedPeer: () => false,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
      takeApproval: (id) => id === REQUEST_ID,
    });
    // The proxy accepts the approver's handshake as itself and opens its own to the requester.
    const proxied: ChannelSocket[] = [];
    const proxy = createNetServer((raw: Socket) => {
      void acceptChannel(raw, {
        localKey: mitm,
        isPinnedPeer: () => false,
        takePairing: neverPairing,
        onPairingFailure: () => undefined,
        takeApproval: () => true,
      }).then(async (front) => {
        proxied.push(front, await openChannel(real.url, { mode: 'approval', localKey: mitm, requestId: REQUEST_ID }));
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => proxy.close(() => resolve())));
    cleanups.push(() => { for (const c of proxied) c.destroy(); });

    const approverSide = await openChannel(`tcp://127.0.0.1:${(proxy.address() as { port: number }).port}`, {
      mode: 'approval',
      localKey: approver,
      requestId: REQUEST_ID,
    });
    cleanups.push(() => approverSide.destroy());
    await vi.waitFor(() => expect(real.accepted).toHaveLength(1));
    const requesterSide = real.accepted[0]!;

    expect(approverSide.channel.approvalSas).toMatch(/^\d{3} \d{3}$/);
    expect(requesterSide.channel.approvalSas).toMatch(/^\d{3} \d{3}$/);
    expect(approverSide.channel.approvalSas).not.toBe(requesterSide.channel.approvalSas);
    // Each side sees the proxy's key, not the other machine's.
    expect(approverSide.channel.remoteKeyHex).toBe(hex(mitm));
    expect(requesterSide.channel.remoteKeyHex).toBe(hex(mitm));
  });

  it('refuses an approval preamble with code 03 when takeApproval returns false', async () => {
    const responder = await startResponder({
      localKey: freshKey(),
      isPinnedPeer: () => false,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
      takeApproval: () => false,
    });
    await expect(openChannel(responder.url, { mode: 'approval', localKey: freshKey(), requestId: REQUEST_ID })).rejects.toMatchObject({
      code: 'pairing-refused',
      message: 'Responder has no live approval request with this id',
    });
    await vi.waitFor(() => expect(responder.acceptErrors[0]).toMatchObject({ code: 'approval-refused' }));
  });

  it('refuses approval mode on a responder without takeApproval', async () => {
    const responder = await startResponder({ localKey: freshKey(), isPinnedPeer: () => false, takePairing: neverPairing, onPairingFailure: () => undefined });
    await expect(openChannel(responder.url, { mode: 'approval', localKey: freshKey(), requestId: REQUEST_ID })).rejects.toMatchObject({ code: 'pairing-refused' });
  });

  it('derives the SAS per D-2356-10 (amended) from the hash and both nonces', () => {
    const hash = Buffer.alloc(64, 7);
    const ni = Buffer.alloc(32, 1);
    const nr = Buffer.alloc(32, 2);
    const sas = approvalSas(nodeCrypto, hash, ni, nr);
    expect(sas).toMatch(/^\d{3} \d{3}$/);
    expect(approvalSas(nodeCrypto, hash, ni, nr)).toBe(sas);
    expect(approvalSas(nodeCrypto, Buffer.alloc(64, 8), ni, nr)).not.toBe(sas);
    expect(approvalSas(nodeCrypto, hash, ni, Buffer.alloc(32, 3))).not.toBe(sas);
    expect(approvalCommitment(nodeCrypto, hash, ni)).not.toEqual(approvalCommitment(nodeCrypto, hash, nr));
  });

  it('refuses a man in the middle that grinds its revealed nonce to match the other leg\'s code', async () => {
    const approver = freshKey();
    const requester = freshKey();
    const mitm = freshKey();
    // Leg 1, approver -> man in the middle: completes first, so the attacker knows its target code.
    const front = await startResponder({
      localKey: mitm,
      isPinnedPeer: () => false,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
      takeApproval: () => true,
    });
    const approverSide = await openChannel(front.url, { mode: 'approval', localKey: approver, requestId: REQUEST_ID });
    cleanups.push(() => approverSide.destroy());
    const target = approverSide.channel.approvalSas!;

    // Leg 2, man in the middle -> requester, driven by hand so the attacker can reveal any nonce.
    let taken = false;
    const real = await startResponder({
      localKey: requester,
      isPinnedPeer: () => false,
      takePairing: neverPairing,
      onPairingFailure: () => undefined,
      takeApproval: (id) => {
        if (id !== REQUEST_ID || taken) return false;
        taken = true;
        return true;
      },
    });
    const raw = netConnect(real.port, '127.0.0.1');
    cleanups.push(() => { raw.destroy(); });
    const reader = new FrameReader(raw);
    const next = async (): Promise<Buffer> => {
      const frame = await reader.readFrame();
      if (frame.kind !== 'message') throw new Error(`refusal ${frame.refusal.code}`);
      return frame.payload;
    };
    raw.write(encodePreamble({ linkProtocol: 1, mode: 'approval', pairingId: REQUEST_ID }));
    const handshake = xxInitiator(mitm, prologueFor('approval', REQUEST_ID));
    raw.write(encodeFrame(handshake.send()));
    handshake.recv(await next());
    raw.write(encodeFrame(handshake.send()));
    const hash = handshake.result().hash;
    const committed = approvalNonce(nodeCrypto);
    raw.write(encodeFrame(approvalCommitment(nodeCrypto, hash, committed)));
    const responderNonce = await next();

    // The grind: search for a nonce whose code matches leg 1. The committed nonce cannot be changed.
    const prefix = createHash('sha256').update('overdeck-approve-sas/2').update(Buffer.from([0])).update(hash);
    const candidate = Buffer.alloc(32);
    let ground: Buffer | null = null;
    for (let i = 0; i < 1 << 21 && !ground; i += 1) {
      candidate.writeUInt32BE(i, 0);
      const code = (prefix.copy().update(candidate).update(responderNonce).digest().readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
      if (`${code.slice(0, 3)} ${code.slice(3)}` === target) ground = Buffer.from(candidate);
    }
    if (ground) expect(approvalSas(nodeCrypto, hash, ground, responderNonce)).toBe(target);
    raw.write(encodeFrame(ground ?? candidate));

    await vi.waitFor(() => expect(real.acceptErrors[0]).toMatchObject({ code: 'handshake-failed', message: 'Approval nonce did not match its commitment' }));
    expect(real.accepted).toEqual([]);
    // The request id is spent: the attacker cannot start the leg again for a new nonce.
    await expect(openChannel(real.url, { mode: 'approval', localKey: mitm, requestId: REQUEST_ID })).rejects.toMatchObject({ code: 'pairing-refused' });
  }, 30_000);

  it('round-trips the approval preamble with its request id', () => {
    const preamble = encodePreamble({ linkProtocol: 1, mode: 'approval', pairingId: REQUEST_ID });
    expect(preamble.length).toBe(7 + 16);
    expect(parsePreambleHead(preamble.subarray(0, 7))).toEqual({ linkProtocol: 1, mode: 'approval' });
    expect(preamble.subarray(7).toString('hex')).toBe(REQUEST_ID);
  });
});

describe('wire format (D-4645-5)', () => {
  it('round-trips the preamble', () => {
    const link = encodePreamble({ linkProtocol: 1, mode: 'link', pairingId: null });
    expect([...link]).toEqual([0x00, 0x4f, 0x56, 0x44, 0x4c, 0x01, 0x01]);
    expect(parsePreambleHead(link)).toEqual({ linkProtocol: 1, mode: 'link' });

    const pairingId = 'ab'.repeat(16);
    const pairing = encodePreamble({ linkProtocol: 1, mode: 'pairing', pairingId });
    expect(pairing.length).toBe(7 + 16);
    expect(parsePreambleHead(pairing.subarray(0, 7))).toEqual({ linkProtocol: 1, mode: 'pairing' });
    expect(pairing.subarray(7).toString('hex')).toBe(pairingId);

    expect(() => parsePreambleHead(Buffer.from('GET /ab'))).toThrow(/preamble/);
    expect(() => encodePreamble({ linkProtocol: 1, mode: 'pairing', pairingId: null })).toThrow();
  });

  it('frames handshake messages with a uint24le length and caps them at 1024 bytes', async () => {
    const message = Buffer.from('noise message');
    const frame = encodeFrame(message);
    expect([...frame.subarray(0, 3)]).toEqual([message.length, 0, 0]);
    expect(() => encodeFrame(Buffer.alloc(MAX_HANDSHAKE_FRAME + 1))).toThrow(/out of range/);

    const [a, b] = duplexPair();
    const reader = new FrameReader(b as Duplex);
    a.write(frame.subarray(0, 5));
    const pending = reader.readFrame();
    a.write(frame.subarray(5));
    expect(await pending).toEqual({ kind: 'message', payload: message });

    const oversized = Buffer.from([0xff, 0xff, 0xff]);
    a.write(oversized);
    await expect(reader.readFrame()).rejects.toMatchObject({ code: 'frame-too-large' });
    a.destroy();
    b.destroy();
  });

  it('encodes and parses refusal frames, keeping bytes behind them as leftover', async () => {
    const unsupported = encodeRefusal({ code: REFUSAL_CODES.unsupported, linkProtocol: 2, serverVersion: '0.73.0' });
    expect([...unsupported.subarray(0, 6)]).toEqual([0, 0, 0, 2, 2, 6]);
    const busy = encodeRefusal({ code: REFUSAL_CODES.busy });
    expect([...busy]).toEqual([0, 0, 0, 4]);

    const [a, b] = duplexPair();
    const reader = new FrameReader(b as Duplex);
    a.write(Buffer.concat([unsupported, busy, Buffer.from('tail')]));
    expect(await reader.readFrame()).toEqual({ kind: 'refusal', refusal: { code: 2, linkProtocol: 2, serverVersion: '0.73.0' } });
    expect(await reader.readFrame()).toEqual({ kind: 'refusal', refusal: { code: 4 } });
    expect(reader.detach().toString()).toBe('tail');
    a.destroy();
    b.destroy();
  });
});

describe('fly-instance route parameter (PAN-4652 WI-4)', () => {
  /** A ws server that records each upgrade request and drops it, so the dial fails fast. */
  async function startUpgradeRecorder(): Promise<{ port: number; upgrades: Array<{ url: string; instance: string | undefined }> }> {
    const upgrades: Array<{ url: string; instance: string | undefined }> = [];
    const http = createHttpServer();
    http.on('upgrade', (req, socket) => {
      const instance = req.headers['fly-force-instance-id'];
      upgrades.push({ url: req.url ?? '', instance: Array.isArray(instance) ? instance[0] : instance });
      socket.destroy();
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    return { port: (http.address() as { port: number }).port, upgrades };
  }

  it('exports the parameter name', () => {
    expect(FLY_INSTANCE_PARAM).toBe('fly-instance');
  });

  it('moves fly-instance from the URL into the fly-force-instance-id header', async () => {
    const recorder = await startUpgradeRecorder();
    await expect(openChannel(`wss://127.0.0.1:${recorder.port}/ws/link?fly-instance=abc&keep=1`, { mode: 'link', localKey: freshKey(), remoteKeyHex: 'ab'.repeat(32) }))
      .rejects.toMatchObject({ code: 'unreachable' });

    expect(recorder.upgrades).toHaveLength(1);
    const dialled = new URL(recorder.upgrades[0]!.url, 'http://x');
    expect(dialled.pathname).toBe('/ws/link');
    expect(dialled.searchParams.has('fly-instance')).toBe(false);
    expect(dialled.searchParams.get('keep')).toBe('1');
    expect(recorder.upgrades[0]!.instance).toBe('abc');
  });

  it('dials a URL without the parameter unchanged and without the header', async () => {
    const recorder = await startUpgradeRecorder();
    await expect(openChannel(`wss://127.0.0.1:${recorder.port}/ws/link?keep=1`, { mode: 'link', localKey: freshKey(), remoteKeyHex: 'ab'.repeat(32) }))
      .rejects.toMatchObject({ code: 'unreachable' });

    expect(recorder.upgrades).toEqual([{ url: '/ws/link?keep=1', instance: undefined }]);
  });
});

describe('ChannelSocket idle timeout (PAN-4740)', () => {
  const key = (fill: number, length = 32): Buffer => Buffer.alloc(length, fill);

  function freshChannel(): ChannelSocket {
    const [raw] = duplexPair();
    return createChannelSocket({
      raw, initiator: true,
      handshake: { tx: key(1), rx: key(2), hash: key(3, 64), localPublicKey: key(4), remotePublicKey: key(5) } as HandshakeResult,
      channel: { mode: 'link', remoteKeyHex: 'ab'.repeat(32), pairingId: null },
    });
  }

  it('fires timeout again when traffic follows the first timeout', () => {
    const channel = freshChannel();
    cleanups.push(() => channel.destroy());
    vi.useFakeTimers();
    let fired = 0;
    channel.on('timeout', () => { fired += 1; });
    channel.setTimeout(1000);

    vi.advanceTimersByTime(1000);
    expect(fired).toBe(1);

    channel.write(Buffer.from('x'));
    vi.advanceTimersByTime(1000);
    expect(fired).toBe(2);
  });

  it('setTimeout(0) disables the idle timer even after traffic', () => {
    const channel = freshChannel();
    cleanups.push(() => channel.destroy());
    vi.useFakeTimers();
    let fired = 0;
    channel.on('timeout', () => { fired += 1; });
    channel.setTimeout(1000);

    vi.advanceTimersByTime(1000);
    expect(fired).toBe(1);

    channel.setTimeout(0);
    channel.write(Buffer.from('x'));
    vi.advanceTimersByTime(5000);
    expect(fired).toBe(1);
  });
});
