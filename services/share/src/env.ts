/**
 * Env, Deps and configuration for the share service (PRD PAN-658 "Env and configuration").
 *
 * PUBLIC_BASE_URL is the only required value: without it every route except /healthz returns 503.
 * Missing TURN secrets are not a 503: rooms still work with STUN, and /healthz reports `turn: false`.
 * Web join (PAN-4481) is optional too: without ACCOUNT_BASE_URL or a valid WEB_SESSION_KEY the web
 * routes answer 503 `not_configured` and /healthz reports `web: false`.
 */
import type { ShareIdentity, ShareScope } from '../../../packages/contracts/src/sharing.ts';
import type { AccountBinding } from './account.ts';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ACCOUNT: AccountBinding;
  /** Absent ⇒ no limit (Miniflare and unit tests); the production wrangler config always binds it. */
  ROOM_CREATE_LIMIT?: RateLimit;
  PUBLIC_BASE_URL?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  /** The account Worker's public origin; the browser is sent to its `/auth/start` (PAN-4481). */
  ACCOUNT_BASE_URL?: string;
  /** Worker secret: 64 hex characters (32 bytes), the AES-GCM key that seals the web cookies. */
  WEB_SESSION_KEY?: string;
  /** Static assets (the hosted viewer bundle); absent in unit tests. */
  ASSETS?: Fetcher;
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

export interface WebConfig {
  /** No trailing slash. */
  accountBaseUrl: string;
  /** 64 lowercase hex characters. */
  sessionKeyHex: string;
}

export interface Config {
  /** No trailing slash. */
  publicBaseUrl: string;
  /** null when either TURN secret is unset: ICE falls back to STUN only. */
  turn: TurnConfig | null;
  /** null unless browser sign-in and web join are configured (PAN-4481 NFR-6). */
  web: WebConfig | null;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; missing: string[] };

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** TURN credentials, independent of PUBLIC_BASE_URL so /healthz can report them on their own. */
export function parseTurnConfig(env: Env): TurnConfig | null {
  if (!present(env.TURN_KEY_ID) || !present(env.TURN_KEY_API_TOKEN)) return null;
  return { keyId: env.TURN_KEY_ID.trim(), apiToken: env.TURN_KEY_API_TOKEN.trim() };
}

const SESSION_KEY_RE = /^[0-9a-fA-F]{64}$/;

/** Names of the missing or invalid web-join values, for the 503 body; empty when web join is configured. */
export function missingWebConfig(env: Env): string[] {
  const missing: string[] = [];
  if (!present(env.ACCOUNT_BASE_URL)) missing.push('ACCOUNT_BASE_URL');
  if (!present(env.WEB_SESSION_KEY) || !SESSION_KEY_RE.test(env.WEB_SESSION_KEY.trim())) missing.push('WEB_SESSION_KEY');
  return missing;
}

/** null unless ACCOUNT_BASE_URL is set and WEB_SESSION_KEY is exactly 64 hex characters. */
export function parseWebConfig(env: Env): WebConfig | null {
  if (missingWebConfig(env).length > 0) return null;
  return {
    accountBaseUrl: (env.ACCOUNT_BASE_URL as string).trim().replace(/\/+$/, ''),
    sessionKeyHex: (env.WEB_SESSION_KEY as string).trim().toLowerCase(),
  };
}

export function parseConfig(env: Env): ConfigResult {
  if (!present(env.PUBLIC_BASE_URL)) return { ok: false, missing: ['PUBLIC_BASE_URL'] };
  return {
    ok: true,
    config: {
      publicBaseUrl: env.PUBLIC_BASE_URL.trim().replace(/\/+$/, ''),
      turn: parseTurnConfig(env),
      web: parseWebConfig(env),
    },
  };
}

/**
 * Internal Worker→Durable Object paths. A Durable Object stub is reachable only from this Worker,
 * so the DO trusts the headers below and never reads the public `Authorization` header.
 *
 * - `POST /init`, JSON `RoomInitBody` → 201 with a `RoomSnapshot` body, or 409 when the code exists.
 * - `POST /delete` with `HDR_HOST_TOKEN_HASH` → 204, or 404 for no room, an ended room or a wrong hash.
 * - `GET /status` → 200 `RoomStatusBody`, or 404 when there is no record.
 * - `GET /host` (upgrade) with `HDR_HOST_TOKEN_HASH`; `GET /join` (upgrade) with `HDR_IDENTITY`.
 */
export const INTERNAL = {
  init: '/init',
  delete: '/delete',
  status: '/status',
  host: '/host',
  join: '/join',
} as const;

/** SHA-256 hex of the presented host token; the token itself never reaches the DO. */
export const HDR_HOST_TOKEN_HASH = 'X-Share-Host-Token-Hash';
/** JSON `ShareIdentity` of the verified viewer. */
export const HDR_IDENTITY = 'X-Share-Identity';

export interface RoomInitBody {
  shortCode: string;
  scope: ShareScope;
  dataOwner: ShareIdentity;
  hostTokenHash: string;
  createdAt: number;
}

export interface RoomStatusBody {
  status: 'active' | 'ended';
}
