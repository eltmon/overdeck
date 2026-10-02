/**
 * Types consumed by other hosted services (PRD PAN-4293 §7.8, §7.13, D-16).
 * The hosted vault (PAN-4297) imports VerifyResult, AccountDataHolder and quotaDecision from here.
 */
import type { Entitlement } from './entitlement.ts';

export type { Entitlement } from './entitlement.ts';
export { quotaDecision, DEFAULT_STORAGE_CAP_BYTES } from './entitlement.ts';
export type { AccountDataHolder } from './env.ts';

export type VerifyError = 'invalid_token' | 'device_revoked' | 'grant_expired' | 'account_deleted';

export type VerifyResult =
  | { ok: true; userId: string; githubId: number; deviceId: string; entitlement: Entitlement }
  | { ok: false; error: VerifyError };
