/**
 * Writes sealed-push.json: phone push payloads sealed by sodium-native `crypto_box_seal`, the
 * library the machine seals with (src/lib/anywhere/sealed-box.ts). The Swift OverdeckPush test
 * and tests/unit/lib/push/phone-push-fixture.test.ts both open it (PAN-4838 WI-1, NFR-1).
 *
 * It also writes sealed-question.json for the Android SealedBoxTest (PAN-4840 WI-1): one payload
 * whose machine is a real environment UUID, plus the same box with its last byte flipped.
 *
 * The key pairs are fixed test fixtures from constant seeds, never used by a real install.
 * Run: node tests/fixtures/phone-push/generate.mjs
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sodium = createRequire(import.meta.url)('sodium-native');

function seededKeyPair(fill) {
  const publicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  const secretKey = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
  sodium.crypto_box_seed_keypair(publicKey, secretKey, Buffer.alloc(32, fill));
  return { publicKey, secretKey };
}

function seal(publicKey, payload) {
  const message = Buffer.from(JSON.stringify(payload), 'utf8');
  const out = Buffer.alloc(message.byteLength + sodium.crypto_box_SEALBYTES);
  sodium.crypto_box_seal(out, message, publicKey);
  return out.toString('base64');
}

const phone = seededKeyPair(0x2a);
const wrong = seededKeyPair(0x17);

const payloads = {
  question: {
    v: 1,
    machine: 'env-fixture-1',
    kind: 'question',
    title: 'Agent asks: deploy now?',
    body: 'PAN-1: pick one of 2 options',
    url: '/m?subject=conv-1',
    tag: 'q:conv-1',
    issueId: 'PAN-1',
    ts: '2026-11-03T00:00:00.000Z',
  },
  unicode: {
    v: 1,
    machine: 'env-fixture-1',
    kind: 'finished',
    title: 'Überprüfung ✅ 完了',
    body: 'Ünïcödé 🚀',
    url: '/m',
    tag: 'f:conv-2',
    issueId: null,
    ts: '2026-11-03T00:00:01.000Z',
  },
};

const fixture = {
  publicKeyHex: phone.publicKey.toString('hex'),
  secretKeyHex: phone.secretKey.toString('hex'),
  cases: Object.entries(payloads).map(([name, payload]) => ({ name, payload, sealed: seal(phone.publicKey, payload) })),
  wrongKey: { sealed: seal(wrong.publicKey, payloads.question) },
};

writeFileSync(fileURLToPath(new URL('./sealed-push.json', import.meta.url)), `${JSON.stringify(fixture, null, 2)}\n`);

const android = seededKeyPair(0x40);
const question = {
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
const sealed = Buffer.from(seal(android.publicKey, question), 'base64');
const tampered = Buffer.from(sealed);
tampered[tampered.byteLength - 1] ^= 0x01;

const androidFixture = {
  publicKeyHex: android.publicKey.toString('hex'),
  secretKeyHex: android.secretKey.toString('hex'),
  payload: question,
  sealedBase64: sealed.toString('base64'),
  tamperedBase64: tampered.toString('base64'),
};

writeFileSync(fileURLToPath(new URL('./sealed-question.json', import.meta.url)), `${JSON.stringify(androidFixture, null, 2)}\n`);
