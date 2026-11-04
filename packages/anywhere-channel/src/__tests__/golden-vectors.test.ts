/**
 * PAN-4833 WI-1: golden vectors for the channel's deterministic encodings.
 *
 * Every expected value is a literal pinned from the code on `main` before the
 * protocol moved into `@overdeck/anywhere-channel`, so the move and the web
 * crypto port are checked against the old bytes, not against themselves.
 */
import { describe, expect, it } from 'vitest';

import {
  approvalCommitment,
  approvalSas,
  encodeFrame,
  encodePreamble,
  encodeRefusal,
  pairingSecrets,
  prologueFor,
  REFUSAL_CODES,
} from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';

import type { CryptoPort } from '../crypto-port.js';
import { webCrypto } from '../crypto-web.js';

const CODE = 'odp_' + '0123456789abcdef'.repeat(4);
const ID = '00112233445566778899aabbccddeeff';
const H = Buffer.alloc(32, 0x11);
const N1 = Buffer.alloc(32, 0x22);
const N2 = Buffer.alloc(32, 0x33);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('channel golden vectors', () => {
  it('prologueFor encodes each mode', () => {
    expect(hex(prologueFor('link', null))).toBe('6f7665726465636b2d6c696e6b2f31000100');
    expect(hex(prologueFor('pairing', ID))).toBe(
      '6f7665726465636b2d6c696e6b2f310002003030313132323333343435353636373738383939616162626363646465656666',
    );
    expect(hex(prologueFor('approval', ID))).toBe(
      '6f7665726465636b2d6c696e6b2f310003003030313132323333343435353636373738383939616162626363646465656666',
    );
  });

  it('encodePreamble encodes each mode', () => {
    expect(hex(encodePreamble({ linkProtocol: 1, mode: 'link', pairingId: null }))).toBe('004f56444c0101');
    expect(hex(encodePreamble({ linkProtocol: 1, mode: 'pairing', pairingId: ID }))).toBe(
      '004f56444c010200112233445566778899aabbccddeeff',
    );
    expect(hex(encodePreamble({ linkProtocol: 1, mode: 'approval', pairingId: ID }))).toBe(
      '004f56444c010300112233445566778899aabbccddeeff',
    );
  });

  it('encodeFrame prefixes a three-byte length', () => {
    expect(hex(encodeFrame(Uint8Array.of(1, 2, 3)))).toBe('030000010203');
  });

  it('encodeRefusal encodes every refusal code', () => {
    expect(hex(encodeRefusal({ code: REFUSAL_CODES.unknownPeer }))).toBe('00000001');
    expect(hex(encodeRefusal({ code: REFUSAL_CODES.unsupported, linkProtocol: 2, serverVersion: '0.73.0' }))).toBe(
      '000000020206302e37332e30',
    );
    expect(hex(encodeRefusal({ code: REFUSAL_CODES.pairingRefused }))).toBe('00000003');
    expect(hex(encodeRefusal({ code: REFUSAL_CODES.busy }))).toBe('00000004');
  });
});

describe.each<[string, CryptoPort]>([
  ['node', nodeCrypto],
  ['web', webCrypto],
])('channel golden vectors on the %s crypto port', (_name, crypto) => {
  it('pairingSecrets derives the pinned psk and pairing id', () => {
    const secrets = pairingSecrets(crypto, CODE);
    expect(hex(secrets.psk)).toBe('fa159b7cec33c9ba81b087f2b4df399f1f8010f621c729668ce0888feeab9eab');
    expect(secrets.pairingId).toBe('459da3680c207caad2eabda9f4f1f320');
  });

  it('approvalCommitment and approvalSas derive the pinned values', () => {
    expect(hex(approvalCommitment(crypto, H, N1))).toBe('df77002e0a3d334790fd3b7890ce65bd06dbfaf3e3b36a7048cd4a09cee7d40e');
    expect(approvalSas(crypto, H, N1, N2)).toBe('553 891');
  });
});
