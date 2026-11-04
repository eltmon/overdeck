/**
 * The pairing-link request shared by `pan pair` and `pan connect` (PAN-4656).
 *
 * Asks the running dashboard (with the internal token) for a one-time pairing
 * credential and builds `<base>/#pair=<credential>`. A leaf module: `pair.ts`
 * registers `pan connect` lazily, so `connect.ts` imports this file rather
 * than `pair.ts` and no import cycle forms. Imports only `dashboard-call.ts`
 * statically; config loads inside the request.
 */
import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';

export const NOT_RUNNING = 'Overdeck dashboard is not running; start it with `pan up`.';
export const TOKEN_REJECTED = 'The dashboard rejected this machine\'s internal token (from $OVERDECK_HOME/internal-token, default ~/.overdeck/internal-token). '
  + 'The running dashboard holds a different token: it uses another OVERDECK_HOME, or it was started before that file existed. '
  + 'Restart it with `pan up` or `npx @overdeck/core`, then run this command again.';
export const LOOPBACK_WARNING = 'This URL only works on this machine. Pass --url with an address another device can reach, and add that origin to OVERDECK_TRUSTED_ORIGINS.';

/** `<base>/#pair=<credential>`: the credential rides in the fragment only. */
export function pairingUrl(base: string, credential: string): string {
  return `${base.replace(/\/+$/, '')}/#pair=${credential}`;
}

export type PairingLinkResult =
  | { ok: true; url: string; credential: string; expiresAt: string; base: string }
  | { ok: false; message: string };

/**
 * Asks the local dashboard for a one-time pairing credential and builds
 * `<base>/#pair=<credential>`. `base` defaults to this dashboard's API URL;
 * `pan connect` passes an address another machine can reach (PAN-4656).
 * Maps unreachable ⇒ NOT_RUNNING, 401 ⇒ TOKEN_REJECTED, other ⇒ `pan pair failed: …`.
 */
export async function requestPairingLink(options: { label?: string; base?: string }): Promise<PairingLinkResult> {
  let response: Response;
  try {
    response = await callDashboard('/api/pairing/credentials', {
      method: 'POST',
      body: options.label ? { label: options.label } : {},
    });
  } catch (error) {
    if (isDashboardUnreachable(error)) return { ok: false, message: NOT_RUNNING };
    throw error;
  }
  if (response.status === 401) return { ok: false, message: TOKEN_REJECTED };
  if (!response.ok) return { ok: false, message: `pan pair failed: ${await errorText(response)}` };

  const { credential, expiresAt } = await response.json() as { credential: string; expiresAt: string };
  const { getDashboardApiUrl } = await import('../../lib/config.js');
  const base = options.base ?? getDashboardApiUrl();
  return { ok: true, url: pairingUrl(base, credential), credential, expiresAt, base };
}
