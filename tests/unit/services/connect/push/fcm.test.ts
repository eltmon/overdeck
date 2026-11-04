import { beforeAll, describe, expect, it } from 'vitest';
import type { FcmConfig, PushRegistration } from '../../../../../services/connect/src/push/config.ts';
import { FCM_SCOPE, FCM_TOKEN_URL, FcmTokenCache, fcmBody, sendFcm } from '../../../../../services/connect/src/push/fcm.ts';
import { base64UrlToBytes } from '../../../../../services/connect/src/push/jwt.ts';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const SEALED = 'c2VhbGVkLWJsb2I=';
const COLLAPSE = 'c'.repeat(32);
const SEND_URL = 'https://fcm.googleapis.com/v1/projects/overdeck-test/messages:send';
const ANDROID: PushRegistration = { platform: 'android', token: 'fcm-token:abc_1', apsEnvironment: null };

function toPem(der: ArrayBuffer): string {
  const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n');
}

interface Captured {
  url: string;
  headers: Headers;
  body: string;
}

/** Answers the token endpoint with `token`, and the send endpoint with `send()`. */
function stubFetch(send: () => Response, token: () => Response = () => Response.json({ access_token: 'ya29.test', expires_in: 3600 })) {
  const calls: Captured[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
    return url === FCM_TOKEN_URL ? token() : send();
  };
  return { fetchFn, calls, tokenCalls: () => calls.filter((c) => c.url === FCM_TOKEN_URL), sendCalls: () => calls.filter((c) => c.url === SEND_URL) };
}

let config: FcmConfig;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  publicKey = pair.publicKey;
  config = { projectId: 'overdeck-test', clientEmail: 'push@test.iam.gserviceaccount.com', privateKey: toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey)) };
});

const push = (urgency: 'high' | 'normal' = 'high') => ({ registration: ANDROID, sealed: SEALED, urgency, collapseId: COLLAPSE });

