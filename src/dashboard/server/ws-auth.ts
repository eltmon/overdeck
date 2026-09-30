/**
 * Shared WebSocket upgrade authorizer for every raw `/ws/*` endpoint
 * (`ws-terminal.ts`, `ws-rpc.ts`, `ws-voice.ts`, `ws-autopreso.ts`).
 *
 * One chokepoint (FR-1) so all four surfaces reject the same way: origin
 * check first, then a configured internal token, then a credential (session
 * cookie, internal token header/Bearer, or a registry `odk_` credential), then
 * the credential's scopes (PAN-2351): `/ws/terminal` needs `operate`, every
 * other endpoint needs `admin`, and a credential without it gets 403.
 * Peer-based trust (the loopback and Docker-bridge check the session mint
 * uses) is deliberately NOT consulted here (FR-3) — it lives only in the mint,
 * so `require_token_mint` can close peer trust everywhere at once by changing
 * the mint alone. See docs/DASHBOARD-AUTH.md.
 */
import type { Socket } from 'node:net';

import { scopeSatisfies, type AccessTokenScope } from '../../lib/access-tokens.js';
import { getInternalToken } from '../../lib/internal-token.js';
import { registerDeviceConnection, revocableCredentialId } from './device-connections.js';
import { credentialScopes, resolveDashboardCredential, type DashboardCredential } from './routes/dashboard-auth.js';
import { validateOriginHeaders, type HeaderMap } from './routes/origin-validation.js';

/**
 * Every `/ws/*` upgrade requires a credential. `GET /api/environment` reports
 * this as `capabilities.terminalAuth`.
 */
export const WS_UPGRADE_REQUIRES_CREDENTIAL = true;

export type UpgradeAuthResult =
  | { ok: true; credential: DashboardCredential }
  | { ok: false; status: 401 | 403 | 503; message: string };

export function authorizeDashboardUpgrade(
  headers: HeaderMap,
  method: string,
  requiredScope: AccessTokenScope = 'admin',
): UpgradeAuthResult {
  const origin = validateOriginHeaders(headers, method);
  if (!origin.ok) return { ok: false, status: 403, message: origin.error };
  if (!getInternalToken()) return { ok: false, status: 503, message: 'dashboard session token not configured' };
  // PAN-2351 D-10: access tokens arrive only in the Authorization header, never a ?token= query.
  const credential = resolveDashboardCredential(headers);
  if (!credential) return { ok: false, status: 401, message: 'Unauthorized' };
  if (!scopeSatisfies(credentialScopes(credential), requiredScope)) {
    return { ok: false, status: 403, message: `Forbidden: missing scope ${requiredScope}` };
  }
  return { ok: true, credential };
}

/** The part of a `ws` WebSocket that revocation needs. */
export interface ClosableSocket {
  close(code?: number, reason?: string): void;
  once(event: 'close', listener: () => void): unknown;
}

/**
 * Close a socket opened by a revocable credential (a paired device or an
 * access token) with code 4401 when its record is revoked (PAN-3762
 * D-3762-10, PAN-2351 FR-4). Root credentials are not revocable, so this does
 * nothing for them.
 */
export function trackDeviceSocket(credential: DashboardCredential, ws: ClosableSocket): void {
  const recordId = revocableCredentialId(credential);
  if (recordId === null) return;
  const unregister = registerDeviceConnection(recordId, () => ws.close(4401, 'device revoked'));
  ws.once('close', unregister);
}

export function rejectUpgrade(socket: Socket, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
