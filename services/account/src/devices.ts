/**
 * Device tokens, device records and verifyDevice (PRD PAN-4293 §7.8, D-5, D-6, D-17, D-18).
 *
 * A device token is `odd_` + 64 hex (256 bits); only its SHA-256 hex hash is stored. The plaintext exists
 * only in mintDevice()'s return value. Revocation is a column write, and verification is one D1 lookup
 * with no cache in front of it, so a revoked token is refused on the very next request (FR-5).
 */
import type { VerifyError, VerifyResult } from './contract.ts';
import { randomHex, sha256Hex } from './crypto.ts';
import { entitlementFor, type Entitlement } from './entitlement.ts';
import type { RequestContext } from './env.ts';
import { isOwner, type GrantsContext } from './grants.ts';
import { json } from './http.ts';

export type DeviceContext = GrantsContext;

export const TOKEN_RE = /^odd_[0-9a-f]{64}$/;
export const PLATFORM_RE = /^(linux|darwin|win32)-(x64|arm64)$/;
export const ENVIRONMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const LABEL_MAX_LENGTH = 64;
/** D-18: last_used_at is written at most once per device per 5 minutes. */
export const LAST_USED_THROTTLE_MS = 5 * 60_000;

export type RevokedBy = 'user' | 'operator' | 'account-deletion';

export interface DeviceRow {
  device_id: string;
  user_id: string;
  token_hash: string;
  platform: string;
  label: string;
  environment_id: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  revoked_by: RevokedBy | null;
}

export function isValidPlatform(platform: string): boolean {
  return PLATFORM_RE.test(platform);
}

export function isValidEnvironmentId(environmentId: string): boolean {
  return ENVIRONMENT_ID_RE.test(environmentId);
}

/** D-17: 1–64 characters after trimming, no control characters. Returns the normalized label or null. */
export function normalizeLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > LABEL_MAX_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/** D-17 default labels: never the hostname. */
export function defaultLabel(platform: string): string {
  if (platform.startsWith('darwin-')) return 'macOS device';
  if (platform.startsWith('win32-')) return 'Windows device';
  return 'Linux device';
}

export interface MintedDevice {
  token: string;
  deviceId: string;
  label: string;
}

/**
 * Mints a device token for (userId, environmentId). Signing in again from the same environment rotates the
 * active row's token in place (same deviceId and label); otherwise a new row with the default label is inserted.
 */