describe('FCM access token (PAN-4830 WI-5)', () => {
  it('exchanges a form-encoded jwt-bearer assertion whose claims are exactly FR-7 and verify', async () => {
    const stub = stubFetch(() => new Response(null, { status: 200 }));
    await sendFcm(push(), { config, fetch: stub.fetchFn, now: () => NOW, tokens: new FcmTokenCache() });
    const [request] = stub.tokenCalls();
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(request.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = (form.get('assertion') ?? '').split('.');
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as unknown;
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const iat = NOW / 1000;
    expect(decode(claims)).toEqual({ iss: config.clientEmail, scope: FCM_SCOPE, aud: FCM_TOKEN_URL, iat, exp: iat + 3600 });
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64UrlToBytes(signature), new TextEncoder().encode(`${header}.${claims}`));
    expect(valid).toBe(true);
  });

  it('reuses the access token until 5 minutes before it expires', async () => {
    const tokens = new FcmTokenCache();
    let now = NOW;
    const stub = stubFetch(() => new Response(null, { status: 200 }));
    const opts = { config, fetch: stub.fetchFn, now: () => now, tokens };
    await sendFcm(push(), opts);
    now = NOW + 30 * MINUTE;
    await sendFcm(push(), opts);
    expect(stub.tokenCalls()).toHaveLength(1);
    expect(stub.sendCalls()[1].headers.get('authorization')).toBe('Bearer ya29.test');
    now = NOW + 56 * MINUTE;
    await sendFcm(push(), opts);
    expect(stub.tokenCalls()).toHaveLength(2);
  });

  it.each([
    ['400', () => new Response(null, { status: 400 }), 'fcm_oauth_400'],
    ['a body without access_token', () => Response.json({ expires_in: 3600 }), 'fcm_oauth_bad_response'],
    ['a body without expires_in', () => Response.json({ access_token: 'ya29.test' }), 'fcm_oauth_bad_response'],
  ] as const)('fails without a send when the token endpoint answers %s', async (_name, token, detail) => {
    const stub = stubFetch(() => new Response(null, { status: 200 }), token);
    expect(await sendFcm(push(), { config, fetch: stub.fetchFn, now: () => NOW, tokens: new FcmTokenCache() })).toEqual({ kind: 'failed', detail });
    expect(stub.sendCalls()).toHaveLength(0);
  });

  it('fails with fcm_oauth_network when the token request throws, and bad_key for an unusable key', async () => {
    const throwing: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    expect(await sendFcm(push(), { config, fetch: throwing, now: () => NOW, tokens: new FcmTokenCache() })).toEqual({ kind: 'failed', detail: 'fcm_oauth_network' });
    const stub = stubFetch(() => new Response(null, { status: 200 }));
    const badKey = { ...config, privateKey: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' };
    expect(await sendFcm(push(), { config: badKey, fetch: stub.fetchFn, now: () => NOW, tokens: new FcmTokenCache() })).toEqual({ kind: 'failed', detail: 'bad_key' });
    expect(stub.calls).toHaveLength(0);
  });
});

describe('sendFcm (PAN-4830 WI-5)', () => {
  it('sends exactly the data-only message with the access token', async () => {
    const stub = stubFetch(() => Response.json({ name: 'projects/overdeck-test/messages/1' }));
    const result = await sendFcm(push('normal'), { config, fetch: stub.fetchFn, now: () => NOW, tokens: new FcmTokenCache() });
    expect(result).toEqual({ kind: 'delivered' });
    const [send] = stub.sendCalls();
    expect(send.headers.get('authorization')).toBe('Bearer ya29.test');
    const body = JSON.parse(send.body) as { message: Record<string, unknown> };
    expect(body).toEqual(fcmBody(ANDROID.token, SEALED, 'normal', COLLAPSE));
    expect(body).toEqual({ message: { token: ANDROID.token, data: { s: SEALED }, android: { priority: 'NORMAL', ttl: '3600s', collapse_key: COLLAPSE } } });
    expect(body.message).not.toHaveProperty('notification');
  });

  it('uses priority HIGH for a high-urgency push', () => {
    expect(fcmBody('t', SEALED, 'high', COLLAPSE).message.android.priority).toBe('HIGH');
  });

  it.each([
    ['404', () => new Response(null, { status: 404 }), { kind: 'gone' }],
    ['400 UNREGISTERED', () => Response.json({ error: { code: 400, details: [{ '@type': 'x', errorCode: 'UNREGISTERED' }] } }, { status: 400 }), { kind: 'gone' }],
    ['400 INVALID_ARGUMENT', () => Response.json({ error: { code: 400, details: [{ errorCode: 'INVALID_ARGUMENT' }] } }, { status: 400 }), { kind: 'failed', detail: 'fcm_400' }],
    ['500', () => new Response(null, { status: 500 }), { kind: 'retryable', detail: 'fcm_500' }],
    ['429', () => new Response(null, { status: 429 }), { kind: 'failed', detail: 'fcm_429' }],
  ] as const)('maps %s', async (_name, send, expected) => {
    const stub = stubFetch(send);
    expect(await sendFcm(push(), { config, fetch: stub.fetchFn, now: () => NOW, tokens: new FcmTokenCache() })).toEqual(expected);
  });

  it('maps a rejecting send to retryable fcm_network', async () => {
    const tokens = new FcmTokenCache();
    const ok = stubFetch(() => new Response(null, { status: 200 }));
    await sendFcm(push(), { config, fetch: ok.fetchFn, now: () => NOW, tokens });
    const throwing: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    expect(await sendFcm(push(), { config, fetch: throwing, now: () => NOW, tokens })).toEqual({ kind: 'retryable', detail: 'fcm_network' });
  });

  it('drops the access token on 401 so the next send fetches a new one', async () => {
    const tokens = new FcmTokenCache();
    let status = 401;
    const stub = stubFetch(() => new Response(null, { status }));
    const opts = { config, fetch: stub.fetchFn, now: () => NOW, tokens };
    expect(await sendFcm(push(), opts)).toEqual({ kind: 'failed', detail: 'fcm_401' });
    status = 200;
    expect(await sendFcm(push(), opts)).toEqual({ kind: 'delivered' });
    expect(stub.tokenCalls()).toHaveLength(2);
  });
});
