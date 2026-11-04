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
 *
 * A Live Activity update (PAN-4839, OD-1) is drawn by iOS with no app code in between, so it cannot be
 * sealed: its body carries the APNs timing fields and the two counts, nothing else.
 */
import { p256 } from '@noble/curves/nist.js';
import { ACTIVITY_STALE_MS } from '../../../../packages/contracts/src/connect.ts';
import type { ApsEnvironment } from '../../../../packages/contracts/src/connect.ts';
import type { ActivityPushRequest, ApnsConfig, PushRequest, SendResult } from './config.ts';
import { fetchWithTimeout } from './http.ts';
import { base64UrlBytes, base64UrlToBytes, pemToDer, signingInput } from './jwt.ts';

export const APNS_TOPIC = 'ai.overdeck.app';
export const APNS_LIVE_ACTIVITY_TOPIC = 'ai.overdeck.app.push-type.liveactivity';
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

/** The whole Live Activity body (FR-2): APNs timing fields and the two counts. */
export function apnsActivityBody(needsYou: number, running: number, nowMs: number) {
  const timestamp = Math.floor(nowMs / 1000);
  return { aps: { timestamp, event: 'update', 'content-state': { needsYou, running }, 'stale-date': timestamp + ACTIVITY_STALE_MS / 1000 } };
}

type ApnsOptions = { config: ApnsConfig; fetch: typeof fetch; now: () => number; tokens?: ApnsTokenCache };

/** One POST to APNs and its classification; `headers` are everything but `authorization`. */
async function postApns(
  apsEnvironment: ApsEnvironment | null,
  deviceToken: string,
  headers: Record<string, string>,
  body: string,
  opts: ApnsOptions,
): Promise<SendResult> {
  let jwt: string;
  try {
    jwt = await (opts.tokens ?? sharedApnsTokens).get(opts.config, opts.now());
  } catch {
    return { kind: 'failed', detail: 'bad_key' };
  }
  const host = apsEnvironment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  let res: Response;
  try {
    res = await fetchWithTimeout(opts.fetch, `https://${host}/3/device/${encodeURIComponent(deviceToken)}`, {
      method: 'POST',
      headers: { authorization: `bearer ${jwt}`, ...headers },
      body,
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

export async function sendApns(req: PushRequest, opts: ApnsOptions): Promise<SendResult> {
  return postApns(
    req.registration.apsEnvironment,
    req.registration.token,
    {
      'apns-push-type': 'alert',
      'apns-topic': APNS_TOPIC,
      'apns-priority': req.urgency === 'high' ? '10' : '5',
      'apns-collapse-id': req.collapseId,
      'content-type': 'application/json',
    },
    JSON.stringify(apnsBody(req.sealed, req.collapseId)),
    opts,
  );
}

/** A Live Activity update (PAN-4839): `liveactivity` push type, no collapse id, expiring at the stale date. */
export async function sendApnsActivity(req: ActivityPushRequest, opts: ApnsOptions): Promise<SendResult> {
  const body = apnsActivityBody(req.needsYou, req.running, opts.now());
  return postApns(
    req.apsEnvironment,
    req.token,
    {
      'apns-push-type': 'liveactivity',
      'apns-topic': APNS_LIVE_ACTIVITY_TOPIC,
      'apns-priority': req.priority === 'high' ? '10' : '5',
      'apns-expiration': String(body.aps['stale-date']),
      'content-type': 'application/json',
    },
    JSON.stringify(body),
    opts,
  );
}
