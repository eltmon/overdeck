import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApnsTokenCache } from '../../../../../services/connect/src/push/apns.ts';
import type { PushConfig, PushRegistration } from '../../../../../services/connect/src/push/config.ts';
import { deliverActivity, deliverPush, PUSH_RETRY_DELAY_MS } from '../../../../../services/connect/src/push/deliver.ts';
import { FCM_TOKEN_URL, FcmTokenCache } from '../../../../../services/connect/src/push/fcm.ts';

const NOW = 1_800_000_000_000;
const SEALED = 'c2VhbGVkLWJsb2I=';
const COLLAPSE = 'c'.repeat(32);
const IOS: PushRegistration = { platform: 'ios', token: 'a1'.repeat(32), apsEnvironment: 'production' };
const ANDROID: PushRegistration = { platform: 'android', token: 'fcm-token', apsEnvironment: null };

function toPem(der: ArrayBuffer): string {
  const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n');
}

/** Answers each send request with the next status in `statuses` (the last one repeats); the token endpoint always succeeds. */
function stubFetch(statuses: number[], body: () => string | null = () => null) {
  const urls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === FCM_TOKEN_URL) return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
    const sends = urls.filter((u) => u !== FCM_TOKEN_URL).length;
    return new Response(body(), { status: statuses[Math.min(sends, statuses.length) - 1] });
  };
  return { fetchFn, sends: () => urls.filter((u) => u !== FCM_TOKEN_URL) };
}

let config: PushConfig;
let apnsTokens: ApnsTokenCache;
let fcmTokens: FcmTokenCache;

beforeAll(async () => {
  const ec = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const rsa = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign'],
  );
  config = {
    apns: { keyP8: toPem(await crypto.subtle.exportKey('pkcs8', ec.privateKey)), keyId: 'KEYID12345', teamId: 'TEAMID1234' },
    fcm: { projectId: 'overdeck-test', clientEmail: 'push@test.iam.gserviceaccount.com', privateKey: toPem(await crypto.subtle.exportKey('pkcs8', rsa.privateKey)) },
  };
  // Sign both tokens on real timers, so the fake-timer tests below never wait on WebCrypto.
  apnsTokens = new ApnsTokenCache();
  await apnsTokens.get(config.apns!, NOW);
  fcmTokens = new FcmTokenCache();
  await fcmTokens.get(config.fcm!, stubFetch([200]).fetchFn, NOW);
});

