/**
 * Device credentials and verifyDevice (PRD §7.8). Scaffold stub; implemented by account-device-credentials.
 */
import type { RequestContext } from './env.ts';

export type VerifyFailure = {
  ok: false;
  error: 'invalid_token' | 'device_revoked' | 'grant_expired' | 'account_deleted';
};

export async function verifyDeviceToken(_rc: RequestContext, _token: string): Promise<VerifyFailure> {
  return { ok: false, error: 'invalid_token' };
}
