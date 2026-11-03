/**
 * Provider choice, the single retry and the outcome of one push (PRD PAN-4830 WI-6, FR-9, FR-10,
 * D-12, D-13).
 *
 * iOS goes to APNs, Android to FCM. A 5xx answer, network error or timeout of the send is retried
 * once after 2 s; nothing else is. Worst case is OAuth 2 s + send 2 s + wait 2 s + send 2 s = 8 s,
 * inside the machine's 10 s wait for `push-result`.
 */
import { sendApns } from './apns.ts';
import type { ApnsTokenCache } from './apns.ts';
import type { PushConfig, PushOutcome, PushRequest, SendResult } from './config.ts';
import { sendFcm } from './fcm.ts';
import type { FcmTokenCache } from './fcm.ts';

export const PUSH_RETRY_DELAY_MS = 2_000;

export interface DeliverOptions {
  config: PushConfig;
  fetch: typeof fetch;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  apnsTokens?: ApnsTokenCache;
  fcmTokens?: FcmTokenCache;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function deliverPush(req: PushRequest, opts: DeliverOptions): Promise<PushOutcome> {
  let send: () => Promise<SendResult>;
  if (req.registration.platform === 'ios') {
    const apns = opts.config.apns;
    if (apns === null) return { kind: 'not_configured' };
    send = () => sendApns(req, { config: apns, fetch: opts.fetch, now: opts.now, tokens: opts.apnsTokens });
  } else {
    const fcm = opts.config.fcm;
    if (fcm === null) return { kind: 'not_configured' };
    send = () => sendFcm(req, { config: fcm, fetch: opts.fetch, now: opts.now, tokens: opts.fcmTokens });
  }
  let result = await send();
  if (result.kind === 'retryable') {
    await (opts.sleep ?? defaultSleep)(PUSH_RETRY_DELAY_MS);
    result = await send();
  }
  return result.kind === 'retryable' ? { kind: 'failed', detail: result.detail } : result;
}
