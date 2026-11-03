/**
 * PAN-4645 WI-2 / NFR-1: a byte-logging TCP proxy between initiator and
 * responder sees no plaintext HTTP. Only the preamble and Noise handshake are
 * visible, and they carry no application data.
 */
import { createRequire } from 'node:module';
import { Agent, createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect, createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';

import { FRAME_HEADER_LENGTH, PREAMBLE_LENGTH, PREAMBLE_MAGIC } from '@overdeck/anywhere-channel';
import { afterEach, describe, expect, it } from 'vitest';

import type { MachineKeyPair } from '../../machine-key.js';
import { acceptChannel } from '../accept.js';
import type { ChannelSocket } from '../channel-socket.js';
import { openChannel } from '../open.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(server: NetServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as { port: number }).port;
}

/**
 * Reuse one channel for several requests: without an agent Node sends
 * `Connection: close` and the server ends the channel after one response.
 */
function channelAgent(channel: ChannelSocket): Agent {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  (agent as unknown as { createConnection: () => Socket }).createConnection = () => channel as unknown as Socket;
  return agent;
}

function requestOverChannel(agent: Agent, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method,
        path,
        host: 'link.invalid',
        agent,
        headers: body ? { ...headers, 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(body)) } : headers,
      },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => { text += chunk.toString(); });
        res.on('end', () => resolve(text));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('secure channel byte capture (NFR-1)', () => {
  it('shows no HTTP/1.1, path, header or body text on the wire in either direction', async () => {
    const initiator = dh.generateKeyPair();
    const responderKey = dh.generateKeyPair();
    const secretBody = 'the quick brown fox carries a secret payload';
    const secretHeader = 'x-overdeck-capture-marker';

    const http = createHttpServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => res.end(`pong ${req.method} ${req.url} marker=${req.headers[secretHeader]} body=${body}`));
    });
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const accepted: ChannelSocket[] = [];
    const responder = createNetServer((raw) => {
      void acceptChannel(raw, {
        localKey: responderKey,
        isPinnedPeer: (key) => key === initiator.publicKey.toString('hex'),
        takePairing: () => 'unknown',
        onPairingFailure: () => undefined,
      }).then((channel) => {
        accepted.push(channel);
        http.emit('connection', channel);
      });
    });
    const responderPort = await listen(responder);
    cleanups.push(() => { for (const channel of accepted) channel.destroy(); });

    const toResponder: Buffer[] = [];
    const toInitiator: Buffer[] = [];
    const proxy = createNetServer((client) => {
      const upstream = connect({ host: '127.0.0.1', port: responderPort });
      client.on('data', (chunk: Buffer) => { toResponder.push(Buffer.from(chunk)); upstream.write(chunk); });
      upstream.on('data', (chunk: Buffer) => { toInitiator.push(Buffer.from(chunk)); client.write(chunk); });
      client.on('end', () => upstream.end());
      upstream.on('end', () => client.end());
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    });
    const proxyPort = await listen(proxy);

    const channel = await openChannel(`tcp://127.0.0.1:${proxyPort}`, {
      mode: 'link',
      localKey: initiator,
      remoteKeyHex: responderKey.publicKey.toString('hex'),
    });
    cleanups.push(() => channel.destroy());
    const agent = channelAgent(channel);
    cleanups.push(() => agent.destroy());

    const getText = await requestOverChannel(agent, 'GET', '/api/secret-path');
    expect(getText).toBe('pong GET /api/secret-path marker=undefined body=');

    const postText = await requestOverChannel(agent, 'POST', '/api/post-path', secretBody, { [secretHeader]: 'marker-value' });
    expect(postText).toBe(`pong POST /api/post-path marker=marker-value body=${secretBody}`);
    expect(channel.destroyed).toBe(false);
    expect(accepted).toHaveLength(1);

    const outbound = Buffer.concat(toResponder).toString('latin1');
    const inbound = Buffer.concat(toInitiator).toString('latin1');
    expect(toResponder[0]!.subarray(0, PREAMBLE_MAGIC.length).equals(PREAMBLE_MAGIC)).toBe(true);
    for (const capture of [outbound, inbound]) {
      expect(capture).not.toContain('HTTP/1.1');
      expect(capture).not.toContain('secret-path');
      expect(capture).not.toContain('post-path');
      expect(capture).not.toContain(secretHeader);
      expect(capture).not.toContain('marker-value');
      expect(capture).not.toContain(secretBody);
      expect(capture).not.toContain('pong');
    }
    // Counters cover channel ciphertext only. Noise IK sizes are fixed: message 1 is
    // e(32) + enc(s)(48) + enc(payload)(16) = 96 bytes, message 2 is e(32) + enc(payload)(16) = 48.
    const handshakeOut = PREAMBLE_LENGTH + FRAME_HEADER_LENGTH + 96;
    const handshakeIn = FRAME_HEADER_LENGTH + 48;
    expect(channel.bytesOut).toBe(Buffer.concat(toResponder).length - handshakeOut);
    expect(channel.bytesIn).toBe(Buffer.concat(toInitiator).length - handshakeIn);
  });
});