describe('deliverPush (PAN-4830 WI-6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const req = (registration: PushRegistration) => ({ registration, sealed: SEALED, urgency: 'high' as const, collapseId: COLLAPSE });
  const opts = (fetchFn: typeof fetch, over: Partial<PushConfig> = {}) => ({ config: { ...config, ...over }, fetch: fetchFn, now: () => NOW, apnsTokens, fcmTokens });

  it('sends iOS to APNs and Android to FCM', async () => {
    const stub = stubFetch([200]);
    expect(await deliverPush(req(IOS), opts(stub.fetchFn))).toEqual({ kind: 'delivered' });
    expect(await deliverPush(req(ANDROID), opts(stub.fetchFn))).toEqual({ kind: 'delivered' });
    expect(stub.sends().map((u) => new URL(u).host)).toEqual(['api.push.apple.com', 'fcm.googleapis.com']);
  });

  it('answers not_configured with no request when the provider is unset', async () => {
    const stub = stubFetch([200]);
    expect(await deliverPush(req(IOS), opts(stub.fetchFn, { apns: null }))).toEqual({ kind: 'not_configured' });
    expect(await deliverPush(req(ANDROID), opts(stub.fetchFn, { fcm: null }))).toEqual({ kind: 'not_configured' });
    expect(stub.sends()).toHaveLength(0);
  });

  it('retries a 503 once, exactly 2,000 ms later', async () => {
    const stub = stubFetch([503, 200]);
    const pending = deliverPush(req(IOS), opts(stub.fetchFn));
    await vi.advanceTimersByTimeAsync(PUSH_RETRY_DELAY_MS - 1);
    expect(stub.sends()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: 'delivered' });
    expect(stub.sends()).toHaveLength(2);
  });

  it('fails with the second detail after two 503s', async () => {
    const stub = stubFetch([503, 503]);
    const pending = deliverPush(req(IOS), opts(stub.fetchFn));
    await vi.advanceTimersByTimeAsync(PUSH_RETRY_DELAY_MS);
    expect(await pending).toEqual({ kind: 'failed', detail: 'apns_503' });
    expect(stub.sends()).toHaveLength(2);
  });

  it('retries an FCM 500 once', async () => {
    const stub = stubFetch([500, 200]);
    const pending = deliverPush(req(ANDROID), opts(stub.fetchFn));
    await vi.advanceTimersByTimeAsync(PUSH_RETRY_DELAY_MS);
    expect(await pending).toEqual({ kind: 'delivered' });
    expect(stub.sends()).toHaveLength(2);
  });

  it('does not retry a 410 or a non-dead 400', async () => {
    const gone = stubFetch([410]);
    expect(await deliverPush(req(IOS), opts(gone.fetchFn))).toEqual({ kind: 'gone' });
    expect(gone.sends()).toHaveLength(1);

    const bad = stubFetch([400], () => JSON.stringify({ reason: 'PayloadTooLarge' }));
    expect(await deliverPush(req(IOS), opts(bad.fetchFn))).toEqual({ kind: 'failed', detail: 'apns_400' });
    expect(bad.sends()).toHaveLength(1);
  });

  it('retries a send that times out, and fails after the second timeout', async () => {
    const urls: string[] = [];
    const never: typeof fetch = (input) => {
      urls.push(String(input));
      return new Promise<Response>(() => undefined);
    };
    const pending = deliverPush(req(IOS), opts(never));
    const settled = vi.fn();
    pending.then(settled, settled);
    await vi.advanceTimersByTimeAsync(2_000 + PUSH_RETRY_DELAY_MS + 1_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: 'failed', detail: 'apns_network' });
    expect(urls).toHaveLength(2);
  });
});

describe('deliverActivity (PAN-4839 WI-3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const req = { token: IOS.token, apsEnvironment: 'production' as const, needsYou: 3, running: 2, priority: 'high' as const };
  const opts = (fetchFn: typeof fetch, over: Partial<PushConfig> = {}, sleep?: (ms: number) => Promise<void>) => ({
    config: { ...config, ...over },
    fetch: fetchFn,
    now: () => NOW,
    apnsTokens,
    fcmTokens,
    sleep,
  });

  it('sends one Live Activity request to APNs', async () => {
    const stub = stubFetch([200]);
    expect(await deliverActivity(req, opts(stub.fetchFn))).toEqual({ kind: 'delivered' });
    expect(stub.sends().map((u) => new URL(u).host)).toEqual(['api.push.apple.com']);
  });

  it('answers not_configured with no request when APNs is unset', async () => {
    const stub = stubFetch([200]);
    expect(await deliverActivity(req, opts(stub.fetchFn, { apns: null }))).toEqual({ kind: 'not_configured' });
    expect(stub.sends()).toHaveLength(0);
  });

  it('retries a 503 once after one injected 2,000 ms sleep', async () => {
    const stub = stubFetch([503, 200]);
    const sleep = vi.fn(async (_ms: number) => {});
    expect(await deliverActivity(req, opts(stub.fetchFn, {}, sleep))).toEqual({ kind: 'delivered' });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(stub.sends()).toHaveLength(2);
  });

  it('answers gone for a 410 with no retry', async () => {
    const stub = stubFetch([410]);
    expect(await deliverActivity(req, opts(stub.fetchFn))).toEqual({ kind: 'gone' });
    expect(stub.sends()).toHaveLength(1);
  });
});
