/**
 * Viewer and host identity via the account service's `AccountRpc` binding (PAN-4293), typed
 * structurally so this Worker never imports the account Worker's code (PRD PAN-658 "Identity").
 *
 * `githubLogin` is optional here because the PAN-4293 contract predates it (D-R3-5): an account
 * service that does not return it yet is reported as `account_service_outdated`, never guessed.
 */
import type { ShareIdentity } from '../../../packages/contracts/src/sharing.ts';
import type { Env } from './env.ts';

export type AccountVerifyResult =
  | { ok: true; userId: string; githubId: number; githubLogin?: string; deviceId: string }
  | { ok: false; error: 'invalid_token' | 'device_revoked' | 'grant_expired' | 'account_deleted' };

export interface AccountBinding {
  verifyDevice(token: string): Promise<AccountVerifyResult>;
}

export type VerifyIdentityResult =
  | { ok: true; identity: ShareIdentity }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** A device token: `odd_` + 64 lowercase hex (PAN-4293 TOKEN_RE). */
const DEVICE_BEARER_RE = /^Bearer (odd_[0-9a-f]{64})$/;

export const GITHUB_AVATAR_BASE = 'https://avatars.githubusercontent.com/u/';

export async function verifyIdentity(env: Env, authorization: string | null): Promise<VerifyIdentityResult> {
  const match = DEVICE_BEARER_RE.exec(authorization ?? '');
  if (!match) return { ok: false, status: 401, error: 'invalid_token' };

  let result: AccountVerifyResult;
  try {
    result = await env.ACCOUNT.verifyDevice(match[1] as string);
  } catch {
    return { ok: false, status: 503, error: 'account_unavailable' };
  }

  if (!result.ok) {
    return { ok: false, status: result.error === 'grant_expired' ? 403 : 401, error: result.error };
  }
  if (typeof result.githubLogin !== 'string' || result.githubLogin === '') {
    return { ok: false, status: 503, error: 'account_service_outdated' };
  }
  return {
    ok: true,
    identity: { githubId: result.githubId, login: result.githubLogin, avatarUrl: GITHUB_AVATAR_BASE + result.githubId },
  };
}
