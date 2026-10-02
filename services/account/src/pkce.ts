/**
 * PKCE loopback flow (PRD §7.6, D-7). Scaffold stubs; implemented by account-pkce-flow.
 */
import type { Handler, RequestContext } from './env.ts';
import { notImplemented } from './http.ts';

/** GET /auth/start */
export const start: Handler = async () => notImplemented();

/** POST /oauth/token with grant_type=authorization_code. */
export async function exchangeAuthorizationCode(_rc: RequestContext, _form: URLSearchParams): Promise<Response> {
  return notImplemented();
}
