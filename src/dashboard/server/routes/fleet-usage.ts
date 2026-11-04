/**
 * Fleet usage (PAN-4651 FR-8, D-4651-19): `GET /api/fleet/usage` (admin)
 * answers one row per machine (this machine first, then every link by label)
 * with today / week / month totals, plus an All machines total that counts a
 * provider request recorded on two machines once.
 *
 * An online link is asked for `GET /api/costs/summary` and `GET
 * /api/costs/request-digest` (2.5 s each); its totals are cached to
 * `fleet-usage-cache.json`. An offline (or failing) link answers its cached
 * totals with `cached: true` and `fetchedAt`, or no numbers. All machines is
 * the sum of the rows minus, per window, the cost of every request hash an
 * earlier machine already counted (`duplicates`). A cached row has no digest,
 * so it cannot be de-duplicated.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { linkFetch } from '../../../lib/anywhere/link-client.js';
import { listLinks, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { readLocalUsage, type RequestDigestEntry, type UsageWindow, type UsageWindows, windowsOf } from '../../../lib/costs/request-digest.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentLinkSupervisor } from '../services/anywhere-boot.js';
import { type FleetUsageCache, readFleetUsageCache, writeFleetUsageCache } from '../services/fleet-usage-cache.js';
import { connectingStatusSource, type LinkStatusSource } from '../services/machine-link-service.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
import { refuseFleetRequest } from './machines-fleet.js';

export const FLEET_USAGE_TIMEOUT_MS = 2_500;

const WINDOWS = ['today', 'week', 'month'] as const;
const emptyWindow = (): UsageWindow => ({ totalCost: 0, totalTokens: 0, entryCount: 0 });
const emptyWindows = (): UsageWindows => ({ today: emptyWindow(), week: emptyWindow(), month: emptyWindow() });

export interface FleetUsageRow {
  environmentId: string;
  label: string;
  self: boolean;
  state: string;
  cached: boolean;
  fetchedAt: string | null;
  today: UsageWindow | null;
  week: UsageWindow | null;
  month: UsageWindow | null;
}

export interface FleetUsageDeps {
  self: () => Promise<{ environmentId: string; label: string }>;
  local: () => Promise<{ windows: UsageWindows; digest: { entries: RequestDigestEntry[] } }>;
  links: () => Promise<MachineLink[]>;
  status: LinkStatusSource['status'];
  fetchPeer: (environmentId: string, path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
  readCache: () => Promise<FleetUsageCache>;
  writeCache: (cache: FleetUsageCache) => Promise<void>;
  now: () => number;
}

export const defaultFleetUsageDeps = (): FleetUsageDeps => ({
  self: async () => {
    const identity = await ensureEnvironmentIdentity();
    return { environmentId: identity.environmentId, label: identity.label };
  },
  local: () => readLocalUsage(),
  links: listLinks,
  status: (linkId) => (currentLinkSupervisor() ?? connectingStatusSource).status(linkId),
  fetchPeer: (environmentId, path, signal) => linkFetch(environmentId, path, { actor: 'operator', signal }),
  readCache: readFleetUsageCache,
  writeCache: writeFleetUsageCache,
  now: Date.now,
});

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // AbortController + setTimeout rather than AbortSignal.timeout, so fake timers drive it in tests.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLEET_USAGE_TIMEOUT_MS);
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function asWindow(value: unknown): UsageWindow | null {
  const window = value as Partial<UsageWindow> | null;
  if (!window || typeof window.totalCost !== 'number') return null;
  return { totalCost: window.totalCost, totalTokens: typeof window.totalTokens === 'number' ? window.totalTokens : 0, entryCount: typeof window.entryCount === 'number' ? window.entryCount : 0 };
}

/** A link's summary and digest, or null when it could not be read within the timeout. */
async function readPeerUsage(link: MachineLink, deps: FleetUsageDeps): Promise<{ windows: UsageWindows; entries: RequestDigestEntry[] } | null> {
  try {
    const [summary, digest] = await Promise.all([
      withTimeout((signal) => deps.fetchPeer(link.environmentId, '/api/costs/summary', signal)),
      withTimeout((signal) => deps.fetchPeer(link.environmentId, '/api/costs/request-digest', signal)),
    ]);
    if (summary.status !== 200) return null;
    const body = summary.json as Record<string, unknown> | null;
    const windows = { today: asWindow(body?.['today']), week: asWindow(body?.['week']), month: asWindow(body?.['month']) };
    if (!windows.today || !windows.week || !windows.month) return null;
    const entries = digest.status === 200 && Array.isArray((digest.json as { entries?: unknown } | null)?.entries)
      ? (digest.json as { entries: RequestDigestEntry[] }).entries
      : [];
    return { windows: windows as UsageWindows, entries };
  } catch {
    return null;
  }
}

