/**
 * Last known usage totals of linked machines (PAN-4651 FR-8, D-4651-19):
 * `${OVERDECK_HOME}/fleet-usage-cache.json`, 0600, written through a temp file
 * and rename. It holds totals only (no request hashes), keyed by environment
 * id, each with the time it was fetched, so an offline machine's row can show
 * its cached numbers and their age. A missing or unreadable file is empty.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { UsageWindows } from '../../../lib/costs/request-digest.js';
import { getOverdeckHome } from '../../../lib/paths.js';

export const FLEET_USAGE_CACHE_FILENAME = 'fleet-usage-cache.json';

export interface CachedUsage extends UsageWindows {
  fetchedAt: string;
}

export type FleetUsageCache = Record<string, CachedUsage>;

export function fleetUsageCachePath(): string {
  return join(getOverdeckHome(), FLEET_USAGE_CACHE_FILENAME);
}

export async function readFleetUsageCache(): Promise<FleetUsageCache> {
  try {
    const parsed = JSON.parse(await readFile(fleetUsageCachePath(), 'utf8')) as { v?: unknown; machines?: unknown };
    return parsed.v === 1 && parsed.machines && typeof parsed.machines === 'object' ? parsed.machines as FleetUsageCache : {};
  } catch {
    return {};
  }
}

export async function writeFleetUsageCache(machines: FleetUsageCache): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${FLEET_USAGE_CACHE_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify({ v: 1, machines }, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, fleetUsageCachePath());
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
