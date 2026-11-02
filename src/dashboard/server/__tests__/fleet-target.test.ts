/** PAN-4651 WI-8 (D-4651-10): target resolution and the placement service. */
import type { LoadSample } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { refuseFleetRequest } from '../routes/machines-fleet.js';
import { handleFleetPlacement } from '../routes/fleet-work.js';
import { readJsonResponse } from '../routes/machines-work.js';
import { FLY_CONVERSATIONS_ONLY, type FleetTargetDeps, resolveTargetMachine } from '../services/fleet-target.js';
import { jsonResponse } from '../http-helpers.js';

const GIB = 2 ** 30;
const sample = (cpu: number, gib: number, agents: number, saturated = false): LoadSample => ({
  cpuPsiSomeAvg10: cpu, cpuSaturated: saturated, memAvailableBytes: gib * GIB, workingAgents: agents, sampledAt: '2026-11-01T12:00:00.000Z',
});

const link = (label: string, overrides: Partial<MachineLink> = {}) => ({ id: `link-${label}`, environmentId: `env-${label}`, label, revokedAt: null, ...overrides }) as MachineLink;

function deps(overrides: Partial<FleetTargetDeps> = {}, live: Record<string, { state: string; load?: LoadSample | null; tags?: string[]; placement?: 'auto' | 'on-request' }> = {}) {
  const selfLoad = vi.fn(async () => sample(30, 8, 3));
  const startFly = vi.fn(async () => ({ ok: true as const, self: false as const, link: link('fly-m1'), environmentId: 'env-fly-m1', label: 'fly-m1', reason: 'Fly (new VM) → fly-m1 (iad)' }));
  const autoFly = vi.fn(async () => false);
  const value: FleetTargetDeps = {
    self: async () => ({ environmentId: 'env-laptop', label: 'laptop' }),
    links: async () => [link('desk'), link('lab'), link('old', { revokedAt: '2026-10-01T00:00:00.000Z' })],
    status: ((linkId: string) => ({ state: 'offline', load: null, tags: [], placement: 'auto', ...live[linkId] })) as unknown as FleetTargetDeps['status'],
    selfLoad,
    selfProfile: () => ({ tags: ['linux'], placement: 'auto' }),
    selfProjectOrigins: async () => ['github.com/eltmon/overdeck'],
    linkProjectOrigins: () => ['github.com/eltmon/overdeck'],
    startFly,
    autoFly,
    ...overrides,
  };
  return { value, selfLoad, startFly, autoFly };
}