export async function buildFleetUsage(deps: FleetUsageDeps = defaultFleetUsageDeps()) {
  const now = deps.now();
  const [self, local, links, cache] = await Promise.all([deps.self(), deps.local(), deps.links(), deps.readCache()]);
  const sorted = links.filter((link) => !link.revokedAt).sort((a, b) => a.label.localeCompare(b.label));
  const peers = await Promise.all(sorted.map(async (link) => {
    const state = deps.status(link.id).state;
    return { link, state, usage: state === 'online' ? await readPeerUsage(link, deps) : null };
  }));

  const nextCache: FleetUsageCache = { ...cache };
  const rows: FleetUsageRow[] = [{ ...self, self: true, state: 'self', cached: false, fetchedAt: new Date(now).toISOString(), ...local.windows }];
  const digests: RequestDigestEntry[][] = [local.digest.entries];
  for (const { link, state, usage } of peers) {
    if (usage) {
      const fetchedAt = new Date(now).toISOString();
      nextCache[link.environmentId] = { ...usage.windows, fetchedAt };
      rows.push({ environmentId: link.environmentId, label: link.label, self: false, state, cached: false, fetchedAt, ...usage.windows });
      digests.push(usage.entries);
      continue;
    }
    const known = cache[link.environmentId];
    rows.push({
      environmentId: link.environmentId, label: link.label, self: false, state, cached: known !== undefined,
      fetchedAt: known?.fetchedAt ?? null, today: known?.today ?? null, week: known?.week ?? null, month: known?.month ?? null,
    });
  }

  const duplicates = emptyWindows();
  const seen = new Set<string>();
  for (const entries of digests) {
    const mine = new Set<string>();
    for (const [hash, ts, cost] of entries) {
      if (seen.has(hash)) {
        for (const window of windowsOf(ts, now)) {
          duplicates[window].totalCost += cost;
          duplicates[window].entryCount += 1;
        }
      }
      mine.add(hash);
    }
    for (const hash of mine) seen.add(hash);
  }
  const allMachines = emptyWindows();
  for (const row of rows) {
    for (const window of WINDOWS) {
      const value = row[window];
      if (!value) continue;
      allMachines[window].totalCost += value.totalCost;
      allMachines[window].totalTokens += value.totalTokens;
      allMachines[window].entryCount += value.entryCount;
    }
  }
  for (const window of WINDOWS) {
    allMachines[window].totalCost -= duplicates[window].totalCost;
    allMachines[window].entryCount -= duplicates[window].entryCount;
  }
  if (peers.some((peer) => peer.usage)) await deps.writeCache(nextCache).catch(() => undefined);
  return { machines: rows, allMachines, duplicates };
}

const getFleetUsageRoute = HttpRouter.add(
  'GET',
  '/api/fleet/usage',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    return jsonResponse(yield* Effect.promise(() => buildFleetUsage()));
  }),
);

export const fleetUsageRouteLayer = Layer.mergeAll(getFleetUsageRoute);