export async function mintDevice(rc: DeviceContext, userId: string, platform: string, environmentId: string): Promise<MintedDevice> {
  if (!isValidPlatform(platform)) throw new Error(`mintDevice: invalid platform ${JSON.stringify(platform)}`);
  if (!isValidEnvironmentId(environmentId)) throw new Error('mintDevice: invalid environmentId');
  const token = `odd_${randomHex(32)}`;
  const tokenHash = await sha256Hex(token);
  const db = rc.env.DB;

  const active = await db
    .prepare('SELECT device_id, label FROM devices WHERE user_id = ? AND environment_id = ? AND revoked_at IS NULL')
    .bind(userId, environmentId)
    .first<{ device_id: string; label: string }>();
  if (active) {
    await db
      .prepare('UPDATE devices SET token_hash = ?, platform = ?, last_used_at = NULL WHERE device_id = ?')
      .bind(tokenHash, platform, active.device_id)
      .run();
    return { token, deviceId: active.device_id, label: active.label };
  }

  const deviceId = crypto.randomUUID();
  const label = defaultLabel(platform);
  await db
    .prepare(
      'INSERT INTO devices (device_id, user_id, token_hash, platform, label, environment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(deviceId, userId, tokenHash, platform, label, environmentId, rc.deps.now())
    .run();
  return { token, deviceId, label };
}

interface LookupRow {
  device_id: string;
  user_id: string;
  revoked_at: number | null;
  last_used_at: number | null;
  github_id: number;
  github_login: string;
  deleted_at: number | null;
  grant_github_id: number | null;
  storage_cap_bytes: number | null;
  grant_expires_at: number | null;
}

/** Everything a request handler needs about an authenticated device. */
export interface DeviceAuth {
  userId: string;
  githubId: number;
  githubLogin: string;
  deviceId: string;
  entitlement: Entitlement;
  /** D-15: true when the account is neither the owner nor holds an unexpired grant. */
  grantExpired: boolean;
  grantExpiresAt: number | null;
}

export type DeviceLookup = { ok: true; auth: DeviceAuth } | { ok: false; error: VerifyError };

/** One D1 lookup by token hash across devices → users → grants, then the D-18 last_used_at throttle. */
export async function lookupDevice(rc: DeviceContext, token: string): Promise<DeviceLookup> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: 'invalid_token' };
  const now = rc.deps.now();
  const row = await rc.env.DB.prepare(
    `SELECT d.device_id, d.user_id, d.revoked_at, d.last_used_at,
            u.github_id, u.github_login, u.deleted_at,
            g.github_id AS grant_github_id, g.storage_cap_bytes, g.expires_at AS grant_expires_at
     FROM devices d
     JOIN users u ON u.user_id = d.user_id
     LEFT JOIN grants g ON g.github_id = u.github_id
     WHERE d.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<LookupRow>();
  if (!row) return { ok: false, error: 'invalid_token' };
  if (row.deleted_at !== null) return { ok: false, error: 'account_deleted' };
  if (row.revoked_at !== null) return { ok: false, error: 'device_revoked' };

  const owner = isOwner(rc, row.github_id);
  const grantActive = row.grant_github_id !== null && (row.grant_expires_at === null || row.grant_expires_at > now);
  const entitlement = owner ? entitlementFor(null) : entitlementFor(grantActive ? { storage_cap_bytes: row.storage_cap_bytes } : null);

  if (row.last_used_at === null || row.last_used_at < now - LAST_USED_THROTTLE_MS) {
    await rc.env.DB.prepare('UPDATE devices SET last_used_at = ? WHERE device_id = ? AND (last_used_at IS NULL OR last_used_at < ?)')
      .bind(now, row.device_id, now - LAST_USED_THROTTLE_MS)
      .run();
  }

  return {
    ok: true,
    auth: {
      userId: row.user_id,
      githubId: row.github_id,
      githubLogin: row.github_login,
      deviceId: row.device_id,
      entitlement,
      grantExpired: !owner && !grantActive,
      grantExpiresAt: owner ? null : row.grant_expires_at,
    },
  };
}

/** FR-6: the AccountRpc.verifyDevice contract. */
export async function verifyDeviceToken(rc: DeviceContext, token: string): Promise<VerifyResult> {
  const found = await lookupDevice(rc, token);
  if (!found.ok) return found;
  if (found.auth.grantExpired) return { ok: false, error: 'grant_expired' };
  const { userId, githubId, deviceId, entitlement } = found.auth;
  return { ok: true, userId, githubId, deviceId, entitlement };
}

export type AuthenticateResult = { ok: true; auth: DeviceAuth } | { ok: false; response: Response };

/**
 * Reads `Authorization: Bearer odd_…`. invalid_token / device_revoked / account_deleted → 401 with
 * WWW-Authenticate; grant_expired → 403 unless the route allows expired grants (D-15).
 */
export async function authenticateRequest(req: Request, rc: DeviceContext, opts: { allowExpiredGrant?: boolean } = {}): Promise<AuthenticateResult> {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const found = await lookupDevice(rc, match?.[1] ?? '');
  if (!found.ok) {
    return { ok: false, response: json({ error: found.error }, 401, { 'WWW-Authenticate': 'Bearer error="invalid_token"' }) };
  }
  if (found.auth.grantExpired && !opts.allowExpiredGrant) {
    return { ok: false, response: json({ error: 'grant_expired' }, 403) };
  }
  return found;
}

/** The user's active devices, oldest first. */
export async function listDevicesForUser(rc: DeviceContext, userId: string): Promise<DeviceRow[]> {
  const { results } = await rc.env.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC, device_id ASC')
    .bind(userId)
    .all<DeviceRow>();
  return results;
}

/** Renames one of the user's active devices; null when it is not theirs or is revoked. `label` must already be normalized. */
export async function renameDevice(rc: DeviceContext, userId: string, deviceId: string, label: string): Promise<DeviceRow | null> {
  return rc.env.DB.prepare('UPDATE devices SET label = ? WHERE device_id = ? AND user_id = ? AND revoked_at IS NULL RETURNING *')
    .bind(label, deviceId, userId)
    .first<DeviceRow>();
}

/** Revokes one of the user's active devices; false when it is not theirs or already revoked. */
export async function revokeDevice(rc: DeviceContext, userId: string, deviceId: string, revokedBy: RevokedBy = 'user'): Promise<boolean> {
  const result = await rc.env.DB.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(rc.deps.now(), revokedBy, deviceId, userId)
    .run();
  return result.meta.changes > 0;
}

/** Revokes every active device of a user at once (operator revoke and account deletion). */
export function revokeAllForUserStatement(rc: DeviceContext, userId: string, revokedBy: RevokedBy): D1PreparedStatement {
  return rc.env.DB.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE user_id = ? AND revoked_at IS NULL').bind(rc.deps.now(), revokedBy, userId);
}

export async function revokeAllForUser(rc: DeviceContext, userId: string, revokedBy: RevokedBy): Promise<number> {
  const result = await revokeAllForUserStatement(rc, userId, revokedBy).run();
  return result.meta.changes;
}
