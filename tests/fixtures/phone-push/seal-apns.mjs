/**
 * Builds a `simctl push` payload: the directory's placeholder `aps` block
 * (services/connect/src/push/apns.ts `apnsBody`) plus `s`, a v1 PhonePushPayload sealed with
 * sodium-native `crypto_box_seal` to an app install's push public key (PAN-4838 WI-1, WI-10).
 *
 * Run: node tests/fixtures/phone-push/seal-apns.mjs --key <publicKeyHex> --title <t> --body <b> [--machine <id>] [--url <path>]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const sodium = createRequire(import.meta.url)('sodium-native');

export function apnsFixture({ publicKeyHex, title, body, machine = 'env-fixture-1', url = '/m', kind = 'question', tag = 'fixture' }) {
  const publicKey = Buffer.from(publicKeyHex, 'hex');
  if (publicKey.byteLength !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('apnsFixture needs a 32-byte hex public key');
  const payload = { v: 1, machine, kind, title, body, url, tag, issueId: null, ts: new Date().toISOString() };
  const message = Buffer.from(JSON.stringify(payload), 'utf8');
  const sealed = Buffer.alloc(message.byteLength + sodium.crypto_box_SEALBYTES);
  sodium.crypto_box_seal(sealed, message, publicKey);
  return {
    'Simulator Target Bundle': 'ai.overdeck.app',
    aps: { alert: { title: 'Overdeck', body: 'Something needs you' }, 'mutable-content': 1, sound: 'default', 'thread-id': tag },
    s: sealed.toString('base64'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      key: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
      machine: { type: 'string' },
      url: { type: 'string' },
    },
  });
  if (!values.key || values.title === undefined || values.body === undefined) {
    console.error('usage: seal-apns.mjs --key <publicKeyHex> --title <t> --body <b> [--machine <id>] [--url <path>]');
    process.exit(2);
  }
  const fixture = apnsFixture({ publicKeyHex: values.key, title: values.title, body: values.body, machine: values.machine, url: values.url });
  console.log(JSON.stringify(fixture, null, 2));
}
