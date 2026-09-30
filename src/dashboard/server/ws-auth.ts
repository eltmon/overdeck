/**
 * Shared WebSocket upgrade authorizer for every raw `/ws/*` endpoint
 * (`ws-terminal.ts`, `ws-rpc.ts`, `ws-voice.ts`, `ws-autopreso.ts`).
 *
 * One chokepoint (FR-1) so all four surfaces reject the same way: origin
 * check first, then a configured internal token, then a credential (session
 * cookie or internal token header/Bearer). Peer-based trust (the loopback and
 * Docker-bridge check the session mint uses) is deliberately NOT consulted
 * here (FR-3) — it lives only in the mint, so PAN-2351's `require_token_mint`
 * switch can close peer trust everywhere at once by changing the mint alone.
 * See docs/DASHBOARD-AUTH.md.
 */
import type { Socket } from 'node:net';

import { getInternalToken } from '../../lib/internal-token.js';
import { registerDeviceConnection } from './device-connections.js';
import { resolveDashboardCredential, type DashboardCredential } from './routes/dashboard-auth.js';
import { validateOriginHeaders, type HeaderMap } from './routes/origin-validation.js';

/**
 * Every `/ws/*` upgrade requires a credential. `GET /api/environment` reports
 * this as `capabilities.terminalAuth`.
 */
export const WS_UPGRADE_REQUIRES_CREDENTIAL = true;

export type UpgradeAuthResult =
  | { ok: true; credential: DashboardCredential }
  | { ok: false; status: 401 | 403 | 503; message: string };

export function authorizeDashboardUpgrade(headers: HeaderMap, method: string): UpgradeAuthResult {
  const origin = validateOriginHeaders(headers, method);
  if (!origin.ok) return { ok: false, status: 403, message: origin.error };
  if (!getInternalToken()) return { ok: false, status: 503, message: 'dashboard session token not configured' };
  // PAN-2351 adds scoped access tokens (?token=) here.
  const credential = resolveDashboardCredential(headers);
  if (!credential) return { ok: false, status: 401, message: 'Unauthorized' };
  return { ok: true, credential };
}

/** The part of a `ws` WebSocket that revocation needs. */
export interface ClosableSocket {
  close(code?: number, reason?: string): void;
  once(event: 'close', listener: () => void): unknown;
}

/**
 * Close a device-authenticated socket with code 4401 when the device is
 * revoked (PAN-3762 D-3762-10). Other credentials are not revocable, so this
 * does nothing for them.
 */
export function trackDeviceSocket(credential: DashboardCredential, ws: ClosableSocket): void {
  if (credential.kind !== 'device') return;
  const unregister = registerDeviceConnection(credential.deviceId, () => ws.close(4401, 'device revoked'));
  ws.once('close', unregister);
}

export function rejectUpgrade(socket: Socket, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
