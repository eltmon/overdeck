import { createECDH, randomBytes, type ECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ece from 'http_ece';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPushConfig } from '../../../../src/lib/config-yaml/push-config.js';
import { addPushSubscription, listPushSubscriptions } from '../../../../src/lib/push/subscription-store.js';
import type { NeedsYouNotification } from '../../../../src/lib/push/types.js';
import { createWebPushProvider } from '../../../../src/lib/push/webpush-provider.js';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

const notification: NeedsYouNotification = {
  kind: 'question',
  tag: 'auq:toolu_01',
  title: 'Question · Secret conversation title',
  publicTitle: 'Question · a conversation',
  body: 'Tap to answer.',
  url: '/m?subject=my-conv',
  issueId: null,
  ts: '2026-11-01T00:00:00.000Z',
};

function subscriber(): { ecdh: ECDH; auth: Buffer; keys: { p256dh: string; auth: string } } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

function recordingFetch(statuses: Array<number | Error>): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: Buffer.from(init?.body as Uint8Array),
    });
    const next = statuses.shift() ?? 201;
    if (next instanceof Error) throw next;
    return new Response(null, { status: next });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('Web Push provider (PAN-2354)', () => {
  let home: string;
  const previousHome = process.env.OVERDECK_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'overdeck-webpush-'));
    process.env.OVERDECK_HOME = home;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  async function subscribe(keys: { p256dh: string; auth: string }, credentialId: string | null = null): Promise<string> {
    const added = await addPushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys, credentialId });
    if (!added.ok) throw new Error(`subscribe failed: ${added.reason}`);
    return added.record.id;
  }

  function provider(fetchImpl: typeof fetch, revokedIds: string[] = []) {
    return createWebPushProvider({
      fetchImpl,
      readConfig: defaultPushConfig,
      listCredentials: async () => [
        { id: 'dev-live' },
        ...revokedIds.map(id => ({ id, revokedAt: '2026-11-01T00:00:00.000Z' })),
      ],
    });
  }

  it('round-trips: the body decrypts with the subscriber key to exactly {title, body, url, tag}', async () => {
    const sub = subscriber();
    await subscribe(sub.keys);
    const { fetchImpl, calls } = recordingFetch([201]);
    const outcomes = await provider(fetchImpl).send(notification);
    expect(outcomes).toEqual([expect.objectContaining({ ok: true })]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://fcm.googleapis.com/fcm/send/abc');

    const plain = ece.decrypt(calls[0]!.body, { version: 'aes128gcm', privateKey: sub.ecdh, authSecret: sub.auth.toString('base64url') });
    const parsed = JSON.parse(plain.toString('utf8')) as Record<string, unknown>;
    expect(parsed).toEqual({ title: notification.title, body: notification.body, url: notification.url, tag: notification.tag });
    expect(Object.keys(parsed).sort()).toEqual(['body', 'tag', 'title', 'url']);
  });

  it('is unreadable at the push service: no plaintext title, and another key cannot decrypt it', async () => {
    const sub = subscriber();
    await subscribe(sub.keys);
    const { fetchImpl, calls } = recordingFetch([201]);
    await provider(fetchImpl).send(notification);
    const body = calls[0]!.body;
    expect(body.includes(Buffer.from('Secret conversation title'))).toBe(false);
    const other = createECDH('prime256v1');
    other.generateKeys();
    expect(() => ece.decrypt(body, { version: 'aes128gcm', privateKey: other, authSecret: sub.auth.toString('base64url') })).toThrow();
  });

  it('sends aes128gcm, TTL 3600, high urgency for a question, and a VAPID authorization', async () => {
    await subscribe(subscriber().keys);
    const { fetchImpl, calls } = recordingFetch([201]);
    await provider(fetchImpl).send(notification);
    const headers = calls[0]!.headers;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers['TTL']).toBe('3600');
    expect(headers['Urgency']).toBe('high');
    expect(headers['Authorization']).toMatch(/^vapid t=/);
    expect(headers['Topic']).toHaveLength(32);
  });

  it('removes the subscription when the push service answers 410', async () => {
    await subscribe(subscriber().keys);
    const { fetchImpl } = recordingFetch([410]);
    const outcomes = await provider(fetchImpl).send(notification);
    expect(outcomes).toEqual([expect.objectContaining({ ok: false, reason: 'gone', status: 410 })]);
    expect(await listPushSubscriptions()).toEqual([]);
  });

  it('retries a 503 exactly once, only after 5 s', async () => {
    await subscribe(subscriber().keys);
    let firstCall!: () => void;
    const firstCalled = new Promise<void>((resolve) => { firstCall = resolve; });
    const { fetchImpl: inner, calls } = recordingFetch([503, 201]);
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      const response = await inner(...args);
      firstCall();
      return response;
    }) as typeof fetch;

    const pending = provider(fetchImpl).send(notification);
    await firstCalled;
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const outcomes = await pending;
    expect(calls).toHaveLength(2);
    expect(outcomes).toEqual([expect.objectContaining({ ok: true })]);
  });

  it('sends nothing to a revoked device and removes its subscription', async () => {
    await subscribe(subscriber().keys, 'dev-revoked');
    const { fetchImpl, calls } = recordingFetch([201]);
    const outcomes = await provider(fetchImpl, ['dev-revoked']).send(notification);
    expect(calls).toHaveLength(0);
    expect(outcomes).toEqual([expect.objectContaining({ ok: false, reason: 'revoked' })]);
    expect(await listPushSubscriptions()).toEqual([]);
  });

  it('sends to a live paired device', async () => {
    await subscribe(subscriber().keys, 'dev-live');
    const { fetchImpl, calls } = recordingFetch([201]);
    await provider(fetchImpl).send(notification);
    expect(calls).toHaveLength(1);
  });

  it('has targets only when a subscription exists', async () => {
    const { fetchImpl } = recordingFetch([]);
    const p = provider(fetchImpl);
    expect(await p.hasTargets()).toBe(false);
    await subscribe(subscriber().keys);
    expect(await p.hasTargets()).toBe(true);
  });
});
