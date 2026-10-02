/**
 * Admin sign-in and session (PRD §7.12, D-19, D-20). Scaffold stubs; implemented by account-admin-session.
 */
import type { Handler, RequestContext } from '../env.ts';
import type { GitHubIdentity } from '../github.ts';
import { notImplemented } from '../http.ts';
import type { Payload } from '../sign-in.ts';

/** POST /admin/login */
export const login: Handler = async () => notImplemented();
/** POST /admin/logout */
export const logout: Handler = async () => notImplemented();

/** GitHub leg continuation for purpose 'admin'; implemented by account-admin-session. */
export async function onGitHubIdentity(_rc: RequestContext, _payload: Payload, _identity: GitHubIdentity): Promise<Response> {
  return notImplemented();
}

export async function onGitHubDenied(_rc: RequestContext, _payload: Payload): Promise<Response> {
  return notImplemented();
}
