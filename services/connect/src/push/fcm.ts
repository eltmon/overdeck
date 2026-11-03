/**
 * FCM HTTP v1 delivery: the service-account access token and the data-only message (PRD PAN-4830
 * WI-5, FR-6, FR-7, FR-8, D-11, NFR-1).
 *
 * The message has a `data` map and no `notification` key, so Android hands it to the app's
 * FirebaseMessagingService even when the app is closed; the app opens the sealed blob. The access
 * token comes from an RS256 assertion signed with WebCrypto and is cached per service account until
 * 5 minutes before it expires. Never log the token, the assertion, the key or `sealed`.
 */
import type { PushUrgency } from '../../../../packages/contracts/src/connect.ts';
import type { FcmConfig, PushRequest, SendResult } from './config.ts';
import { fetchWithTimeout } from './http.ts';
import { base64UrlBytes, pemToDer, signingInput } from './jwt.ts';

/** Fixed; the service account's own `token_uri` is ignored (D-11). */
export const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const FCM_TOKEN_EARLY_REFRESH_MS = 300_000;
const ASSERTION_LIFETIME_SECONDS = 3_600;

export type FcmTokenResult = { ok: true; token: string } | { ok: false; detail: string };

async function signAssertion(config: FcmConfig, nowMs: number): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(config.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(nowMs / 1000);
  const input = signingInput(
    { alg: 'RS256', typ: 'JWT' },
    { iss: config.clientEmail, scope: FCM_SCOPE, aud: FCM_TOKEN_URL, iat, exp: iat + ASSERTION_LIFETIME_SECONDS },
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${base64UrlBytes(new Uint8Array(signature))}`;
}

/** Access tokens per service account. Tests pass a fresh instance; production shares one per isolate. */
export class FcmTokenCache {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  async get(config: FcmConfig, fetchFn: typeof fetch, nowMs: number): Promise<FcmTokenResult> {
    const cached = this.tokens.get(config.clientEmail);
    if (cached && nowMs < cached.expiresAt - FCM_TOKEN_EARLY_REFRESH_MS) return { ok: true, token: cached.token };
    let assertion: string;
    try {
      assertion = await signAssertion(config, nowMs);
    } catch {
      return { ok: false, detail: 'bad_key' };
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(fetchFn, FCM_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      });
    } catch {
      return { ok: false, detail: 'fcm_oauth_network' };
    }
    if (res.status !== 200) return { ok: false, detail: `fcm_oauth_${res.status}` };
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    const token = body?.access_token;
    const expiresIn = body?.expires_in;
    if (typeof token !== 'string' || token === '' || typeof expiresIn !== 'number' || !(expiresIn > 0)) {
      return { ok: false, detail: 'fcm_oauth_bad_response' };
    }
    this.tokens.set(config.clientEmail, { token, expiresAt: nowMs + expiresIn * 1000 });
    return { ok: true, token };
  }

  /** Forget a token FCM refused (401), so the next push fetches a new one. */
  drop(clientEmail: string): void {
    this.tokens.delete(clientEmail);
  }
}

export const sharedFcmTokens = new FcmTokenCache();

/** The whole FCM message (FR-6): data-only, so no `notification` key. */
export function fcmBody(token: string, sealed: string, urgency: PushUrgency, collapseId: string) {
  return {
    message: {
      token,
      data: { s: sealed },
      android: { priority: urgency === 'high' ? 'HIGH' : 'NORMAL', ttl: '3600s', collapse_key: collapseId },
    },
  };
}

/** FCM's "this token will never work again" marker, in `error.details[].errorCode`. */
async function isUnregistered(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { error?: { details?: unknown } } | null;
    const details = body?.error?.details;
    return Array.isArray(details) && details.some((d) => typeof d === 'object' && d !== null && (d as { errorCode?: unknown }).errorCode === 'UNREGISTERED');
  } catch {
    return false;
  }
}

export async function sendFcm(
  req: PushRequest,
  opts: { config: FcmConfig; fetch: typeof fetch; now: () => number; tokens?: FcmTokenCache },
): Promise<SendResult> {
  const tokens = opts.tokens ?? sharedFcmTokens;
  const access = await tokens.get(opts.config, opts.fetch, opts.now());
  if (!access.ok) return { kind: 'failed', detail: access.detail };
  let res: Response;
  try {
    res = await fetchWithTimeout(opts.fetch, `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(opts.config.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(fcmBody(req.registration.token, req.sealed, req.urgency, req.collapseId)),
    });
  } catch {
    return { kind: 'retryable', detail: 'fcm_network' };
  }
  if (res.status === 200) return { kind: 'delivered' };
  if (res.status === 404 || (await isUnregistered(res))) return { kind: 'gone' };
  if (res.status === 401) {
    tokens.drop(opts.config.clientEmail);
    return { kind: 'failed', detail: 'fcm_401' };
  }
  if (res.status >= 500) return { kind: 'retryable', detail: `fcm_${res.status}` };
  return { kind: 'failed', detail: `fcm_${res.status}` };
}
