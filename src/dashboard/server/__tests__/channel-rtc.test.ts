/**
 * PAN-2356 WI-11: `rtc://<environmentId>` is one more transport under the secure channel. Two
 * in-process machines joined by an in-memory directory: A dials B through WebRTC, the IK handshake
 * runs over the data channel, and B's HTTP server answers through the channel listener. Real
 * timers: the subject is real UDP I/O on loopback host candidates.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import type { Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DirectoryMachine, DirectoryToMachineFrame, MachineToDirectoryFrame } from '@overdeck/contracts';

import type { ChannelSocket } from '../../../lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError, openChannel, setRtcDialer } from '../../../lib/anywhere/channel/open.js';
import type { MachineKeyPair } from '../../../lib/anywhere/machine-key.js';
import { _resetChannelListenerForTests, installChannelListener } from '../channel-listener.js';
import { createDirectoryRtc, type DirectoryPort, type DirectoryRtc } from '../services/directory-rtc.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };
const hex = (key: MachineKeyPair): string => key.publicKey.toString('hex');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const keyA = dh.generateKeyPair();
const keyB = dh.generateKeyPair();

type Handlers = Map<string, Set<(frame: DirectoryToMachineFrame) => void>>;

/** The directory's signalling and STUN answers for two machines, delivered on a later turn. */
function directoryHub() {
  const handlers = new Map<string, Handlers>();
  const deliver = (to: string, frame: DirectoryToMachineFrame) => {
    setImmediate(() => {
      for (const handler of handlers.get(to)?.get(frame.type) ?? []) handler(frame);
    });
  };
  const machineView = (environmentId: string): DirectoryMachine => ({
    environmentId,
    label: environmentId.slice(-1),
    publicKeyHex: environmentId === A ? hex(keyA) : hex(keyB),
    fingerprint: '',
    online: true,
    lastSeenAt: new Date(0).toISOString(),
    serverVersion: 'test',
    endpoints: [],
  });
  const port = (self: string): DirectoryPort => {
    const mine: Handlers = new Map();
    handlers.set(self, mine);
    return {
      send(frame: MachineToDirectoryFrame) {
        if (frame.type === 'signal') {
          deliver(frame.to, { type: 'signal', from: self, session: frame.session, purpose: frame.purpose, relay: frame.relay, data: frame.data });
        } else if (frame.type === 'ice-servers') {
          deliver(self, { type: 'ice-servers', requestId: frame.requestId, iceServers: [] });
        }
        return true;
      },
      on(type, handler) {
        let set = mine.get(type);
        if (!set) mine.set(type, (set = new Set()));
        set.add(handler as (frame: DirectoryToMachineFrame) => void);
        return () => set.delete(handler as (frame: DirectoryToMachineFrame) => void);
      },
      isOnline: () => true,
      machine: (environmentId) => (environmentId === A || environmentId === B ? machineView(environmentId) : null),
    };
  };
  return { port };
}

let server: http.Server;
let received: Array<{ method: string; url: string; bytes: number }>;
let rtcA: DirectoryRtc;
let rtcB: DirectoryRtc;

beforeEach(async () => {
  _resetChannelListenerForTests();
  received = [];
  server = http.createServer((req, res) => {
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', bytes });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/api/environment' ? { environmentId: B } : { bytes }));
    });
  });
  installChannelListener(server, {
    primary: true,
    localKey: async () => keyB,
    isPinnedPeer: (key) => key === hex(keyA),
    takePairing: () => 'unknown',
    onPairingFailure: () => undefined,
    serverVersion: async () => '0.0.0-test',
    log: () => undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const hub = directoryHub();
  rtcA = createDirectoryRtc(hub.port(A));
  rtcB = createDirectoryRtc(hub.port(B));
  setRtcDialer(rtcA.dialer);
});

afterEach(async () => {
  setRtcDialer(null);
  rtcA.stop();
  rtcB.stop();
  _resetChannelListenerForTests();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function request(channel: ChannelSocket, method: string, path: string, body?: Buffer): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'link.invalid',
        path,
        method,
        headers: body ? { 'content-length': String(body.length) } : {},
        createConnection: () => channel as unknown as Socket,
      },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => {
          text += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as unknown }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('rtc:// routes on the secure channel (PAN-2356 WI-11)', () => {
  it('opens an IK channel over rtc://<B> and reaches the peer HTTP server', async () => {
    const channel = await openChannel(`rtc://${B}`, { mode: 'link', localKey: keyA, remoteKeyHex: hex(keyB) });
    const answer = await request(channel, 'GET', '/api/environment');
    expect(answer).toEqual({ status: 200, json: { environmentId: B } });
    channel.destroy();
  }, 30_000);

  it('carries a request with a 1 MiB body', async () => {
    const channel = await openChannel(`rtc://${B}`, { mode: 'link', localKey: keyA, remoteKeyHex: hex(keyB) });
    const body = randomBytes(1024 * 1024);
    const started = Date.now();
    const answer = await request(channel, 'POST', '/upload', body);
    expect(answer).toEqual({ status: 200, json: { bytes: body.length } });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(received.at(-1)).toEqual({ method: 'POST', url: '/upload', bytes: body.length });
    channel.destroy();
  }, 30_000);

  it('fails with unreachable when no dialer is registered', async () => {
    setRtcDialer(null);
    const opened = openChannel(`rtc://${B}`, { mode: 'link', localKey: keyA, remoteKeyHex: hex(keyB) });
    await expect(opened).rejects.toBeInstanceOf(ChannelOpenError);
    await expect(opened).rejects.toMatchObject({ code: 'unreachable', message: 'Direct connections need an overdeck.ai sign-in' });
  });

  it('fails with unreachable when the directory does not list the machine', async () => {
    const opened = openChannel('rtc://00000000-0000-4000-8000-0000000000cc', { mode: 'link', localKey: keyA, remoteKeyHex: hex(keyB) });
    await expect(opened).rejects.toMatchObject({ code: 'unreachable' });
  });
});
