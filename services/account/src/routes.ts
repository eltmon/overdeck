/**
 * Route table and request pipeline (PRD §7.2).
 *
 * Order per request: OPTIONS → 405; match path → 404; match method → 405 with Allow;
 * config gate → 503 for everything but /healthz (D-23); /admin* → 503 without OWNER_GITHUB_ID;
 * rate-limit bucket → 429 (D-12); 16 KiB body guard → 413 (D-28); handler.
 *
 * Later work items replace handler bodies in their own modules and never edit this file.
 */
import type { Deps, Env, Handler, RequestContext } from './env.ts';
import { parseConfig } from './env.ts';
import { guardBody, json } from './http.ts';
import { rateLimitedPage } from './pages.ts';
import { hit, type Bucket } from './rate-limit.ts';
import * as pkce from './pkce.ts';
import * as githubCallback from './github-callback.ts';
import * as tokenEndpoint from './token-endpoint.ts';
import * as deviceFlow from './device-flow.ts';
import * as api from './api.ts';
import * as deletion from './deletion.ts';
import * as adminScreen from './admin/screen.ts';
import * as adminSession from './admin/session.ts';
import * as adminPending from './admin/pending.ts';

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  bucket?: Bucket;
}

/** GET /healthz: liveness plus whether the required configuration is present; reveals no value (FR-14). */
function healthz(env: Env): Response {
  return json({ ok: true, configured: parseConfig(env).ok });
}

const ROUTES: Route[] = [
  { method: 'GET', pattern: '/healthz', handler: async (_req, rc) => healthz(rc.env) },
  { method: 'GET', pattern: '/auth/start', handler: pkce.start, bucket: 'auth-start' },
  { method: 'GET', pattern: '/auth/github/callback', handler: githubCallback.handle, bucket: 'github-callback' },
  { method: 'POST', pattern: '/oauth/token', handler: tokenEndpoint.handle, bucket: 'token' },
  { method: 'POST', pattern: '/oauth/device/code', handler: deviceFlow.issueCode, bucket: 'device-code' },
  { method: 'GET', pattern: '/activate', handler: deviceFlow.activatePage },
  { method: 'POST', pattern: '/activate', handler: deviceFlow.activateSubmit, bucket: 'activate' },
  { method: 'POST', pattern: '/activate/confirm', handler: deviceFlow.activateConfirm, bucket: 'activate' },
  { method: 'GET', pattern: '/v1/me', handler: api.me },
  { method: 'GET', pattern: '/v1/devices', handler: api.listDevices },
  { method: 'PATCH', pattern: '/v1/devices/:id', handler: api.renameDevice },
  { method: 'DELETE', pattern: '/v1/devices/:id', handler: api.revokeDevice },
  { method: 'DELETE', pattern: '/v1/account', handler: deletion.requestDeletionHandler },
  { method: 'GET', pattern: '/admin', handler: adminScreen.page },
  { method: 'POST', pattern: '/admin/login', handler: adminSession.login, bucket: 'admin-login' },
  { method: 'POST', pattern: '/admin/logout', handler: adminSession.logout },
  { method: 'POST', pattern: '/admin/grants', handler: adminScreen.addGrant },
  { method: 'POST', pattern: '/admin/grants/:githubId/revoke', handler: adminScreen.revokeGrant },
  { method: 'POST', pattern: '/admin/pending/:githubId/allow', handler: adminPending.allow },
];

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i] as string;
    const g = got[i] as string;
    if (w.startsWith(':')) {
      if (g === '') return null;
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return null; // malformed percent-encoding is simply not a known path
      }
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

function notConfigured(missing: string[]): Response {
  return json({ error: 'not_configured', missing }, 503);
}

function methodNotAllowed(allow: string[]): Response {
  return json({ error: 'method_not_allowed' }, 405, allow.length > 0 ? { Allow: allow.join(', ') } : undefined);
}

export async function handle(req: Request, env: Env, ctx: ExecutionContext, deps: Deps): Promise<Response> {
  const pathname = new URL(req.url).pathname;

  const candidates: Array<{ route: Route; params: Record<string, string> }> = [];
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, pathname);
    if (params) candidates.push({ route, params });
  }
  const allow = candidates.map((c) => c.route.method);

  if (req.method === 'OPTIONS') return methodNotAllowed(allow);
  if (candidates.length === 0) return json({ error: 'not_found' }, 404);
  const matched = candidates.find((c) => c.route.method === req.method);
  if (!matched) return methodNotAllowed(allow);

  if (matched.route.pattern === '/healthz') return healthz(env);

  const parsed = parseConfig(env);
  if (!parsed.ok) return notConfigured(parsed.missing);
  if (pathname.startsWith('/admin') && parsed.config.ownerGithubId === null) return notConfigured(['OWNER_GITHUB_ID']);

  const rc: RequestContext = {
    env,
    config: parsed.config,
    ctx,
    deps,
    params: matched.params,
    clientIp: clientIpOf(req),
  };

  const bucket = matched.route.bucket;
  if (bucket) {
    const verdict = await hit(rc, bucket);
    if (!verdict.ok) {
      const retryAfter = String(Math.max(1, Math.ceil(verdict.retryAfterS)));
      return pathname.startsWith('/oauth/')
        ? json({ error: 'rate_limited' }, 429, { 'Retry-After': retryAfter })
        : rateLimitedPage(verdict.retryAfterS);
    }
  }

  const guarded = await guardBody(req);
  if (!guarded.ok) return guarded.response;

  try {
    return await matched.route.handler(guarded.req, rc);
  } catch (error) {
    console.error('account-service: unhandled error', pathname, error instanceof Error ? error.message : error);
    return json({ error: 'internal_error' }, 500);
  }
}

function clientIpOf(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}
