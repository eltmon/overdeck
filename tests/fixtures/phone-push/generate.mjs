/**
 * Generates sealed-question.json: one PhonePushPayload sealed with sodium-native's
 * crypto_box_seal, the way the machine seals phone pushes (src/lib/anywhere/sealed-box.ts).
 * The phone apps' tests open it to prove a machine-sealed payload decrypts on the device
 * (PAN-4840 Android, PAN-4838 iOS).
 *
 * The key pair is test-only: it is generated fresh on each run and protects nothing.
 *
 * Run from the repo root: node tests/fixtures/phone-push/generate.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const sodium = require('sodium-native');

const publicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
const secretKey = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
sodium.crypto_box_keypair(publicKey, secretKey);

const payload = {
  v: 1,
  machine: 'e91ffda1-431a-483d-a6e4-a72079516ea4',
  kind: 'question',
  title: 'PAN-4840 asks: Ship the Android handler?',
  body: 'Choose one: yes, no, later',
  url: '/m?subject=pan-4840-conv',
  tag: 'auq:toolu_fixture',
  issueId: 'PAN-4840',
  ts: '2026-11-03T20:00:00.000Z',
};

const message = Buffer.from(JSON.stringify(payload), 'utf8');
const sealed = Buffer.alloc(message.byteLength + sodium.crypto_box_SEALBYTES);
sodium.crypto_box_seal(sealed, message, publicKey);

const tampered = Buffer.from(sealed);
tampered[tampered.byteLength - 1] ^= 0x01;

const fixture = {
  publicKeyHex: publicKey.toString('hex'),
  secretKeyHex: secretKey.toString('hex'),
  payload,
  sealedBase64: sealed.toString('base64'),
  tamperedBase64: tampered.toString('base64'),
};

writeFileSync(new URL('./sealed-question.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
