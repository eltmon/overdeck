/**
 * PAN-4833 WI-6 (pan-4823 AC-5, first half): the phone's web-port initiator
 * (`openSecureChannel`) completes pairing and link handshakes with the
 * server's Node-port `acceptChannel`, and moves 64 KiB each way intact.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { duplexPair } from 'node:stream';

import { ChannelOpenError, pairingSecrets } from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';
import { openSecureChannel, type SecureChannel, type WebChannelOptions } from '@overdeck/anywhere-channel/web';
import { afterEach, describe, expect, it } from 'vitest';

import { acceptChannel, type AcceptChannelOptions } from '../../../src/lib/anywhere/channel/accept.js';
import type { ChannelSocket } from '../../../src/lib/anywhere/channel/channel-socket.js';
import type { MachineKeyPair } from '../../../src/lib/anywhere/machine-key.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const PAYLOAD_BYTES = 64 * 1024;
const hex = (key: MachineKeyPair): string => key.publicKey.toString('hex');

interface Closable {
  destroy(): void;
}
const open: Closable[] = [];

afterEach(() => {
  for (const stream of open.splice(0)) stream.destroy();
});

function responderOptions(serverKey: MachineKeyPair, overrides: Partial<AcceptChannelOptions> = {}): AcceptChannelOptions {
  return {
    localKey: serverKey,
    isPinnedPeer: () => false,
    takePairing: () => 'unknown',
    onPairingFailure: () => {},
    ...overrides,
  };
}

/**
 * Run both ends over one `duplexPair()`; the web side gets end B. A real
 * transport closes both ends when one side drops it, so the pair does too
 * (Node's `duplexPair()` does not propagate `destroy()` on its own).
 */
async function connect(
  responder: AcceptChannelOptions,
  web: WebChannelOptions,
): Promise<{ server: ChannelSocket; client: SecureChannel }> {
  const [a, b] = duplexPair();
  a.once('close', () => b.destroy());
  b.once('close', () => a.destroy());
  open.push(a, b);
  const serverResult = acceptChannel(a, responder);
  const clientResult = openSecureChannel(b, web);
  serverResult.catch(() => {});
  const client = await clientResult;
  open.push(client.stream);
  const server = await serverResult;
  open.push(server);
  return { server, client };
}

/** Collect `bytes` from a readable stream. */
function receive(stream: { on(event: 'data', listener: (chunk: Uint8Array) => void): unknown }, bytes: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      total += chunk.byteLength;
      if (total >= bytes) resolve(Buffer.concat(chunks));
    });
  });
}

async function roundTrip(server: ChannelSocket, client: SecureChannel): Promise<void> {
  const toServer = randomBytes(PAYLOAD_BYTES);
  const toClient = randomBytes(PAYLOAD_BYTES);
  const atServer = receive(server, PAYLOAD_BYTES);
  const atClient = receive(client.stream, PAYLOAD_BYTES);
  client.stream.write(toServer);
  server.write(toClient);
  expect((await atServer).equals(toServer)).toBe(true);
  expect((await atClient).equals(toClient)).toBe(true);
}

async function openError(responder: AcceptChannelOptions, web: WebChannelOptions): Promise<ChannelOpenError> {
  const error = await connect(responder, web).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ChannelOpenError);
  return error as ChannelOpenError;
}

describe('web secure channel against the Node responder', () => {
  it('pairs and moves 64 KiB each way', async () => {
    const serverKey = dh.generateKeyPair();
    const webKey = dh.generateKeyPair();
    const code = 'odp_' + 'cd'.repeat(32);
    const { psk, pairingId } = pairingSecrets(nodeCrypto, code);

    const { server, client } = await connect(
      responderOptions(serverKey, { takePairing: (id) => (id === pairingId ? { psk } : 'unknown') }),
      { mode: 'pairing', localKey: webKey, pairingCode: code },
    );

    expect(client.channel.remoteKeyHex).toBe(hex(serverKey));
    expect(server.channel.remoteKeyHex).toBe(hex(webKey));
    await roundTrip(server, client);
  });

  it('links to a pinned peer and moves 64 KiB each way', async () => {
    const serverKey = dh.generateKeyPair();
    const webKey = dh.generateKeyPair();

    const { server, client } = await connect(
      responderOptions(serverKey, { isPinnedPeer: (key) => key === hex(webKey) }),
      { mode: 'link', localKey: webKey, remoteKeyHex: hex(serverKey) },
    );

    expect(client.channel).toEqual({ mode: 'link', remoteKeyHex: hex(serverKey), pairingId: null });
    expect(server.channel.remoteKeyHex).toBe(hex(webKey));
    await roundTrip(server, client);
  });

  it('refuses a link whose pinned key is not the server key with identity-refused', async () => {
    const serverKey = dh.generateKeyPair();
    const webKey = dh.generateKeyPair();
    const error = await openError(responderOptions(serverKey, { isPinnedPeer: () => true }), {
      mode: 'link',
      localKey: webKey,
      remoteKeyHex: hex(dh.generateKeyPair()),
    });
    expect(error.code).toBe('identity-refused');
  });

  it('refuses a link from an unpinned key with unknown-peer', async () => {
    const serverKey = dh.generateKeyPair();
    const error = await openError(responderOptions(serverKey), {
      mode: 'link',
      localKey: dh.generateKeyPair(),
      remoteKeyHex: hex(serverKey),
    });
    expect(error.code).toBe('unknown-peer');
  });

  it('refuses a pairing with a different code with pairing-refused', async () => {
    const serverKey = dh.generateKeyPair();
    const { psk } = pairingSecrets(nodeCrypto, 'odp_' + 'ef'.repeat(32));
    // The web side derives its pairing id from its own code, so serve the right PSK for any id.
    const error = await openError(responderOptions(serverKey, { takePairing: () => ({ psk }) }), {
      mode: 'pairing',
      localKey: dh.generateKeyPair(),
      pairingCode: 'odp_' + '01'.repeat(32),
    });
    expect(error.code).toBe('pairing-refused');
  });
});
