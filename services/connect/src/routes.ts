/**
 * Route table and request pipeline for the connect service (PRD PAN-2356 WI-3).
 *
 * Order per request: match path → 404; match method → 405 with Allow; config gate → 503 for
 * everything but /healthz; handler.
 */
import { directoryToken, verifyIdentity } from './account.ts';
import type { Config, Deps, Env } from './env.ts';
import { HDR_IDENTITY, INTERNAL, parseConfig, parseTurnConfig } from './env.ts';
import { isWebSocketUpgrade, json, matchPattern, withSecurityHeaders } from './http.ts';
import { inboxIntake } from './inbox-intake.ts';
import { parsePushConfig } from './push/config.ts';

/** Per-request context handed to every handler. */
export interface RequestContext {
  env: Env;
  config: Config;
  deps: Deps;
  params: Record<string, string>;
}

export type Handler = (req: Request, rc: RequestContext) => Promise<Response>;

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
}

/** GET /healthz: liveness, whether PUBLIC_BASE_URL is set, and whether TURN, APNs and FCM are available; reveals no value. */
function healthz(env: Env): Response {
  const push = parsePushConfig(env);
  return json({ ok: true, configured: parseConfig(env).ok, turn: parseTurnConfig(env) !== null, apns: push.apns !== null, fcm: push.fcm !== null });
}

/** The account's Durable Object stub, named by the account user id (D-2356-2). */
export function directoryStub(env: Env, userId: string): DurableObjectStub {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName(userId));
}

/**
 * GET /v1/directory: a machine's or phone's directory socket, authorised by its device token from
 * `Authorization` (machines) or the `overdeck.bearer.<token>` subprotocol (phones, PAN-4829). The
 * verified identity reaches the Durable Object in `X-Connect-Identity`; the token never does.
 * Anything but 101 is passed back as is.
 */
const directorySocket: Handler = async (req, rc) => {
  if (!isWebSocketUpgrade(req)) return json({ error: 'upgrade_required' }, 426, { Upgrade: 'websocket' });
  const { authorization, protocol } = directoryToken(req.headers);
  const verified = await verifyIdentity(rc.env, authorization);
  if (!verified.ok) return json({ error: verified.error }, verified.status);
  const identity = verified.identity;

  if (rc.env.CONNECT_LIMIT) {
    const { success } = await rc.env.CONNECT_LIMIT.limit({ key: identity.deviceId });
    if (!success) return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
  }

  const res = await directoryStub(rc.env, identity.userId).fetch('https://directory' + INTERNAL.socket, {
    headers: { Upgrade: 'websocket', [HDR_IDENTITY]: JSON.stringify(identity) },
  });
  // A browser drops a socket whose server did not choose its offered subprotocol (D-3).
  if (protocol === null || res.status !== 101 || !res.webSocket) return res;
  return new Response(null, { status: 101, webSocket: res.webSocket, headers: { 'Sec-WebSocket-Protocol': protocol } });
};

const ROUTES: Route[] = [
  { method: 'GET', pattern: '/healthz', handler: async (_req, rc) => healthz(rc.env) },
  { method: 'GET', pattern: '/v1/directory', handler: directorySocket },
  { method: 'POST', pattern: '/h/:id', handler: inboxIntake },
];

function methodNotAllowed(allow: string[]): Response {
  return json({ error: 'method_not_allowed' }, 405, { Allow: allow.join(', ') });
}

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const pathname = new URL(req.url).pathname;

  const candidates: Array<{ route: Route; params: Record<string, string> }> = [];
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, pathname);
    if (params) candidates.push({ route, params });
  }
  if (candidates.length === 0) return json({ error: 'not_found' }, 404);
  const matched = candidates.find((c) => c.route.method === req.method);
  if (!matched) return methodNotAllowed(candidates.map((c) => c.route.method));

  if (matched.route.pattern === '/healthz') return healthz(env);

  const parsed = parseConfig(env);
  if (!parsed.ok) return json({ error: 'not_configured', missing: parsed.missing }, 503);

  const rc: RequestContext = { env, config: parsed.config, deps, params: matched.params };
  try {
    return withSecurityHeaders(await matched.route.handler(req, rc));
  } catch (error) {
    console.error('connect-service: unhandled error', pathname, error instanceof Error ? error.message : error);
    return json({ error: 'internal_error' }, 500);
  }
}
