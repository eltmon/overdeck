/**
 * PAN-4435 dashboard keys, split out of schema.ts (a god file that must not
 * grow). Enforcement reads the raw file through src/lib/remote-access/config.ts.
 */

/** config.yaml `dashboard.*` keys (snake_case). Global config only. */
export interface DashboardYamlConfig {
  /** When true, a loopback peer no longer mints a root session (default false). */
  require_token_mint?: boolean;
}

/** Resolved dashboard settings. */
export interface NormalizedDashboardConfig {
  requireTokenMint: boolean;
}
