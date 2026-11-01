/** PAN-4651 WI-24 (D-4651-19): fleet usage rows, cached offline rows, and duplicate requests counted once. */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { requestHash } from '../../../lib/costs/request-digest.js';
import { buildFleetUsage, type FleetUsageDeps } from '../routes/fleet-usage.js';
import { fleetUsageCachePath, readFleetUsageCache, writeFleetUsageCache } from '../services/fleet-usage-cache.js';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const TODAY = Date.parse('2026-11-01T09:00:00.000Z');
const w = (totalCost: number, entryCount = 1) => ({ totalCost, totalTokens: 100 * entryCount, entryCount });
const windows = (today: number, week: number, month: number) => ({ today: w(today), week: w(week), month: w(month) });
const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;
const LAB = { id: 'link-lab', environmentId: 'env-lab', label: 'lab', revokedAt: null } as MachineLink;

function deps(overrides: Partial<FleetUsageDeps> = {}, deskEntries: Array<[string, number, number]> = []): FleetUsageDeps {
  return {
    self: async () => ({ environmentId: 'env-laptop', label: 'laptop' }),
    local: async () => ({ windows: windows(1, 5, 20), digest: { entries: [[requestHash('req-shared'), TODAY, 0.4], [requestHash('req-a'), TODAY, 0.6]] } }),
    links: async () => [DESK, LAB],
    status: ((linkId: string) => ({ state: linkId === 'link-desk' ? 'online' : 'offline' })) as never,
    fetchPeer: vi.fn(async (_env: string, path: string) => (path === '/api/costs/summary'
      ? { status: 200, json: { project: null, ...windows(2, 6, 30) } }
      : { status: 200, json: { since: '2026-10-02', entries: deskEntries, complete: true } })),
    readCache: async () => ({}),
    writeCache: vi.fn(async () => undefined),
    now: () => NOW,
    ...overrides,
  };
}

describe('GET /api/fleet/usage (D-4651-19)', () => {
  it('ac24: with no shared request ids, All machines equals the sum of rows', async () => {
    const answer = await buildFleetUsage(deps({}, [[requestHash('req-b'), TODAY, 2]]));
    expect(answer.machines.map((row) => [row.label, row.self, row.cached, row.today?.totalCost ?? null])).toEqual([
      ['laptop', true, false, 1], ['desk', false, false, 2], ['lab', false, false, null],
    ]);
    expect(answer.allMachines.today.totalCost).toBe(3);
    expect(answer.allMachines.month.totalCost).toBe(50);
    expect(answer.duplicates.today.totalCost).toBe(0);
  });

  it('ac24: one shared hash is subtracted once and reported in duplicates', async () => {
    const answer = await buildFleetUsage(deps({}, [[requestHash('req-shared'), TODAY, 0.4], [requestHash('req-b'), TODAY, 1.6]]));
    expect(answer.duplicates.today).toEqual({ totalCost: 0.4, totalTokens: 0, entryCount: 1 });
    expect(answer.allMachines.today.totalCost).toBeCloseTo(3 - 0.4);
    expect(answer.allMachines.month.totalCost).toBeCloseTo(50 - 0.4);
  });

  it('ac24: an offline link returns its cached row with cached: true and fetchedAt', async () => {
    const answer = await buildFleetUsage(deps({ readCache: async () => ({ 'env-lab': { ...windows(7, 8, 9), fetchedAt: '2026-10-31T08:00:00.000Z' } }) }));
    expect(answer.machines[2]).toMatchObject({ label: 'lab', state: 'offline', cached: true, fetchedAt: '2026-10-31T08:00:00.000Z', today: w(7) });
    expect(answer.allMachines.today.totalCost).toBe(10);
  });

  it('caches an online link\'s totals for later', async () => {
    const writeCache = vi.fn(async () => undefined);
    await buildFleetUsage(deps({ writeCache }));
    expect(writeCache).toHaveBeenCalledWith({ 'env-desk': { ...windows(2, 6, 30), fetchedAt: '2026-11-01T12:00:00.000Z' } });
  });
});

describe('fleet usage cache file (D-4651-19)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-4651-usage-cache-'));
    process.env.OVERDECK_HOME = home;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('writes 0600 and reads back; a missing file is empty', async () => {
    expect(await readFleetUsageCache()).toEqual({});
    await writeFleetUsageCache({ 'env-desk': { ...windows(1, 2, 3), fetchedAt: 'x' } });
    expect(statSync(fleetUsageCachePath()).mode & 0o777).toBe(0o600);
    expect(await readFleetUsageCache()).toEqual({ 'env-desk': { ...windows(1, 2, 3), fetchedAt: 'x' } });
  });
});
