/**
 * Env, Deps and configuration for the account service (PRD PAN-4293 §7.4, D-23).
 *
 * Every secret is a Worker secret set by the operator (docs/ACCOUNT-SERVICE.md "Deploy"); only PUBLIC_BASE_URL is a committed var.
 * No value has a hardcoded default: missing required values make every route except /healthz return 503.
 */

/** A hosted Worker that stores user data and must delete it on account deletion (D-16). */
export interface AccountDataHolder {
  deleteAccountData(userId: string): Promise<{ deleted: true }>;
}

export interface Env {
  DB: D1Database;
  PUBLIC_BASE_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  OWNER_GITHUB_ID?: string;
  /**
   * Optional data-holder service binding; PAN-4297 binds the vault's RPC entrypoint here.
   * Typed structurally: `Service<T>` requires the entrypoint class, which lives in the vault Worker.
   */
  VAULT?: AccountDataHolder;
}

/** Time and outbound HTTP are injected so tests control both without waiting (D-24). */
export interface Deps {
  now(): number;
  fetch: typeof fetch;
}

export const productionDeps: Deps = {
  now: () => Date.now(),
  fetch: (input, init) => globalThis.fetch(input, init),
};

export interface Config {
  /** No trailing slash. */
  publicBaseUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  /** null when unset or non-numeric: the admin screen is disabled and the owner bypass is off. */
  ownerGithubId: number | null;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; missing: string[] };

const REQUIRED = ['PUBLIC_BASE_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] as const;

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function parseConfig(env: Env): ConfigResult {
  const missing = REQUIRED.filter((name) => !present(env[name]));
  if (missing.length > 0) return { ok: false, missing: [...missing] };
  const owner = env.OWNER_GITHUB_ID?.trim() ?? '';
  const ownerGithubId = /^[0-9]+$/.test(owner) ? Number(owner) : null;
  return {
    ok: true,
    config: {
      publicBaseUrl: (env.PUBLIC_BASE_URL as string).trim().replace(/\/+$/, ''),
      githubClientId: (env.GITHUB_CLIENT_ID as string).trim(),
      githubClientSecret: env.GITHUB_CLIENT_SECRET as string,
      ownerGithubId,
    },
  };
}

/** Per-request context handed to every handler (§7.1). */
export interface RequestContext {
  env: Env;
  config: Config;
  ctx: ExecutionContext;
  deps: Deps;
  params: Record<string, string>;
  /** `CF-Connecting-IP` or 'unknown'; hashed before it is ever stored (D-12). */
  clientIp: string;
}

export type Handler = (req: Request, rc: RequestContext) => Promise<Response>;

/**
 * Context for a service-binding (RPC) call, which has no HTTP request. Throws when the Worker is not
 * configured so the caller sees the misconfiguration instead of a silent `invalid_token`.
 */
export function rpcContext(env: Env, ctx: ExecutionContext, deps: Deps): RequestContext {
  const parsed = parseConfig(env);
  if (!parsed.ok) throw new Error(`account service not configured: missing ${parsed.missing.join(', ')}`);
  return { env, config: parsed.config, ctx, deps, params: {}, clientIp: 'rpc' };
}
