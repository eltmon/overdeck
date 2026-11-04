/**
 * Types consumed by other hosted services (PRD PAN-4293 §7.8, §7.13, D-16).
 * The hosted vault (PAN-4297) imports VerifyResult, AccountDataHolder and quotaDecision from here;
 * the share Worker (PAN-4481) mirrors RedeemWebCodeInput, RedeemResult and SignOutResult structurally.
 */
import type { Entitlement } from './entitlement.ts';

export type { Entitlement } from './entitlement.ts';
export { quotaDecision, DEFAULT_STORAGE_CAP_BYTES } from './entitlement.ts';
export type { AccountDataHolder } from './env.ts';

export type VerifyError = 'invalid_token' | 'device_revoked' | 'grant_expired' | 'account_deleted';

export type VerifyResult =
  | { ok: true; userId: string; githubId: number; githubLogin: string; deviceId: string; entitlement: Entitlement }
  | { ok: false; error: VerifyError };

/** AccountRpc.redeemWebCode input (PAN-4481 FR-3): the share Worker redeems a code issued to its callback. */
export interface RedeemWebCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/** The result of redeeming a PKCE authorization code; the same rules and errors as POST /oauth/token. */
export type RedeemResult =
  | { ok: true; accessToken: string; deviceId: string; label: string }
  | { ok: false; error: 'invalid_request' | 'invalid_grant' | 'access_denied' };

/** AccountRpc.signOutDevice result (PAN-4481 FR-4). */
export type SignOutResult = { ok: true } | { ok: false; error: VerifyError };
