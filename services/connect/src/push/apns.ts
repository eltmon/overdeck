/**
 * APNs delivery: the ES256 provider token and the alert request (PRD PAN-4830 WI-4, FR-4, FR-5, FR-8,
 * D-9, D-10, NFR-1).
 *
 * The provider token's `iat` is quantized down to a 45-minute window and signed with RFC 6979
 * deterministic ECDSA, so every Durable Object in every isolate derives the byte-identical token
 * for a window and Apple sees one token change per 45 minutes (it answers 429
 * TooManyProviderTokenUpdates to faster churn). A token is at most 45 minutes old; Apple accepts 60.
 *
 * The request carries only fixed placeholder text, the collapse id and the sealed blob; the phone's
 * notification service extension opens the blob. Never log the token, the JWT, the key or `sealed`.
 */
import { p256 } from '@noble/curves/nist.js';
import type { ApnsConfig, PushRequest, SendResult } from './config.ts';
import { fetchWithTimeout } from './http.ts';
import { base64UrlBytes, base64UrlToBytes, pemToDer, signingInput } from './jwt.ts';

export const APNS_TOPIC = 'ai.overdeck.app';
export const PLACEHOLDER_TITLE = 'Overdeck';
export const PLACEHOLDER_BODY = 'Something needs you';
export const APNS_TOKEN_WINDOW_SECONDS = 2_700;
/** 400 reasons that mean the token will never work again. */
export const APNS_DEAD_REASONS: readonly string[] = ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'];

/** The 32-byte P-256 scalar of a PKCS#8 `.p8` key, read through WebCrypto's JWK export (D-10). */
async function readScalar(keyP8: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(keyP8), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey;
  if (typeof jwk.d !== 'string') throw new Error('no private scalar');
  const d = base64UrlToBytes(jwk.d);
  if (d.length !== 32) throw new Error('bad private scalar');
  return d;
}

/** Provider tokens per `(teamId, keyId)`. Tests pass a fresh instance; production shares one per isolate. */
export class ApnsTokenCache {
  private readonly tokens = new Map<string, { iat: number; jwt: string }>();
  private readonly scalars = new Map<string, Uint8Array>();

  async get(config: ApnsConfig, nowMs: number): Promise<string> {
    const iat = Math.floor(nowMs / 1000 / APNS_TOKEN_WINDOW_SECONDS) * APNS_TOKEN_WINDOW_SECONDS;
    const cacheKey = `${config.teamId}:${config.keyId}`;
    const cached = this.tokens.get(cacheKey);
    if (cached?.iat === iat) return cached.jwt;
    let d = this.scalars.get(config.keyId);
    if (!d) {
      d = await readScalar(config.keyP8);
      this.scalars.set(config.keyId, d);
    }
    const input = signingInput({ alg: 'ES256', kid: config.keyId }, { iss: config.teamId, iat });
    const signature = p256.sign(new TextEncoder().encode(input), d, { prehash: true, format: 'compact', extraEntropy: false });
    const jwt = `${input}.${base64UrlBytes(signature)}`;
    this.tokens.set(cacheKey, { iat, jwt });
    return jwt;
  }
}

export const sharedApnsTokens = new ApnsTokenCache();

/** The whole APNs payload (FR-4): placeholder alert, `thread-id` for grouping, and the sealed blob. */
export function apnsBody(sealed: string, collapseId: string) {
  return {
    aps: {
      alert: { title: PLACEHOLDER_TITLE, body: PLACEHOLDER_BODY },
      'mutable-content': 1,
      sound: 'default',
      'thread-id': collapseId,
    },
    s: sealed,
  };
}

async function reasonOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) return null;
    const reason = (body as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason : null;
  } catch {
    return null;
  }
}

export async function sendApns(
  req: PushRequest,
  opts: { config: ApnsConfig; fetch: typeof fetch; now: () => number; tokens?: ApnsTokenCache },
): Promise<SendResult> {
  let jwt: string;
  try {
    jwt = await (opts.tokens ?? sharedApnsTokens).get(opts.config, opts.now());
  } catch {
    return { kind: 'failed', detail: 'bad_key' };
  }
  const host = req.registration.apsEnvironment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  let res: Response;
  try {
    res = await fetchWithTimeout(opts.fetch, `https://${host}/3/device/${encodeURIComponent(req.registration.token)}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-push-type': 'alert',
        'apns-topic': APNS_TOPIC,
        'apns-priority': req.urgency === 'high' ? '10' : '5',
        'apns-collapse-id': req.collapseId,
        'content-type': 'application/json',
      },
      body: JSON.stringify(apnsBody(req.sealed, req.collapseId)),
    });
  } catch {
    return { kind: 'retryable', detail: 'apns_network' };
  }
  if (res.status === 200) return { kind: 'delivered' };
  if (res.status === 410) return { kind: 'gone' };
  if (res.status === 400) {
    const reason = await reasonOf(res);
    if (reason !== null && APNS_DEAD_REASONS.includes(reason)) return { kind: 'gone' };
  }
  if (res.status >= 500) return { kind: 'retryable', detail: `apns_${res.status}` };
  return { kind: 'failed', detail: `apns_${res.status}` };
}
