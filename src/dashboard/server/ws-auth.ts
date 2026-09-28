/**
 * Shared WebSocket upgrade authorizer for every raw `/ws/*` endpoint
 * (`ws-terminal.ts`, `ws-rpc.ts`, `ws-voice.ts`, `ws-autopreso.ts`).
 *
 * One chokepoint (FR-1) so all four surfaces reject the same way: origin
 * check first, then a configured internal token, then a credential (session
 * cookie or internal token header/Bearer). Peer-based trust (`isLoopbackPeer`)
 * is deliberately NOT consulted here (FR-3) — it lives only in the session
 * mint, so PAN-2351's `require_token_mint` switch can close peer trust
 * everywhere at once by changing the mint alone. See docs/DASHBOARD-AUTH.md.
 */
import type { Socket } from 'node:net';

import { getInternalToken } from '../../lib/internal-token.js';
import { hasDashboardAuthHeaders } from './routes/dashboard-auth.js';
import { validateOriginHeaders, type HeaderMap } from './routes/origin-validation.js';

export type UpgradeAuthResult = { ok: true } | { ok: false; status: 401 | 403 | 503; message: string };

export function authorizeDashboardUpgrade(headers: HeaderMap, method: string): UpgradeAuthResult {
  const origin = validateOriginHeaders(headers, method);
  if (!origin.ok) return { ok: false, status: 403, message: origin.error };
  if (!getInternalToken()) return { ok: false, status: 503, message: 'dashboard session token not configured' };
  // PAN-2351 adds scoped access tokens (?token=) here.
  if (!hasDashboardAuthHeaders(headers)) return { ok: false, status: 401, message: 'Unauthorized' };
  return { ok: true };
}

export function rejectUpgrade(socket: Socket, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
