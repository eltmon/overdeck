/** PAN-4743 WI-1: the Fly target door refuses before creating anything, then turns addFlyMachine's result into a FleetTarget. */
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { FlyMachineError } from '../../../lib/anywhere/fly/provision.js';
import type { AddFlyMachineResult } from '../services/fly-machine-service.js';
import { type FlyTargetDeps, type FlyTargetRequest, startFlyTarget } from '../services/fleet-fly-target.js';
import { MachineLinkError } from '../services/machine-link-service.js';

const LINK = { id: 'link-m1', environmentId: 'env-m1', label: 'fly-m1' } as MachineLink;

function request(overrides: Partial<FlyTargetRequest> = {}): FlyTargetRequest {
  return {
    projectKey: 'overdeck',
    mayCreate: true,
    gitOrigin: 'github.com/eltmon/overdeck',
    needs: [],
    ...overrides,
  };
}

function result(overrides: Partial<AddFlyMachineResult['record']> = {}): AddFlyMachineResult {
  return {
    link: LINK as never,
    record: {
      id: 'rec-1',
      linkId: LINK.id,
      environmentId: LINK.environmentId,
      machineId: 'm1',
      machineName: 'overdeck-machine-m1',
      appName: 'overdeck-ws',
      region: 'iad',
      label: 'fly-m1',
      projectKey: 'overdeck',
      docker: true,
      codexAuthPath: null,
      createdAt: '2026-11-02T00:00:00.000Z',
      ...overrides,
    },
  };
}

function deps(overrides: Partial<FlyTargetDeps> = {}) {
  const value: FlyTargetDeps = {
    addFly: vi.fn(async () => result()),
    links: vi.fn(async () => [LINK]),
    unlink: vi.fn(async () => undefined),
    activity: vi.fn(),
    warn: vi.fn(),
    ...overrides,
  };
  return value;
}

describe('startFlyTarget (PAN-4743 WI-1)', () => {
  it('ac1: refuses a caller without an admin credential and never calls addFly', async () => {
    const d = deps();
    expect(await startFlyTarget(request({ mayCreate: false }), d)).toEqual({ ok: false, status: 403, body: { code: 'fly-needs-admin', error: 'Starting a Fly machine needs an admin credential.' } });
    expect(d.addFly).not.toHaveBeenCalled();
  });

  it('ac2: refuses no project, no git origin, a non-GitHub origin and an unsupported need, never calling addFly', async () => {
    const d = deps();
    expect(await startFlyTarget(request({ projectKey: null }), d)).toMatchObject({ ok: false, status: 400, body: { code: 'fly-needs-project' } });
    expect(await startFlyTarget(request({ gitOrigin: null }), d)).toMatchObject({ ok: false, status: 409, body: { code: 'project-has-no-origin' } });
    expect(await startFlyTarget(request({ gitOrigin: 'gitlab.com/eltmon/overdeck' }), d)).toMatchObject({ ok: false, status: 409, body: { code: 'project-not-on-github' } });
    expect(await startFlyTarget(request({ needs: ['gpu'] }), d)).toMatchObject({ ok: false, status: 409, body: { code: 'needs-unmet', missing: ['gpu'] } });
    expect(d.addFly).not.toHaveBeenCalled();
  });

  it('ac3: maps a FlyMachineError from addFly to its status and code', async () => {
    const d = deps({ addFly: vi.fn(async () => { throw new FlyMachineError('cap-reached', 'The remote spend cap is reached.'); }) });
    expect(await startFlyTarget(request(), d)).toEqual({ ok: false, status: 409, body: { code: 'cap-reached', error: 'The remote spend cap is reached.' } });
  });

  it('ac3b: maps a MachineLinkError from addFly to its status and code', async () => {
    const d = deps({ addFly: vi.fn(async () => { throw new MachineLinkError('unreachable', 'Could not reach the Fly machine.'); }) });
    expect(await startFlyTarget(request(), d)).toEqual({ ok: false, status: 502, body: { code: 'unreachable', error: 'Could not reach the Fly machine.' } });
  });

  it('ac4: on success returns a self:false target with the stored link, label, reason and one activity entry', async () => {
    const d = deps();
    const target = await startFlyTarget(request(), d);
    expect(target).toMatchObject({ ok: true, self: false, link: LINK, environmentId: 'env-m1', label: 'fly-m1', reason: 'Fly (new VM) → fly-m1 (iad)' });
    expect(typeof (target as { discard?: unknown }).discard).toBe('function');
    expect(d.activity).toHaveBeenCalledTimes(1);
  });

  it('ac5: needs docker with record.docker false discards the machine and answers needs-unmet', async () => {
    const d = deps({ addFly: vi.fn(async () => result({ docker: false })) });
    const target = await startFlyTarget(request({ needs: ['docker'] }), d);
    expect(target).toEqual({ ok: false, status: 409, body: { code: 'needs-unmet', error: 'fly-m1 has no docker', missing: ['docker'] } });
    expect(d.unlink).toHaveBeenCalledTimes(1);
    expect(d.unlink).toHaveBeenCalledWith(LINK.id);
    expect(d.activity).not.toHaveBeenCalled();
  });

  it('ac5b: discard() calls unlink(link.id); an unlink that throws is warned, not rethrown', async () => {
    const d = deps({ unlink: vi.fn(async () => { throw new Error('peer gone'); }) });
    const target = await startFlyTarget(request(), d);
    expect(target.ok).toBe(true);
    await expect((target as { discard: () => Promise<void> }).discard()).resolves.toBeUndefined();
    expect(d.unlink).toHaveBeenCalledWith(LINK.id);
    expect(d.warn).toHaveBeenCalledWith('could not discard fly-m1: peer gone');
  });

  it('answers 500 fly-failed when the new link disappeared', async () => {
    const d = deps({ links: vi.fn(async () => []) });
    expect(await startFlyTarget(request(), d)).toEqual({ ok: false, status: 500, body: { code: 'fly-failed', error: 'The new Fly machine link disappeared' } });
  });
});
