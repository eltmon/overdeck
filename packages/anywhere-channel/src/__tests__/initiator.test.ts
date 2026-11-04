/**
 * PAN-4833 WI-4: the shared initiator sequence against an in-test responder
 * built from the package's own Noise and wire functions over `duplexPair()`.
 */
import { createRequire } from 'node:module';
import { type Duplex, duplexPair } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nodeCrypto } from '../crypto-node.js';
import {
  ChannelOpenError,
  type InitiatorDone,
  type InitiatorOptions,
  runInitiatorHandshake,
  withDeadline,
} from '../initiator.js';
import { ikResponder, pairingSecrets, prologueFor, type StaticKeyPair, xxPskResponder } from '../noise.js';
import { encodeFrame, encodeRefusal, FrameReader, PAIRING_ID_LENGTH, PREAMBLE_LENGTH, REFUSAL_CODES, type Refusal } from '../wire.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): StaticKeyPair };

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** Run the initiator over one end of a pair; resolves with what `finish` received. */
function open(raw: Duplex, opts: InitiatorOptions, onFinish?: (done: InitiatorDone<Duplex>) => void): Promise<InitiatorDone<Duplex>> {
  return withDeadline<InitiatorDone<Duplex>, Duplex>('test', opts, (_signal, track) => {
    track(raw);
    return runInitiatorHandshake(raw, 'test', opts, nodeCrypto, track, (done) => {
      onFinish?.(done);
      return done;
    });
  });
}

/** Responder: read the preamble, then answer the first handshake message with a refusal. */
async function refuseAfterPreamble(responder: Duplex, refusal: Refusal): Promise<void> {
  const reader = new FrameReader(responder);
  await reader.readBytes(PREAMBLE_LENGTH);
  await reader.readFrame();
  reader.detach();
  responder.write(encodeRefusal(refusal));
}

const pairs: Duplex[] = [];
function pair(): [Duplex, Duplex] {
  const [a, b] = duplexPair();
  pairs.push(a, b);
  return [a, b];
}

afterEach(() => {
  vi.useRealTimers();
  for (const end of pairs.splice(0)) end.destroy();
});

describe('runInitiatorHandshake', () => {
  it('pairing: hands finish the leftover bytes after message 3 is written', async () => {
    const [initiator, responder] = pair();
    const localKey = dh.generateKeyPair();
    const responderKey = dh.generateKeyPair();
    const code = 'odp_' + 'ab'.repeat(32);
    const { psk, pairingId } = pairingSecrets(nodeCrypto, code);

    const sent: Buffer[] = [];
    responder.on('data', (chunk: Buffer) => sent.push(Buffer.from(chunk)));
    const extra = Uint8Array.of(9, 8, 7, 6, 5);
    let bytesWrittenAtFinish = -1;
    const initiatorWrite = initiator.write.bind(initiator) as (chunk: Uint8Array) => boolean;
    let bytesWritten = 0;
    initiator.write = ((chunk: Uint8Array) => {
      bytesWritten += chunk.byteLength;
      return initiatorWrite(chunk);
    }) as typeof initiator.write;

    const responderDone = (async () => {
      const reader = new FrameReader(responder);
      await reader.readBytes(PREAMBLE_LENGTH);
      expect(toHex(await reader.readBytes(PAIRING_ID_LENGTH))).toBe(pairingId);
      const handshake = xxPskResponder(responderKey, psk, prologueFor('pairing', pairingId));
      const message1 = await reader.readFrame();
      if (message1.kind !== 'message') throw new Error('expected message 1');
      handshake.recv(message1.payload);
      // Message 2 and five unrelated bytes in one chunk.
      responder.write(Buffer.concat([encodeFrame(handshake.send()), extra]));
      const message3 = await reader.readFrame();
      if (message3.kind !== 'message') throw new Error('expected message 3');
      handshake.recv(message3.payload);
      reader.detach();
      return handshake;
    })();

    const done = await open(initiator, { mode: 'pairing', localKey, pairingCode: code }, () => {
      bytesWrittenAtFinish = bytesWritten;
    });
    const handshake = await responderDone;

    expect(toHex(done.leftover)).toBe(toHex(extra));
    // Everything the initiator sends (preamble, message 1, message 3) was written before finish ran.
    expect(bytesWrittenAtFinish).toBe(bytesWritten);
    expect(bytesWrittenAtFinish).toBe(sent.reduce((n, c) => n + c.byteLength, 0));
    expect(handshake.complete).toBe(true);
    expect(done.channel).toEqual({ mode: 'pairing', remoteKeyHex: toHex(responderKey.publicKey), pairingId });
    expect(toHex(done.handshake.remotePublicKey)).toBe(toHex(responderKey.publicKey));
  });

  it('link: hands finish the pinned channel marker', async () => {
    const [initiator, responder] = pair();
    const localKey = dh.generateKeyPair();
    const responderKey = dh.generateKeyPair();
    const remoteKeyHex = toHex(responderKey.publicKey);

    void (async () => {
      const reader = new FrameReader(responder);
      await reader.readBytes(PREAMBLE_LENGTH);
      const handshake = ikResponder(responderKey, prologueFor('link', null));
      const message1 = await reader.readFrame();
      if (message1.kind !== 'message') throw new Error('expected message 1');
      handshake.recv(message1.payload);
      reader.detach();
      responder.write(encodeFrame(handshake.send()));
    })();

    const done = await open(initiator, { mode: 'link', localKey, remoteKeyHex });
    expect(done.channel).toEqual({ mode: 'link', remoteKeyHex, pairingId: null });
    expect(done.leftover.byteLength).toBe(0);
  });

  it.each<[Refusal, string]>([
    [{ code: REFUSAL_CODES.unknownPeer }, 'unknown-peer'],
    [{ code: REFUSAL_CODES.unsupported, linkProtocol: 2, serverVersion: '9.9.9' }, 'unsupported'],
    [{ code: REFUSAL_CODES.busy }, 'busy'],
  ])('maps refusal %o to %s', async (refusal, code) => {
    const [initiator, responder] = pair();
    const remoteKeyHex = toHex(dh.generateKeyPair().publicKey);
    void refuseAfterPreamble(responder, refusal);

    const error = await open(initiator, { mode: 'link', localKey: dh.generateKeyPair(), remoteKeyHex }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelOpenError);
    expect((error as ChannelOpenError).code).toBe(code);
    if (code === 'unsupported') expect((error as ChannelOpenError).detail.linkProtocol).toBe(2);
  });

  it('rejects with timeout when the responder stays silent', async () => {
    vi.useFakeTimers();
    const [initiator] = pair();
    const remoteKeyHex = toHex(dh.generateKeyPair().publicKey);
    const result = open(initiator, { mode: 'link', localKey: dh.generateKeyPair(), remoteKeyHex, timeoutMs: 10_000 }).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(10_000);
    const error = await result;
    expect((error as ChannelOpenError).code).toBe('timeout');
    expect(initiator.destroyed).toBe(true);
  });

  it('rejects with aborted when the caller aborts', async () => {
    vi.useFakeTimers();
    const [initiator] = pair();
    const controller = new AbortController();
    const remoteKeyHex = toHex(dh.generateKeyPair().publicKey);
    const result = open(initiator, { mode: 'link', localKey: dh.generateKeyPair(), remoteKeyHex, signal: controller.signal }).catch(
      (e: unknown) => e,
    );

    controller.abort();
    const error = await result;
    expect((error as ChannelOpenError).code).toBe('aborted');
    expect(initiator.destroyed).toBe(true);
  });
});
