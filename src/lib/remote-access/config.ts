/**
 * Remote-access settings read from `${OVERDECK_HOME}/config.yaml` (PAN-3762 D-3762-9).
 *
 *   dashboard:
 *     require_token_mint: true   # default false
 *
 * When true, a loopback peer no longer counts as a trusted local caller for the
 * session mint, and a loopback peer carrying a proxy forwarding header is
 * treated as remote by the request gate. Turn it on whenever a local reverse
 * proxy (Tailscale Serve, cloudflared) makes remote visitors look local.
 *
 * Read from the raw YAML, the same way `readTraefikConfigFromYaml()` does, and
 * cached for the process lifetime: changing it needs a dashboard restart.
 * PAN-2351 later adds the schema entry and the Settings toggle. A missing,
 * unreadable or invalid value means `false`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { getOverdeckHome } from '../paths.js';

export interface RemoteAccessConfig {
  requireTokenMint: boolean;
}

let cached: RemoteAccessConfig | undefined;

export function readRemoteAccessConfig(): RemoteAccessConfig {
  if (cached) return cached;
  let requireTokenMint = false;
  try {
    const parsed = yaml.load(readFileSync(join(getOverdeckHome(), 'config.yaml'), 'utf8')) as
      | { dashboard?: { require_token_mint?: unknown } }
      | null
      | undefined;
    requireTokenMint = parsed?.dashboard?.require_token_mint === true;
  } catch {
    // Missing or unreadable config.yaml keeps the default.
  }
  cached = { requireTokenMint };
  return cached;
}

/** Test-only: forget the cached value so the next read re-parses config.yaml. */
export function _resetRemoteAccessConfigForTests(): void {
  cached = undefined;
}
