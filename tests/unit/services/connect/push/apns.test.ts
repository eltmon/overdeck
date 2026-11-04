import { beforeAll, describe, expect, it } from 'vitest';
import {
  APNS_LIVE_ACTIVITY_TOPIC,
  APNS_TOPIC,
  ApnsTokenCache,
  apnsActivityBody,
  apnsBody,
  sendApns,
  sendApnsActivity,
} from '../../../../../services/connect/src/push/apns.ts';
import type { ActivityPushRequest, ApnsConfig, PushRegistration } from '../../../../../services/connect/src/push/config.ts';
import { base64UrlToBytes } from '../../../../../services/connect/src/push/jwt.ts';

const T0_SECONDS = 2_700 * 1_000_000;
const T0 = T0_SECONDS * 1000;
const MINUTE = 60_000;
const SEALED = 'c2VhbGVkLWJsb2I=';
const COLLAPSE = 'c'.repeat(32);
const TOKEN = 'a1'.repeat(32);

function toPem(der: ArrayBuffer): string {
  const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n');
}

function decodePart(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

interface Captured {
  url: string;
  headers: Headers;
  body: string;
}

function stubFetch(answer: () => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
    return answer();
  };
  return { fetchFn, calls };
}

let config: ApnsConfig;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  publicKey = pair.publicKey;
  config = { keyP8: toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), keyId: 'KEYID12345', teamId: 'TEAMID1234' };
});

const ios = (apsEnvironment: 'production' | 'sandbox' = 'production', token = TOKEN): PushRegistration => ({ platform: 'ios', token, apsEnvironment });

describe('APNs provider token (PAN-4830 WI-4)', () => {
  it('is an ES256 JWT with { alg, kid } and { iss, iat } that verifies with the public key', async () => {
    const jwt = await new ApnsTokenCache().get(config, T0 + 5 * MINUTE);
    const [header, claims, signature] = jwt.split('.');
    expect(decodePart(header)).toEqual({ alg: 'ES256', kid: 'KEYID12345' });
    expect(decodePart(claims)).toEqual({ iss: 'TEAMID1234', iat: T0_SECONDS });
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64UrlToBytes(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it('keeps one token for a 45-minute window and changes it after', async () => {
    const cache = new ApnsTokenCache();
    const first = await cache.get(config, T0);
    expect(await cache.get(config, T0 + 44 * MINUTE)).toBe(first);
    const next = await cache.get(config, T0 + 46 * MINUTE);
    expect(next).not.toBe(first);
    expect(decodePart(next.split('.')[1])).toEqual({ iss: 'TEAMID1234', iat: T0_SECONDS + 2_700 });
  });

  it('derives byte-identical tokens in separate caches at the same time', async () => {
    const a = await new ApnsTokenCache().get(config, T0 + 10 * MINUTE);
    const b = await new ApnsTokenCache().get(config, T0 + 20 * MINUTE);
    expect(a).toBe(b);
  });
});

describe('sendApns (PAN-4830 WI-4)', () => {
  const opts = (fetchFn: typeof fetch) => ({ config, fetch: fetchFn, now: () => T0, tokens: new ApnsTokenCache() });

  it('sends exactly the placeholder alert and sealed blob to the sandbox host with high priority', async () => {
    const { fetchFn, calls } = stubFetch(() => new Response(null, { status: 200 }));
    const result = await sendApns({ registration: ios('sandbox'), sealed: SEALED, urgency: 'high', collapseId: COLLAPSE }, opts(fetchFn));
    expect(result).toEqual({ kind: 'delivered' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
    const jwt = await new ApnsTokenCache().get(config, T0);
    expect(Object.fromEntries(calls[0].headers)).toEqual({
      authorization: `bearer ${jwt}`,
      'apns-push-type': 'alert',
      'apns-topic': APNS_TOPIC,
      'apns-priority': '10',
      'apns-collapse-id': COLLAPSE,
      'content-type': 'application/json',
    });
    expect(JSON.parse(calls[0].body)).toEqual(apnsBody(SEALED, COLLAPSE));
    expect(JSON.parse(calls[0].body)).toEqual({
      aps: { alert: { title: 'Overdeck', body: 'Something needs you' }, 'mutable-content': 1, sound: 'default', 'thread-id': COLLAPSE },
      s: SEALED,
    });
  });

  it('uses the production host and priority 5 for a normal push', async () => {
    const { fetchFn, calls } = stubFetch(() => new Response(null, { status: 200 }));
    await sendApns({ registration: ios('production'), sealed: SEALED, urgency: 'normal', collapseId: COLLAPSE }, opts(fetchFn));
    expect(calls[0].url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    expect(calls[0].headers.get('apns-priority')).toBe('5');
  });

  it('percent-encodes a token containing a slash', async () => {
    const { fetchFn, calls } = stubFetch(() => new Response(null, { status: 200 }));
    await sendApns({ registration: ios('production', 'ab/cd'), sealed: SEALED, urgency: 'high', collapseId: COLLAPSE }, opts(fetchFn));
    expect(calls[0].url).toBe('https://api.push.apple.com/3/device/ab%2Fcd');
  });

  it.each([
    ['410', () => new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 410 }), { kind: 'gone' }],
    ['400 BadDeviceToken', () => new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 }), { kind: 'gone' }],
    ['400 DeviceTokenNotForTopic', () => new Response(JSON.stringify({ reason: 'DeviceTokenNotForTopic' }), { status: 400 }), { kind: 'gone' }],
    ['400 Unregistered', () => new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 400 }), { kind: 'gone' }],
    ['400 PayloadTooLarge', () => new Response(JSON.stringify({ reason: 'PayloadTooLarge' }), { status: 400 }), { kind: 'failed', detail: 'apns_400' }],
    ['400 without JSON', () => new Response('nope', { status: 400 }), { kind: 'failed', detail: 'apns_400' }],
    ['403', () => new Response(JSON.stringify({ reason: 'ExpiredProviderToken' }), { status: 403 }), { kind: 'failed', detail: 'apns_403' }],
    ['429', () => new Response(null, { status: 429 }), { kind: 'failed', detail: 'apns_429' }],
    ['503', () => new Response(null, { status: 503 }), { kind: 'retryable', detail: 'apns_503' }],
  ] as const)('maps %s', async (_name, answer, expected) => {
    const { fetchFn } = stubFetch(answer);
    expect(await sendApns({ registration: ios(), sealed: SEALED, urgency: 'high', collapseId: COLLAPSE }, opts(fetchFn))).toEqual(expected);
  });

  it('maps a rejecting fetch to retryable apns_network', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    expect(await sendApns({ registration: ios(), sealed: SEALED, urgency: 'high', collapseId: COLLAPSE }, opts(fetchFn)))
      .toEqual({ kind: 'retryable', detail: 'apns_network' });
  });

  it('answers failed bad_key without a request when the key does not import', async () => {
    const { fetchFn, calls } = stubFetch(() => new Response(null, { status: 200 }));
    const result = await sendApns(
      { registration: ios(), sealed: SEALED, urgency: 'high', collapseId: COLLAPSE },
      { config: { ...config, keyP8: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }, fetch: fetchFn, now: () => T0, tokens: new ApnsTokenCache() },
    );
    expect(result).toEqual({ kind: 'failed', detail: 'bad_key' });
    expect(calls).toHaveLength(0);
  });
});

