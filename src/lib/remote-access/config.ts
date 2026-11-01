/**
 * Remote-access settings read from `${OVERDECK_HOME}/config.yaml` (PAN-3762 D-3762-9).
 *
 *   dashboard:
 *     require_token_mint: true   # default false
 *
 * When on, a loopback peer no longer counts as a trusted local caller for the
 * session mint, and a loopback peer carrying a proxy forwarding header is
 * treated as remote by the request gate. Turn it on whenever a local reverse
 * proxy (Tailscale Serve, cloudflared) makes remote visitors look local.
 *
 * PAN-4645 D-4645-12: the effective value can only be widened. It is on when
 * the YAML says so OR this machine has any remote access at all: a saved
 * non-loopback trusted address, an active paired device, or a machine link
 * (outbound link or inbound machine token). An explicit `false` cannot turn it
 * off while remote access exists, because the lossy whole-document Settings
 * save writes the current value back and would otherwise freeze `false` after
 * a link appears. Settings reports the enforced value (D-1); `configured` is
 * the YAML value and `autoReasons` says why the toggle is on by itself (both
 * ride in the Anywhere status so the toggle can explain itself).
 *
 * The YAML value and the saved-origins check are cached until a Settings save
 * or trusted-origin add calls `invalidateRemoteAccessConfig()`; device and
 * machine presence read the in-memory snapshots on every call, so a new link
 * or device takes effect at once.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { listActiveRecordsOfKind } from '../access-tokens.js';
import { hasActiveLinks } from '../anywhere/link-store.js';
import { getOverdeckHome } from '../paths.js';
import { isLoopbackOrigin } from './loopback.js';
import { readSavedTrustedOriginsSync } from './trusted-origins.js';

export type AutoMintReason = 'trusted-address' | 'paired-device' | 'machine-link';

export interface RemoteAccessConfig {
  /** The enforced value: `configured || autoReasons.length > 0`. */
  requireTokenMint: boolean;
  /** The YAML value (the Anywhere status carries it; Settings reports the enforced value). */
  configured: boolean;
  /** Why the value is on regardless of the YAML; empty when only the YAML decides. */
  autoReasons: AutoMintReason[];
}

interface CachedFacts {
  configured: boolean;
  hasRemoteOrigin: boolean;
}

let cached: CachedFacts | undefined;

function readFacts(): CachedFacts {
  if (cached) return cached;
  let configured = false;
  try {
    const parsed = yaml.load(readFileSync(join(getOverdeckHome(), 'config.yaml'), 'utf8')) as
      | { dashboard?: { require_token_mint?: unknown } }
      | null
      | undefined;
    configured = parsed?.dashboard?.require_token_mint === true;
  } catch {
    // Missing or unreadable config.yaml keeps the default.
  }
  let hasRemoteOrigin = false;
  try {
    hasRemoteOrigin = readSavedTrustedOriginsSync().some((origin) => !isLoopbackOrigin(origin));
  } catch {
    // An unreadable trusted-origins file widens nothing.
  }
  cached = { configured, hasRemoteOrigin };
  return cached;
}

export function readRemoteAccessConfig(): RemoteAccessConfig {
  const facts = readFacts();
  const autoReasons: AutoMintReason[] = [];
  if (facts.hasRemoteOrigin) autoReasons.push('trusted-address');
  if (listActiveRecordsOfKind('device').length > 0) autoReasons.push('paired-device');
  if (hasActiveLinks() || listActiveRecordsOfKind('machine').length > 0) autoReasons.push('machine-link');
  return { requireTokenMint: facts.configured || autoReasons.length > 0, configured: facts.configured, autoReasons };
}

/** Forget the cached YAML and saved-origins facts so the next read re-parses them. A Settings save or trusted-origin add calls this. */
export function invalidateRemoteAccessConfig(): void {
  cached = undefined;
}
