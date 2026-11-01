/**
 * PAN-2354: the Web Push provider. Each payload is encrypted to the
 * subscription's key with RFC 8291 `aes128gcm` and signed with the machine's
 * VAPID key by the `web-push` library; we send the request ourselves with
 * `fetch` so the timeout and retry stay in our hands (D-2, D-10, D-11).
 *
 * Before each send, a subscription whose paired device is gone or revoked is
 * deleted (D-15). Logs carry only the endpoint host and the subscription id.
 */
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { listAccessTokens } from '../access-tokens.js';
import { loadConfigSync } from '../config-yaml.js';
import type { NormalizedPushConfig } from '../config-yaml/push-config.js';
import {
  listPushSubscriptions,
  recordPushDelivery,
  removePushSubscription,
  validatePushEndpoint,
  type PushSubscriptionRecord,
} from './subscription-store.js';
import type { NeedsYouKind, NeedsYouNotification, ProviderSendOutcome, PushProvider } from './types.js';
import { ensureVapidKeys } from './vapid-keys.js';

export const PUSH_REQUEST_TIMEOUT_MS = 5_000;
export const PUSH_RETRY_DELAY_MS = 5_000;
const WEBPUSH_TTL_SECONDS = 3600;

export interface WebPushProviderDeps {
  fetchImpl?: typeof fetch;
  listCredentials?: () => Promise<ReadonlyArray<{ id: string; revokedAt?: string }>>;
  readConfig?: () => NormalizedPushConfig;
  /** Test-only extra push-service hosts; never reachable from config or HTTP. */
  extraHosts?: readonly string[];
}

/** Outcome of one HTTP attempt: a status, or a network error / timeout. */
type Attempt = { status: number } | { error: string };

export function webPushUrgency(kind: NeedsYouKind): 'high' | 'normal' {
  return kind === 'question' || kind === 'approval' || kind === 'failed' ? 'high' : 'normal';
}

/** First 32 characters of base64url(sha256(tag)): a newer push replaces an undelivered older one. */
export function webPushTopic(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

export function webPushPayload(n: NeedsYouNotification): string {
  return JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag });
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return 'invalid-endpoint';
  }
}

function isTransient(attempt: Attempt): boolean {
  return 'error' in attempt || attempt.status === 429 || attempt.status >= 500;
}

export async function postWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: BodyInit | null },
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { status: response.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** One attempt, and exactly one retry after 5 s for a network error, 429 or 5xx. */
export async function postWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: BodyInit | null },
): Promise<Attempt> {
  const first = await postWithTimeout(fetchImpl, url, init);
  if (!isTransient(first)) return first;
  await new Promise<void>(resolve => setTimeout(resolve, PUSH_RETRY_DELAY_MS));
  return postWithTimeout(fetchImpl, url, init);
}

export function createWebPushProvider(deps: WebPushProviderDeps = {}): PushProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const listCredentials = deps.listCredentials ?? listAccessTokens;
  const readConfig = deps.readConfig ?? (() => loadConfigSync().config.push);
  const extraHosts = deps.extraHosts ?? [];

  async function sendOne(
    record: PushSubscriptionRecord,
    n: NeedsYouNotification,
    credentials: ReadonlyArray<{ id: string; revokedAt?: string }> | null,
    vapid: { subject: string; publicKey: string; privateKey: string },
  ): Promise<ProviderSendOutcome> {
    const target = `webpush:${record.id}`;
    const host = endpointHost(record.endpoint);

    if (!validatePushEndpoint(record.endpoint, extraHosts).ok) {
      return { target, ok: false, reason: 'skipped', detail: 'endpoint-not-allowed' };
    }
    if (record.credentialId !== null) {
      const credential = credentials?.find(c => c.id === record.credentialId);
      if (!credential || credential.revokedAt) {
        await removePushSubscription(record.id);
        console.warn(`[push] removed subscription ${record.id} (${host}): its device was revoked`);
        return { target, ok: false, reason: 'revoked' };
      }
    }

    let details: ReturnType<typeof webpush.generateRequestDetails>;
    try {
      details = webpush.generateRequestDetails(
        { endpoint: record.endpoint, keys: record.keys },
        webPushPayload(n),
        {
          vapidDetails: vapid,
          TTL: WEBPUSH_TTL_SECONDS,
          urgency: webPushUrgency(n.kind),
          topic: webPushTopic(n.tag),
          contentEncoding: 'aes128gcm',
        },
      );
    } catch (error) {
      await recordPushDelivery(record.id, 'failure');
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[push] could not build a request for subscription ${record.id} (${host}): ${detail}`);
      return { target, ok: false, reason: 'rejected', detail };
    }

    // fetch computes Content-Length itself; web-push sets it as a number.
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(details.headers)) {
      if (name.toLowerCase() !== 'content-length') headers[name] = String(value);
    }
    const attempt = await postWithRetry(fetchImpl, details.endpoint, {
      method: 'POST',
      headers,
      body: details.body ? new Uint8Array(details.body) : null,
    });

    if ('error' in attempt) {
      await recordPushDelivery(record.id, 'failure');
      console.warn(`[push] subscription ${record.id} (${host}) failed twice: ${attempt.error}`);
      return { target, ok: false, reason: 'transient', detail: attempt.error };
    }
    const { status } = attempt;
    if (status >= 200 && status < 300) {
      await recordPushDelivery(record.id, 'success');
      return { target, ok: true };
    }
    if (status === 404 || status === 410) {
      await removePushSubscription(record.id);
      console.warn(`[push] removed subscription ${record.id} (${host}): the push service answered ${status}`);
      return { target, ok: false, reason: 'gone', status };
    }
    await recordPushDelivery(record.id, 'failure');
    console.warn(`[push] subscription ${record.id} (${host}) answered ${status}`);
    return { target, ok: false, reason: isTransient(attempt) ? 'transient' : 'rejected', status };
  }

  return {
    name: 'webpush',

    async hasTargets() {
      return (await listPushSubscriptions()).length > 0;
    },

    async send(n) {
      const records = await listPushSubscriptions();
      if (records.length === 0) return [];
      const cfg = readConfig();
      const keys = await ensureVapidKeys();
      const vapid = { subject: cfg.webpush.subject, publicKey: keys.publicKey, privateKey: keys.privateKey };
      const credentials = records.some(r => r.credentialId !== null) ? await listCredentials() : null;
      const settled = await Promise.allSettled(records.map(record => sendOne(record, n, credentials, vapid)));
      return settled.map((result, index): ProviderSendOutcome => (result.status === 'fulfilled'
        ? result.value
        : {
          target: `webpush:${records[index]?.id ?? 'unknown'}`,
          ok: false,
          reason: 'transient',
          detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }));
    },
  };
}
