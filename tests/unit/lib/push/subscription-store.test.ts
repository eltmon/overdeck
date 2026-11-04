import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addPushSubscription,
  listPushSubscriptions,
  recordPushDelivery,
  removePushSubscription,
  subscriptionsPath,
  validatePushEndpoint,
} from '../../../../src/lib/push/subscription-store.js';

function subscriberKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

describe('push endpoint allowlist (PAN-2354)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QOxAbc',
    'https://api.push.apple.com/x',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('allows %s', (url) => {
    expect(validatePushEndpoint(url)).toEqual({ ok: true });
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://evil.example/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user@fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/x',
  ])('rejects %s', (url) => {
    expect(validatePushEndpoint(url)).toEqual({ ok: false, reason: 'endpoint-not-allowed' });
  });

  it('reports an unparsable endpoint as invalid', () => {
    expect(validatePushEndpoint('not a url')).toEqual({ ok: false, reason: 'endpoint-invalid' });
  });

  it('accepts an extra host only when passed explicitly', () => {
    expect(validatePushEndpoint('https://push.test/x').ok).toBe(false);
    expect(validatePushEndpoint('https://push.test/x', ['push.test'])).toEqual({ ok: true });
  });
});

describe('push subscription store (PAN-2354)', () => {
  let home: string;
  const previousHome = process.env.OVERDECK_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'overdeck-push-subs-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  it('upserts the same endpoint into one record with the same id', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/same';
    const first = await addPushSubscription({ endpoint, keys: subscriberKeys(), label: 'Old', credentialId: null });
    const second = await addPushSubscription({ endpoint, keys: subscriberKeys(), label: 'New', credentialId: 'dev-1' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.record.id).toBe(first.record.id);
    const all = await listPushSubscriptions();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ label: 'New', credentialId: 'dev-1' });
  });

  it('rejects the 21st distinct endpoint with subscription-limit', async () => {
    for (let i = 0; i < 20; i++) {
      const result = await addPushSubscription({
        endpoint: `https://fcm.googleapis.com/fcm/send/${i}`,
        keys: subscriberKeys(),
        credentialId: null,
      });
      expect(result.ok).toBe(true);
    }
    const overflow = await addPushSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/21st',
      keys: subscriberKeys(),
      credentialId: null,
    });
    expect(overflow).toEqual({ ok: false, reason: 'subscription-limit' });
    expect(await listPushSubscriptions()).toHaveLength(20);
  });

  it('writes the file with mode 0600', async () => {
    await addPushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/m', keys: subscriberKeys(), credentialId: null });
    expect((await stat(subscriptionsPath())).mode & 0o777).toBe(0o600);
  });

  it('removes a record once: true then false', async () => {
    const added = await addPushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/r', keys: subscriberKeys(), credentialId: null });
    if (!added.ok) throw new Error('add failed');
    expect(await removePushSubscription(added.record.id)).toBe(true);
    expect(await removePushSubscription(added.record.id)).toBe(false);
  });

  it('rejects malformed keys and a disallowed endpoint', async () => {
    expect(await addPushSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/k',
      keys: { p256dh: 'short', auth: 'x' },
      credentialId: null,
    })).toEqual({ ok: false, reason: 'keys-invalid' });
    expect(await addPushSubscription({
      endpoint: 'https://evil.example/x',
      keys: subscriberKeys(),
      credentialId: null,
    })).toEqual({ ok: false, reason: 'endpoint-not-allowed' });
  });

  it('defaults the label to Phone and trims it to 60 characters', async () => {
    const plain = await addPushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/l1', keys: subscriberKeys(), credentialId: null });
    const long = await addPushSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/l2',
      keys: subscriberKeys(),
      label: 'x'.repeat(80),
      credentialId: null,
    });
    expect(plain.ok && plain.record.label).toBe('Phone');
    expect(long.ok && long.record.label).toHaveLength(60);
  });

  it('records delivery outcomes', async () => {
    const added = await addPushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/d', keys: subscriberKeys(), credentialId: null });
    if (!added.ok) throw new Error('add failed');
    await recordPushDelivery(added.record.id, 'failure');
    await recordPushDelivery(added.record.id, 'failure');
    expect((await listPushSubscriptions())[0]).toMatchObject({ failureCount: 2 });
    await recordPushDelivery(added.record.id, 'success');
    const [record] = await listPushSubscriptions();
    expect(record?.failureCount).toBe(0);
    expect(record?.lastSuccessAt).not.toBeNull();
  });
});