describe('sendApnsActivity (PAN-4839 WI-3)', () => {
  const opts = (fetchFn: typeof fetch) => ({ config, fetch: fetchFn, now: () => T0 + 1_500, tokens: new ApnsTokenCache() });
  const activity = (over: Partial<ActivityPushRequest> = {}): ActivityPushRequest => ({
    token: TOKEN,
    apsEnvironment: 'production',
    needsYou: 3,
    running: 2,
    priority: 'high',
    ...over,
  });
  const timestamp = T0_SECONDS + 1;

  it('sends exactly the timing fields and the two counts', async () => {
    const { fetchFn, calls } = stubFetch(() => new Response(null, { status: 200 }));
    expect(await sendApnsActivity(activity(), opts(fetchFn))).toEqual({ kind: 'delivered' });
    const body = JSON.parse(calls[0].body);
    expect(body).toEqual({ aps: { timestamp, event: 'update', 'content-state': { needsYou: 3, running: 2 }, 'stale-date': timestamp + 600 } });
    expect(body).toEqual(apnsActivityBody(3, 2, T0 + 1_500));
    expect(Object.keys(body.aps['content-state'])).toEqual(['needsYou', 'running']);
  });

  it('sends the liveactivity headers with priority 10 and no collapse id', async () => {
    const { fetchFn, calls } = stubFetch(() => new Response(null, { status: 200 }));
    await sendApnsActivity(activity(), opts(fetchFn));
    expect(calls[0].url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    const jwt = await new ApnsTokenCache().get(config, T0);
    expect(Object.fromEntries(calls[0].headers)).toEqual({
      authorization: `bearer ${jwt}`,
      'apns-push-type': 'liveactivity',
      'apns-topic': APNS_LIVE_ACTIVITY_TOPIC,
      'apns-priority': '10',
      'apns-expiration': String(timestamp + 600),
      'content-type': 'application/json',
    });
    expect(APNS_LIVE_ACTIVITY_TOPIC).toBe('ai.overdeck.app.push-type.liveactivity');
    expect(calls[0].headers.has('apns-collapse-id')).toBe(false);
  });

  it('uses priority 5 for a refresh and the sandbox host for a sandbox token', async () => {
    const { fetchFn, calls } = stubFetch(() => new Response(null, { status: 200 }));
    await sendApnsActivity(activity({ priority: 'normal', apsEnvironment: 'sandbox' }), opts(fetchFn));
    expect(calls[0].url).toBe(`https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
    expect(calls[0].headers.get('apns-priority')).toBe('5');
  });

  it('maps 410 to gone, 503 to retryable and 403 to failed', async () => {
    expect(await sendApnsActivity(activity(), opts(stubFetch(() => new Response(null, { status: 410 })).fetchFn))).toEqual({ kind: 'gone' });
    expect(await sendApnsActivity(activity(), opts(stubFetch(() => new Response(null, { status: 503 })).fetchFn))).toEqual({
      kind: 'retryable',
      detail: 'apns_503',
    });
    expect(await sendApnsActivity(activity(), opts(stubFetch(() => new Response(null, { status: 403 })).fetchFn))).toEqual({
      kind: 'failed',
      detail: 'apns_403',
    });
  });
});
