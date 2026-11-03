/**
 * Phone push configuration and the types the push modules share (PRD PAN-4830 WI-2, D-4, D-13, D-14).
 *
 * A provider is null when any of its secrets is missing or blank, or when the FCM service account
 * is not JSON with string `client_email` and `private_key`. A null provider is not a 503: that
 * platform's pushes answer `delivery_failed` and /healthz reports it false. Never log a value here.
 */
import type { ApsEnvironment, ClientPlatform, PushUrgency } from '../../../../packages/contracts/src/connect.ts';
import type { Env } from '../env.ts';
import { present } from '../env.ts';

/** A phone's push token and, for iOS, which APNs host it belongs to (null on Android). */
export interface PushRegistration {
  readonly platform: ClientPlatform;
  readonly token: string;
  readonly apsEnvironment: ApsEnvironment | null;
}

/** One push to one phone: what apns.ts and fcm.ts send. */
export interface PushRequest {
  readonly registration: PushRegistration;
  readonly sealed: string;
  readonly urgency: PushUrgency;
  readonly collapseId: string;
}

export interface ApnsConfig {
  /** PEM text of the `.p8` auth key. */
  readonly keyP8: string;
  readonly keyId: string;
  readonly teamId: string;
}

export interface FcmConfig {
  readonly projectId: string;
  readonly clientEmail: string;
  /** PEM text of the service account's PKCS#8 RSA key. */
  readonly privateKey: string;
}

export interface PushConfig {
  readonly apns: ApnsConfig | null;
  readonly fcm: FcmConfig | null;
}

/** What one delivery came to, after the retry policy (deliver.ts). */
export type PushOutcome = { kind: 'delivered' } | { kind: 'gone' } | { kind: 'failed'; detail: string } | { kind: 'not_configured' };

/** One provider request's result before the retry policy (apns.ts, fcm.ts). */
export type SendResult = { kind: 'delivered' } | { kind: 'gone' } | { kind: 'retryable'; detail: string } | { kind: 'failed'; detail: string };

function parseApns(env: Env): ApnsConfig | null {
  if (!present(env.APNS_KEY_P8) || !present(env.APNS_KEY_ID) || !present(env.APNS_TEAM_ID)) return null;
  // Secrets pasted on one line carry the PEM newlines as literal `\n`.
  return { keyP8: env.APNS_KEY_P8.trim().replace(/\\n/g, '\n'), keyId: env.APNS_KEY_ID.trim(), teamId: env.APNS_TEAM_ID.trim() };
}

function parseFcm(env: Env): FcmConfig | null {
  if (!present(env.FCM_SERVICE_ACCOUNT_JSON) || !present(env.FCM_PROJECT_ID)) return null;
  let account: unknown;
  try {
    account = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  } catch {
    return null;
  }
  if (typeof account !== 'object' || account === null) return null;
  const { client_email: clientEmail, private_key: privateKey } = account as Record<string, unknown>;
  if (typeof clientEmail !== 'string' || !present(clientEmail)) return null;
  if (typeof privateKey !== 'string' || !present(privateKey)) return null;
  return { projectId: env.FCM_PROJECT_ID.trim(), clientEmail: clientEmail.trim(), privateKey: privateKey.trim() };
}

export function parsePushConfig(env: Env): PushConfig {
  return { apns: parseApns(env), fcm: parseFcm(env) };
}
