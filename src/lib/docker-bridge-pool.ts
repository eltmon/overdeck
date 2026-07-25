/**
 * Docker bridge-network pool accounting (PAN-3053).
 *
 * Docker's predefined address pools cap how many bridge networks may exist on a
 * host at once. Every bridge network consumes a slot regardless of who created
 * it, so the only correct denominator is the host-wide bridge count — not the
 * subset matching one project's naming convention.
 *
 * The original detector counted only `overdeck-feature-*_devnet` and compared
 * that against the ~31-network limit. On a host at 31/31 it saw 12 and reported
 * healthy while every workspace rebuild failed with "all predefined address
 * pools have been fully subnetted". The per-project breakdown survives here as
 * diagnostic detail on the message; the threshold is taken on the total.
 */

import { promises as fsp } from 'fs';

/**
 * Usable bridge networks under Docker's built-in default pools
 * (`172.17.0.0/12` size 16 plus `192.168.0.0/16` size 20). Measured on an
 * exhausted host: `docker network create` began refusing at 31 total bridge
 * networks, counting the built-in `bridge` network itself.
 */
export const DEFAULT_DOCKER_BRIDGE_POOL_LIMIT = 31;

/** Free slots remaining at which the pool is reported as under pressure. */
export const BRIDGE_POOL_WARNING_HEADROOM = 5;

/** Lists every bridge network on the host, one name per line. */
export const LIST_BRIDGE_NETWORKS_COMMAND = `docker network ls --filter driver=bridge --format '{{.Name}}'`;

export const DOCKER_DAEMON_JSON_PATH = '/etc/docker/daemon.json';

export interface BridgePoolGroup {
  /** Display label, e.g. `overdeck-feature-*`, `myn-feature-*`, or `other`. */
  label: string;
  count: number;
}

export interface BridgePoolPressure {
  /** Every bridge network on the host — the quantity the pool limit governs. */
  total: number;
  /** Slots the host's pool configuration actually provides. */
  limit: number;
  /** Slots left before `docker network create` fails; never negative. */
  headroom: number;
  /** Within `BRIDGE_POOL_WARNING_HEADROOM` slots of the limit. */
  underPressure: boolean;
  /** At or over the limit — new workspace stacks cannot be created. */
  exhausted: boolean;
  /** Per-project breakdown, largest group first, for diagnosis. */
  groups: BridgePoolGroup[];
}

/** `overdeck-feature-pan-2997_devnet`, `myn-feature-min-852_default`, … */
const FEATURE_NETWORK_RE = /^(.+?)-feature-[a-z0-9]+-\d+_(?:devnet|default)$/i;

export function parseBridgeNetworkNames(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Groups networks by the project prefix of their compose project name so the
 * message names which project is consuming the pool. Anything that is not a
 * workspace stack network (`bridge`, `overdeck`, a project's main stack) lands
 * in `other`.
 */
export function groupBridgeNetworkNames(names: string[]): BridgePoolGroup[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const match = name.match(FEATURE_NETWORK_RE);
    const label = match ? `${match[1]}-feature-*` : 'other';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Capacity declared by `default-address-pools`: each pool yields
 * `2^(size - baseMaskBits)` subnets. Returns null when the config is absent or
 * malformed so the caller falls back to the measured default limit rather than
 * trusting a number it could not derive.
 */
export function bridgePoolLimitFromPools(pools: unknown[] | null): number | null {
  if (!Array.isArray(pools) || pools.length === 0) return null;

  let capacity = 0;
  for (const pool of pools) {
    const entry = pool as { base?: unknown; size?: unknown };
    if (typeof entry?.base !== 'string' || typeof entry?.size !== 'number') return null;
    const baseMask = Number(entry.base.split('/')[1]);
    if (!Number.isInteger(baseMask) || baseMask < 0 || baseMask > 32) return null;
    if (!Number.isInteger(entry.size) || entry.size < baseMask || entry.size > 32) return null;
    capacity += 2 ** (entry.size - baseMask);
  }
  return capacity > 0 ? capacity : null;
}

/**
 * Reads `default-address-pools` from daemon.json. Returns null when the file is
 * missing, unreadable, or declares no pools — which is itself the signal that
 * the host is on Docker's narrow built-in pools.
 */
export async function readDockerDaemonPools(): Promise<unknown[] | null> {
  try {
    const text = await fsp.readFile(DOCKER_DAEMON_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(text) as { 'default-address-pools'?: unknown };
    const pools = parsed['default-address-pools'];
    return Array.isArray(pools) ? pools : null;
  } catch {
    return null;
  }
}

export function assessBridgePoolPressure(
  names: string[],
  limit: number = DEFAULT_DOCKER_BRIDGE_POOL_LIMIT,
): BridgePoolPressure {
  const total = names.length;
  const effectiveLimit = Math.max(1, limit);
  return {
    total,
    limit: effectiveLimit,
    headroom: Math.max(0, effectiveLimit - total),
    underPressure: total >= effectiveLimit - BRIDGE_POOL_WARNING_HEADROOM,
    exhausted: total >= effectiveLimit,
    groups: groupBridgeNetworkNames(names),
  };
}

/** `myn-feature-* 13, overdeck-feature-* 6, other 5` — empty when nothing to show. */
export function formatBridgePoolBreakdown(groups: BridgePoolGroup[]): string {
  return groups.map((group) => `${group.label} ${group.count}`).join(', ');
}
