/**
 * PKCE loopback flow (PRD §7.6, D-7). Scaffold stubs; implemented by account-pkce-flow.
 */
import type { Handler, RequestContext } from './env.ts';
import type { GitHubIdentity } from './github.ts';
import { notImplemented } from './http.ts';
import type { Payload } from './sign-in.ts';

/** GET /auth/start */
export const start: Handler = async () => notImplemented();

/** POST /oauth/token with grant_type=authorization_code. */
export async function exchangeAuthorizationCode(_rc: RequestContext, _form: URLSearchParams): Promise<Response> {
  return notImplemented();
}

/** GitHub leg continuation for purpose 'pkce'; implemented by account-pkce-flow. */
export async function onGitHubIdentity(_rc: RequestContext, _payload: Payload, _identity: GitHubIdentity): Promise<Response> {
  return notImplemented();
}

export async function onGitHubDenied(_rc: RequestContext, _payload: Payload): Promise<Response> {
  return notImplemented();
}
