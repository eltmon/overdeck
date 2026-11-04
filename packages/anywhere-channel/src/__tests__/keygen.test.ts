/** PAN-4837 WI-3: `generateStaticKeyPair` makes keys the IK link handshake accepts. */
import { duplexPair } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { nodeCrypto } from '../crypto-node.js';
import { webCrypto } from '../crypto-web.js';
import type { CryptoPort } from '../crypto-port.js';
import { type InitiatorDone, type InitiatorOptions, runInitiatorHandshake, withDeadline } from '../initiator.js';
import { generateStaticKeyPair, ikResponder, prologueFor, type HandshakeResult } from '../noise.js';
import { encodeFrame, FrameReader, PREAMBLE_LENGTH } from '../wire.js';

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const ends: Array<{ destroy(): void }> = [];
afterEach(() => {
  for (const end of ends.splice(0)) end.destroy();
});

describe('generateStaticKeyPair', () => {
  it('returns distinct 32-byte key pairs', () => {
    const a = generateStaticKeyPair();
    const b = generateStaticKeyPair();
    expect(a.publicKey.byteLength).toBe(32);
    expect(a.secretKey.byteLength).toBe(32);
    expect(toHex(a.publicKey)).not.toBe(toHex(b.publicKey));
    expect(toHex(a.secretKey)).not.toBe(toHex(b.secretKey));
  });

  it.each<[string, CryptoPort]>([
    ['webCrypto', webCrypto],
    ['nodeCrypto', nodeCrypto],
  ])('completes an IK link handshake against ikResponder (initiator on %s)', async (_name, crypto) => {
    const [initiator, responder] = duplexPair();
    ends.push(initiator, responder);
    const localKey = generateStaticKeyPair();
    const responderKey = generateStaticKeyPair();
    const remoteKeyHex = toHex(responderKey.publicKey);

    const responderDone = (async (): Promise<HandshakeResult> => {
      const reader = new FrameReader(responder);
      await reader.readBytes(PREAMBLE_LENGTH);
      const handshake = ikResponder(responderKey, prologueFor('link', null));
      const message1 = await reader.readFrame();
      if (message1.kind !== 'message') throw new Error('expected message 1');
      handshake.recv(message1.payload);
      reader.detach();
      responder.write(encodeFrame(handshake.send()));
      return handshake.result();
    })();

    const opts: InitiatorOptions = { mode: 'link', localKey, remoteKeyHex };
    const done = await withDeadline<InitiatorDone<typeof initiator>, typeof initiator>('test', opts, (_signal, track) => {
      track(initiator);
      return runInitiatorHandshake(initiator, 'test', opts, crypto, track, (result) => result);
    });
    const server = await responderDone;

    expect(toHex(server.remotePublicKey)).toBe(toHex(localKey.publicKey));
    expect(toHex(done.handshake.remotePublicKey)).toBe(remoteKeyHex);
    expect(toHex(done.handshake.tx)).toBe(toHex(server.rx));
    expect(toHex(done.handshake.rx)).toBe(toHex(server.tx));
  });
});
