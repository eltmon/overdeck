/**
 * Device identity via the account service's `AccountRpc` binding (PAN-4293), typed structurally so
 * this Worker never imports the account Worker's code. Copies services/share/src/account.ts.
 *
 * The plan comes from `entitlement` (PAN-2356 D-2356-3). An account service that returns no
 * entitlement, or a plan this Worker does not know, is reported as `account_service_outdated`.
 */
import type { ConnectIdentity, Env } from './env.ts';

export type AccountVerifyResult =
  | {
    ok: true;
    userId: string;
    githubId: number;
    deviceId: string;
    entitlement?: { plan: string; maxDevices: number | null };
  }
  | { ok: false; error: 'invalid_token' | 'device_revoked' | 'grant_expired' | 'account_deleted' };

export interface AccountBinding {
  verifyDevice(token: string): Promise<AccountVerifyResult>;
}

export type VerifyIdentityResult =
  | { ok: true; identity: ConnectIdentity }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** A device token: `odd_` + 64 lowercase hex (PAN-4293 TOKEN_RE). */
const DEVICE_BEARER_RE = /^Bearer (odd_[0-9a-f]{64})$/;

/** The phone's subprotocol carrying its device token (PAN-4823 W-CON2): browsers cannot set Authorization on a WebSocket. */
export const BEARER_SUBPROTOCOL_PREFIX = 'overdeck.bearer.';
const DEVICE_TOKEN_RE = /^odd_[0-9a-f]{64}$/;

/**
 * The device token of a directory upgrade and, when it came from the subprotocol, the exact
 * protocol string to echo. `Authorization` wins when present (machines); otherwise the first
 * `overdeck.bearer.` entry of `Sec-WebSocket-Protocol`.
 */
export function directoryToken(headers: Headers): { authorization: string | null; protocol: string | null } {
  const authorization = headers.get('Authorization');
  if (authorization !== null) return { authorization, protocol: null };
  const offered = (headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
  const protocol = offered.find((p) => p.startsWith(BEARER_SUBPROTOCOL_PREFIX)) ?? null;
  if (protocol === null) return { authorization: null, protocol: null };
  const token = protocol.slice(BEARER_SUBPROTOCOL_PREFIX.length);
  return DEVICE_TOKEN_RE.test(token) ? { authorization: `Bearer ${token}`, protocol } : { authorization: null, protocol: null };
}

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
  const plan = result.entitlement?.plan;
  if (plan !== 'free' && plan !== 'tester') return { ok: false, status: 503, error: 'account_service_outdated' };
  return {
    ok: true,
    identity: {
      userId: result.userId,
      githubId: result.githubId,
      deviceId: result.deviceId,
      plan,
      maxDevices: result.entitlement?.maxDevices ?? null,
    },
  };
}
