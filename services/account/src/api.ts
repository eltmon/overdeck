/**
 * Device API /v1/* (PRD PAN-4293 §7.9, FR-4, D-15). Bearer device tokens only; every handler acts on the caller's own user.
 * GET /v1/me and DELETE /v1/devices/:id keep working with an expired grant so a tester can still see status and sign out.
 */
import { authenticateRequest, listDevicesForUser, normalizeLabel, renameDevice as renameDeviceRow, revokeDevice as revokeDeviceRow, type DeviceRow } from './devices.ts';
import type { Handler } from './env.ts';
import { json, noContent } from './http.ts';

function deviceJson(row: DeviceRow, currentDeviceId: string) {
  return {
    deviceId: row.device_id,
    label: row.label,
    platform: row.platform,
    environmentId: row.environment_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    current: row.device_id === currentDeviceId,
  };
}

/** GET /v1/me */
export const me: Handler = async (req, rc) => {
  const result = await authenticateRequest(req, rc, { allowExpiredGrant: true });
  if (!result.ok) return result.response;
  const { userId, githubId, githubLogin, deviceId, entitlement, grantExpired, grantExpiresAt } = result.auth;
  return json({
    userId,
    githubId,
    githubLogin,
    deviceId,
    entitlement,
    access: { status: grantExpired ? 'grant_expired' : 'active', expiresAt: grantExpiresAt },
  });
};

/** GET /v1/devices */
export const listDevices: Handler = async (req, rc) => {
  const result = await authenticateRequest(req, rc);
  if (!result.ok) return result.response;
  const rows = await listDevicesForUser(rc, result.auth.userId);
  return json({ devices: rows.map((row) => deviceJson(row, result.auth.deviceId)) });
};

/** PATCH /v1/devices/:id with JSON { "label": string } */
export const renameDevice: Handler = async (req, rc) => {
  const result = await authenticateRequest(req, rc);
  if (!result.ok) return result.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const label = normalizeLabel(typeof body === 'object' && body !== null ? (body as { label?: unknown }).label : undefined);
  if (label === null) return json({ error: 'invalid_label' }, 400);
  const row = await renameDeviceRow(rc, result.auth.userId, rc.params.id ?? '', label);
  if (!row) return json({ error: 'not_found' }, 404);
  return json(deviceJson(row, result.auth.deviceId));
};

/** DELETE /v1/devices/:id — revoking the calling device is sign-out. */
export const revokeDevice: Handler = async (req, rc) => {
  const result = await authenticateRequest(req, rc, { allowExpiredGrant: true });
  if (!result.ok) return result.response;
  const revoked = await revokeDeviceRow(rc, result.auth.userId, rc.params.id ?? '', 'user');
  if (!revoked) return json({ error: 'not_found' }, 404);
  return noContent();
};
