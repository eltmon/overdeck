/**
 * Keep token sign-in on while Tailscale Serve forwards to this dashboard
 * (PAN-1254 W-18, critique finding 1).
 *
 * Serve makes every tailnet visitor a loopback peer, and a loopback peer may
 * mint the root session unless `dashboard.require_token_mint` is on. A
 * Settings tab loaded before Serve was turned on can `PUT /api/settings` a
 * stale `require_token_mint: false` and reopen that hole, so every settings
 * save passes through this guard. To turn token sign-in off, the operator
 * first turns Serve off (`tailscale serve --https=443 off`).
 *
 * The Tailscale state module loads lazily, so `settings-api.ts` gains no
 * static dependency on the Tailscale modules and a save that does not turn
 * token sign-in off never touches Tailscale. The guard is generic over the
 * settings shape rather than importing `ApiSettingsConfig`, which would make
 * an import cycle with `settings-api.ts`.
 */
import type { TailscaleState } from './state.js';

interface WithDashboard {
  dashboard?: { require_token_mint?: boolean };
}

export interface TokenMintGuardDeps {
  readState?: () => Promise<Pick<TailscaleState, 'serve'>>;
}

/** `settings` unchanged unless it turns token sign-in off while Serve forwards here; then a copy with it on. */
export async function keepTokenMintWhileServing<T extends WithDashboard>(
  settings: T,
  deps: TokenMintGuardDeps = {},
): Promise<T> {
  if (settings.dashboard?.require_token_mint !== false) return settings;
  const readState = deps.readState ?? (async () => (await import('./state.js')).readTailscaleState());
  const state = await readState();
  if (!state.serve.proxiesDashboard) return settings;
  console.warn('[tailscale] kept dashboard.require_token_mint on: Tailscale Serve forwards to this dashboard');
  return { ...settings, dashboard: { ...settings.dashboard, require_token_mint: true } };
}
