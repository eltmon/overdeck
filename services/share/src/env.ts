/**
 * Env, Deps and configuration for the share service (PRD PAN-658 "Env and configuration").
 *
 * PUBLIC_BASE_URL is the only required value: without it every route except /healthz returns 503.
 * Missing TURN secrets are not a 503: rooms still work with STUN, and /healthz reports `turn: false`.
 */

/**
 * Placeholder for the account service's `AccountRpc` service binding (PAN-4293).
 * Typed structurally because `Service<T>` needs the entrypoint class, which lives in the account Worker.
 * The full result type and `verifyIdentity()` arrive with the room-creation work item (src/account.ts).
 */
export interface AccountBinding {
  verifyDevice(token: string): Promise<unknown>;
}

export interface Env {
  ROOMS: DurableObjectNamespace;
  ACCOUNT: AccountBinding;
  /** Absent ⇒ no limit (Miniflare and unit tests); the production wrangler config always binds it. */
  ROOM_CREATE_LIMIT?: RateLimit;
  PUBLIC_BASE_URL?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
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
  /** null when either TURN secret is unset: ICE falls back to STUN only. */
  turn: TurnConfig | null;
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

export function parseConfig(env: Env): ConfigResult {
  if (!present(env.PUBLIC_BASE_URL)) return { ok: false, missing: ['PUBLIC_BASE_URL'] };
  return {
    ok: true,
    config: {
      publicBaseUrl: env.PUBLIC_BASE_URL.trim().replace(/\/+$/, ''),
      turn: parseTurnConfig(env),
    },
  };
}

/**
 * Internal Worker→Durable Object paths. A Durable Object stub is reachable only from this Worker,
 * so the DO trusts the headers below and never reads the public `Authorization` header.
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
