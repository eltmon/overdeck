/**
 * Env, Deps and configuration for the connect service (PRD PAN-2356 WI-3).
 *
 * PUBLIC_BASE_URL is the only required value: without it every route except /healthz returns 503.
 * Missing TURN secrets are not a 503: the directory and direct connections still work, the relay
 * answers `turn_unavailable`, and /healthz reports `turn: false`. Missing push secrets are not a
 * 503 either: that platform's pushes answer `delivery_failed` (push/config.ts, PAN-4830).
 */
import type { ConnectPlan } from '../../../packages/contracts/src/connect.ts';
import type { AccountBinding } from './account.ts';

export interface Env {
  DIRECTORY: DurableObjectNamespace;
  ACCOUNT: AccountBinding;
  /** Absent ⇒ no limit (Miniflare and unit tests); the production wrangler config always binds both. */
  INBOX_LIMIT?: RateLimit;
  CONNECT_LIMIT?: RateLimit;
  PUBLIC_BASE_URL?: string;
  /** Comma-separated STUN URLs handed to machines for direct connections. */
  STUN_URLS?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  /** Positive integer overriding the 50 GB monthly relay cap, for staging tests only. */
  RELAY_CAP_BYTES?: string;
  /** Worker secrets for iOS push (PAN-4830): the `.p8` auth key PEM, its key id and the team id. */
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  /** Worker secrets for Android push (PAN-4830): the service-account JSON and the Firebase project id. */
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
}

/** Time, outbound HTTP and randomness are injected so tests control all three without waiting. */
export interface Deps {
  now(): number;
  fetch: typeof fetch;
  randomBytes(n: number): Uint8Array;
}

export const productionDeps: Deps = {
  now: () => Date.now(),
  fetch: (input, init) => globalThis.fetch(input, init),
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
};

export interface TurnConfig {
  keyId: string;
  apiToken: string;
}

export interface Config {
  /** No trailing slash. */
  publicBaseUrl: string;
  stunUrls: string[];
  /** null when either TURN secret is unset: no relay. */
  turn: TurnConfig | null;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; missing: string[] };

export function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** TURN credentials, independent of PUBLIC_BASE_URL so /healthz can report them on their own. */
export function parseTurnConfig(env: Env): TurnConfig | null {
  if (!present(env.TURN_KEY_ID) || !present(env.TURN_KEY_API_TOKEN)) return null;
  return { keyId: env.TURN_KEY_ID.trim(), apiToken: env.TURN_KEY_API_TOKEN.trim() };
}

export function parseConfig(env: Env): ConfigResult {
  if (!present(env.PUBLIC_BASE_URL)) return { ok: false, missing: ['PUBLIC_BASE_URL'] };
  return {
    ok: true,
    config: {
      publicBaseUrl: env.PUBLIC_BASE_URL.trim().replace(/\/+$/, ''),
      stunUrls: (env.STUN_URLS ?? '').split(',').map((u) => u.trim()).filter((u) => u !== ''),
      turn: parseTurnConfig(env),
    },
  };
}

/**
 * Internal Worker→Durable Object paths. A Durable Object stub is reachable only from this Worker,
 * so the Durable Object trusts the headers below and never reads the public `Authorization` header.
 *
 * - `GET /socket` (upgrade) with `HDR_IDENTITY`: a machine's directory socket.
 * - `POST /inbox` with `HDR_INBOX_SECRET_HASH` and `HDR_INBOX_HEADERS`, body = the raw event (≤ 256 KiB):
 *   a webhook event for one of the account's inboxes. The answer is the public answer.
 */
export const INTERNAL = {
  socket: '/socket',
  inbox: '/inbox',
} as const;

/** SHA-256 hex of the inbox secret from the URL; the secret itself never reaches the Durable Object. */
export const HDR_INBOX_SECRET_HASH = 'X-Connect-Inbox-Secret-Hash';
/** JSON object of the kept webhook headers (inbox.ts KEPT_HEADERS), lower-cased. */
export const HDR_INBOX_HEADERS = 'X-Connect-Inbox-Headers';

/** JSON `ConnectIdentity` of the verified device (D-2356-2). */
export const HDR_IDENTITY = 'X-Connect-Identity';

/** Who a verified device token belongs to, and what its plan allows. */
export interface ConnectIdentity {
  userId: string;
  githubId: number;
  deviceId: string;
  plan: ConnectPlan;
  /** null ⇒ no machine limit. */
  maxDevices: number | null;
}