describe('resolveTargetMachine (D-4651-10)', () => {
  it('ac8: no spawn context answers 400 fly-unavailable and never calls startFly', async () => {
    const d = deps();
    expect(await resolveTargetMachine('fly', null, [], d.value)).toEqual({ ok: false, status: 400, body: { code: 'fly-unavailable', error: FLY_CONVERSATIONS_ONLY } });
    expect(d.startFly).not.toHaveBeenCalled();
  });

  it('ac8: a spawn context calls startFly with the spawn, gitOrigin and needs, and returns its target unchanged', async () => {
    const d = deps();
    const spawn = { projectKey: 'overdeck', mayCreate: true };
    const target = await resolveTargetMachine('FLY', 'github.com/eltmon/overdeck', ['docker'], d.value, spawn);
    expect(d.startFly).toHaveBeenCalledTimes(1);
    expect(d.startFly).toHaveBeenCalledWith({ projectKey: 'overdeck', mayCreate: true, gitOrigin: 'github.com/eltmon/overdeck', needs: ['docker'] });
    expect(target).toMatchObject({ ok: true, self: false, label: 'fly-m1' });
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

  describe('auto-fly fallback (PAN-4743 FR-6)', () => {
    const spawn = { projectKey: 'overdeck', mayCreate: true };

    it('ac1: nothing fits, a spawn, a github origin and autoFly true call startFly and prefix the reason', async () => {
      const d = deps({ autoFly: vi.fn(async () => true) });
      const target = await resolveTargetMachine('auto', 'github.com/eltmon/overdeck', ['docker'], d.value, spawn);
      expect(d.startFly).toHaveBeenCalledTimes(1);
      expect(d.startFly).toHaveBeenCalledWith({ projectKey: 'overdeck', mayCreate: true, gitOrigin: 'github.com/eltmon/overdeck', needs: ['docker'] });
      expect(target).toMatchObject({ ok: true, self: false, label: 'fly-m1' });
      expect((target as { reason: string }).reason).toMatch(/^Auto → fly-m1 \(new Fly machine\)\. No machine fits:/);
    });

    it('ac2: autoFly false, no spawn, an unsupported need or a null origin answer 409 and never call startFly', async () => {
      const dFalse = deps({ autoFly: vi.fn(async () => false) });
      expect(await resolveTargetMachine('auto', 'github.com/eltmon/overdeck', ['docker'], dFalse.value, spawn)).toMatchObject({ ok: false, status: 409, body: { code: 'no-machine-fits' } });
      expect(dFalse.startFly).not.toHaveBeenCalled();

      const dNoSpawn = deps({ autoFly: vi.fn(async () => true) });
      expect(await resolveTargetMachine('auto', 'github.com/eltmon/overdeck', ['docker'], dNoSpawn.value)).toMatchObject({ ok: false, status: 409, body: { code: 'no-machine-fits' } });
      expect(dNoSpawn.startFly).not.toHaveBeenCalled();

      const dGpu = deps({ autoFly: vi.fn(async () => true) });
      expect(await resolveTargetMachine('auto', 'github.com/eltmon/overdeck', ['gpu'], dGpu.value, spawn)).toMatchObject({ ok: false, status: 409, body: { code: 'no-machine-fits' } });
      expect(dGpu.startFly).not.toHaveBeenCalled();

      const dNullOrigin = deps({ autoFly: vi.fn(async () => true) });
      expect(await resolveTargetMachine('auto', null, ['docker'], dNullOrigin.value, spawn)).toMatchObject({ ok: false, status: 409, body: { code: 'no-machine-fits' } });
      expect(dNullOrigin.startFly).not.toHaveBeenCalled();
    });

    it('ac3: a fitting machine is returned and autoFly is never called', async () => {
      const live = { 'link-desk': { state: 'online', load: sample(2, 64, 0), tags: ['linux'] } };
      const d = deps({ autoFly: vi.fn(async () => true) }, live);
      const target = await resolveTargetMachine('auto', 'github.com/eltmon/overdeck', [], d.value, spawn);
      expect(target).toMatchObject({ ok: true, self: false, label: 'desk' });
      expect(d.autoFly).not.toHaveBeenCalled();
      expect(d.startFly).not.toHaveBeenCalled();
    });
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

describe('GET /api/fleet/machines (PAN-4651 D-4651-18)', () => {
  it('lists this machine then visible links with state, load and tags only', async () => {
    const { buildFleetMachines } = await import('../routes/fleet-work.js');
    const machines = await buildFleetMachines({
      self: async () => ({ environmentId: 'env-laptop', label: 'laptop' }),
      selfLoad: () => sample(3, 8, 1),
      selfTags: () => ['linux'],
      links: async () => [link('desk', { routes: [{ url: 'tcp://10.0.0.2:3011' }] } as never), link('hid', { hidden: true }), link('old', { revokedAt: 'x' })],
      status: (() => ({ state: 'online', load: null, tags: ['docker'] })) as never,
    });
    expect(machines).toEqual([
      { environmentId: 'env-laptop', label: 'laptop', thisMachine: true, state: 'online', load: sample(3, 8, 1), tags: ['linux'] },
      { environmentId: 'env-desk', label: 'desk', thisMachine: false, state: 'online', load: null, tags: ['docker'] },
    ]);
    expect(JSON.stringify(machines)).not.toContain('10.0.0.2');
  });
});
