/**
 * GET /auth/github/callback (PRD PAN-4293 §7.5 step 2, D-8, D-21).
 *
 * Validates the browser-bound state, consumes the continuation row (single use), exchanges the code,
 * reads the identity and dispatches to the purpose's handler. The GitHub access token never leaves this request.
 */
import * as adminSession from './admin/session.ts';
import { sha256Hex } from './crypto.ts';
import * as deviceFlow from './device-flow.ts';
import type { Handler, RequestContext } from './env.ts';
import { exchangeCode, fetchUser, type GitHubIdentity } from './github.ts';
import { clearCookie, parseCookies } from './http.ts';
import { errorPage } from './pages.ts';
import * as pkce from './pkce.ts';
import { STATE_COOKIE, type AuthRequestRow, type Payload, type Purpose } from './sign-in.ts';

export interface PurposeHandler {
  onIdentity(rc: RequestContext, payload: Payload, identity: GitHubIdentity): Promise<Response>;
  onDenied(rc: RequestContext, payload: Payload): Promise<Response>;
}

export type PurposeHandlers = Record<Purpose, PurposeHandler>;

export const defaultHandlers: PurposeHandlers = {
  pkce: { onIdentity: pkce.onGitHubIdentity, onDenied: pkce.onGitHubDenied },
  device: { onIdentity: deviceFlow.onGitHubIdentity, onDenied: deviceFlow.onGitHubDenied },
  admin: { onIdentity: adminSession.onGitHubIdentity, onDenied: adminSession.onGitHubDenied },
};

export const EXPIRED_LINK_MESSAGE = 'This sign-in link expired or was already used. Start again.';
export const GITHUB_FAILED_MESSAGE = 'GitHub sign-in failed; try again.';

function withClearedState(res: Response): Response {
  res.headers.append('Set-Cookie', clearCookie(STATE_COOKIE));
  return res;
}

function parsePayload(raw: string): Payload {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Payload) : {};
  } catch {
    return {};
  }
}

export async function handleCallback(req: Request, rc: RequestContext, handlers: PurposeHandlers): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const cookieState = parseCookies(req)[STATE_COOKIE];
  if (!state || !cookieState || cookieState !== state) {
    return withClearedState(errorPage(400, EXPIRED_LINK_MESSAGE, 'Sign-in link expired'));
  }

  const row = await rc.env.DB.prepare('DELETE FROM auth_requests WHERE state_hash = ? RETURNING *')
    .bind(await sha256Hex(state))
    .first<AuthRequestRow>();
  if (!row || row.expires_at <= rc.deps.now()) {
    return withClearedState(errorPage(400, EXPIRED_LINK_MESSAGE, 'Sign-in link expired'));
  }
  const handler = handlers[row.purpose];
  const payload = parsePayload(row.payload);

  if (url.searchParams.get('error') !== null) {
    return withClearedState(await handler.onDenied(rc, payload));
  }

  const code = url.searchParams.get('code');
  const token = code ? await exchangeCode(rc, code) : null;
  const identity = token ? await fetchUser(rc, token) : null;
  if (!identity) return withClearedState(errorPage(502, GITHUB_FAILED_MESSAGE, 'GitHub sign-in failed'));

  return withClearedState(await handler.onIdentity(rc, payload, identity));
}

/** GET /auth/github/callback */
export const handle: Handler = (req, rc) => handleCallback(req, rc, defaultHandlers);
