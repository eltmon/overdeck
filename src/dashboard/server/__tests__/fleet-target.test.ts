/** PAN-4651 WI-8 (D-4651-10): target resolution and the placement service. */
import type { LoadSample } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { refuseFleetRequest } from '../routes/machines-fleet.js';
import { handleFleetPlacement } from '../routes/fleet-work.js';
import { readJsonResponse } from '../routes/machines-work.js';
import { type FleetTargetDeps, resolveTargetMachine } from '../services/fleet-target.js';
import { jsonResponse } from '../http-helpers.js';

const GIB = 2 ** 30;
const sample = (cpu: number, gib: number, agents: number, saturated = false): LoadSample => ({
  cpuPsiSomeAvg10: cpu, cpuSaturated: saturated, memAvailableBytes: gib * GIB, workingAgents: agents, sampledAt: '2026-11-01T12:00:00.000Z',
});

const link = (label: string, overrides: Partial<MachineLink> = {}) => ({ id: `link-${label}`, environmentId: `env-${label}`, label, revokedAt: null, ...overrides }) as MachineLink;

function deps(overrides: Partial<FleetTargetDeps> = {}, live: Record<string, { state: string; load?: LoadSample | null; tags?: string[]; placement?: 'auto' | 'on-request' }> = {}) {
  const selfLoad = vi.fn(async () => sample(30, 8, 3));
  const value: FleetTargetDeps = {
    self: async () => ({ environmentId: 'env-laptop', label: 'laptop' }),
    links: async () => [link('desk'), link('lab'), link('old', { revokedAt: '2026-10-01T00:00:00.000Z' })],
    status: ((linkId: string) => ({ state: 'offline', load: null, tags: [], placement: 'auto', ...live[linkId] })) as unknown as FleetTargetDeps['status'],
    selfLoad,
    selfProfile: () => ({ tags: ['linux'], placement: 'auto' }),
    selfProjectOrigins: async () => ['github.com/eltmon/overdeck'],
    linkProjectOrigins: () => ['github.com/eltmon/overdeck'],
    ...overrides,
  };
  return { value, selfLoad };
}

describe('resolveTargetMachine (D-4651-10)', () => {
  it("ac8: 'fly' answers 400 fly-unavailable", async () => {
    expect(await resolveTargetMachine('fly', null, [], deps().value)).toEqual({ ok: false, status: 400, body: { code: 'fly-unavailable', error: 'Fly (new VM) needs PAN-4652' } });
  });

  it('ac8: an offline label answers 503 machine-offline; an unknown or revoked one 404 unknown-machine', async () => {
    expect(await resolveTargetMachine('desk', null, [], deps().value)).toMatchObject({ ok: false, status: 503, body: { code: 'machine-offline' } });
    expect(await resolveTargetMachine('nope', null, [], deps().value)).toMatchObject({ ok: false, status: 404, body: { code: 'unknown-machine' } });
    expect(await resolveTargetMachine('old', null, [], deps().value)).toMatchObject({ ok: false, status: 404, body: { code: 'unknown-machine' } });
  });

  it('ac8: an explicit reserved, saturated label is honored, but needs are still checked', async () => {
    const live = { 'link-desk': { state: 'online', load: sample(99, 1, 9, true), tags: ['linux'], placement: 'on-request' as const } };
    expect(await resolveTargetMachine('DESK', null, [], deps({}, live).value)).toMatchObject({ ok: true, self: false, label: 'desk', reason: null });
    expect(await resolveTargetMachine('env-desk', null, ['gpu'], deps({}, live).value))
      .toMatchObject({ ok: false, status: 409, body: { code: 'needs-unmet', missing: ['gpu'] } });
  });

  it('undefined, this label and this id resolve to this machine', async () => {
    for (const machine of [undefined, 'laptop', 'env-laptop']) {
      expect(await resolveTargetMachine(machine, null, [], deps().value)).toEqual({ ok: true, self: true, environmentId: 'env-laptop', label: 'laptop', reason: null });
    }
    expect(await resolveTargetMachine(undefined, null, ['docker'], deps().value)).toMatchObject({ ok: false, status: 409, body: { code: 'needs-unmet' } });
  });

  it('ac8: auto uses cached link loads and a fresh self sample', async () => {
    const live = {
      'link-desk': { state: 'online', load: sample(2, 64, 0), tags: ['linux'] },
      'link-lab': { state: 'online', load: sample(1, 64, 0, true), tags: ['linux'] },
    };
    const d = deps({}, live);
    const target = await resolveTargetMachine('auto', 'github.com/eltmon/overdeck', [], d.value);
    expect(target).toMatchObject({ ok: true, self: false, label: 'desk', reason: 'Auto → desk (CPU pressure 2%, 64 GB free, 0 agents)' });
    expect(d.selfLoad).toHaveBeenCalledTimes(1);
  });

  it('auto with nothing that fits answers 409 no-machine-fits with the rejection line', async () => {
    const target = await resolveTargetMachine('auto', null, ['gpu'], deps().value);
    expect(target).toMatchObject({ ok: false, status: 409, body: { code: 'no-machine-fits', error: 'No machine fits: laptop: no gpu; desk: offline; lab: offline' } });
  });
});

describe('POST /api/fleet/placement (D-4651-10)', () => {
  it('answers the placement for a gitOrigin and needs', async () => {
    const answer = readJsonResponse(await handleFleetPlacement({ gitOrigin: null, needs: 'Linux' }, deps().value));
    expect(answer).toMatchObject({ status: 200, body: { ok: true, label: 'laptop', self: true } });
    expect(readJsonResponse(await handleFleetPlacement({ needs: ['bad tag'] }, deps().value)).status).toBe(400);
  });

  it('ac8: a channel caller gets 403', () => {
    const refused = refuseFleetRequest(true, () => jsonResponse({ ok: true }));
    expect(refused?.status).toBe(403);
    expect(refuseFleetRequest(false, () => null)).toBeNull();
  });
});
