/**
 * PAN-4652 WI-11: the Fly machine heartbeat and sweep — no client with zero
 * records (NFR-1), failures never read as refreshed, positive evidence only
 * for gone machines, the idle window under fake timers, and the unlinked
 * provisioning limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlyMachineRecord } from '../../../../src/lib/anywhere/fly/machine-store.js';
import { FlyApiError } from '../../../../src/lib/remote/fly-api.js';
import {
  _resetFlyMachineLoopsForTests,
  type FlyMachineLoopDeps,
  heartbeatFlyMachines,
  type LinkedConversationActivity,
  sweepFlyMachines,
} from '../../../../src/lib/remote/fly-machine-loops.js';

const ENV = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';
const MINUTE = 60_000;

function record(overrides: Partial<FlyMachineRecord> = {}): FlyMachineRecord {
  return {
    id: 'rec-1', linkId: 'link-1', environmentId: ENV, machineId: 'm1', machineName: 'overdeck-machine-1a2b3c4d',
    appName: 'overdeck-ws', region: 'iad', label: 'fly-m1', projectKey: null, docker: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function harness(records: FlyMachineRecord[], opts: { state?: string; getMachineError?: Error; conversations?: LinkedConversationActivity[]; idleMinutes?: number } = {}) {
  const api = {
    execCommand: vi.fn(async () => ({ stdout: '', stderr: '', exit_code: 0 })),
    getMachine: vi.fn(async () => {
      if (opts.getMachineError) throw opts.getMachineError;
      return { id: 'm1', name: 'overdeck-machine-1a2b3c4d', state: opts.state ?? 'started', region: 'iad' };
    }),
    destroyMachine: vi.fn(async () => undefined),
  };
  const state = { conversations: opts.conversations ?? [] };
  const deps = {
    listRecords: vi.fn(async () => records),
    api: vi.fn(async () => api),
    listConversations: () => state.conversations,
    idleMinutes: async () => opts.idleMinutes ?? 30,
    removeLink: vi.fn(async () => null),
    removeRecord: vi.fn(async () => null),
    activity: vi.fn(),
    now: () => Date.now(),
  } satisfies FlyMachineLoopDeps;
  return { api, deps, state };
}

const ended = (lastActivityAt: string): LinkedConversationActivity => ({ environmentId: ENV, releasedTo: null, status: 'ended', lastActivityAt });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  _resetFlyMachineLoopsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('heartbeatFlyMachines (PAN-4652 WI-11)', () => {
  it('constructs no client and returns [] with zero records', async () => {
    const { deps } = harness([]);
    expect(await heartbeatFlyMachines(deps)).toEqual([]);
    expect(await sweepFlyMachines(deps)).toEqual([]);
    expect(deps.api).not.toHaveBeenCalled();
  });

  it('writes the heartbeat by machine id and reports a failed exec as a failure', async () => {
    const { api, deps } = harness([record(), record({ id: 'rec-2', machineId: 'm2', label: 'fly-m2' }), record({ id: 'rec-3', machineId: 'm3', label: 'fly-m3' })]);
    api.execCommand
      .mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'read-only file system', exit_code: 1 })
      .mockRejectedValueOnce(new Error('Fly API error 503'));

    const lines = await heartbeatFlyMachines(deps);

    expect(api.execCommand).toHaveBeenCalledWith('overdeck-ws', 'm1', ['/bin/sh', '-c', 'mkdir -p /workspace/.pan && date -u +%FT%TZ > /workspace/.pan/host-heartbeat'], 30);
    expect(lines[0]).toBe('refreshed host heartbeat on fly-m1');
    expect(lines[1]).toMatch(/^failed to refresh host heartbeat on fly-m2: exit 1 read-only file system/);
    expect(lines[2]).toMatch(/^failed to refresh host heartbeat on fly-m3: Fly API error 503/);
  });
});

describe('sweepFlyMachines (PAN-4652 WI-11)', () => {
  it('removes a stopped machine: destroy, unlink and delete, once each', async () => {
    const { api, deps } = harness([record()], { state: 'stopped' });
    expect(await sweepFlyMachines(deps)).toEqual(['destroyed fly-m1: machine stopped']);
    expect(api.destroyMachine).toHaveBeenCalledTimes(1);
    expect(api.destroyMachine).toHaveBeenCalledWith('overdeck-ws', 'm1');
    expect(deps.removeLink).toHaveBeenCalledTimes(1);
    expect(deps.removeLink).toHaveBeenCalledWith('link-1');
    expect(deps.removeRecord).toHaveBeenCalledWith('rec-1');
    expect(deps.activity).toHaveBeenCalledTimes(1);
  });

  it('removes a machine the API no longer knows (404)', async () => {
    const { deps } = harness([record()], { getMachineError: new FlyApiError('not found', 404, '') });
    expect(await sweepFlyMachines(deps)).toEqual(['destroyed fly-m1: machine gone (404)']);
    expect(deps.removeRecord).toHaveBeenCalledTimes(1);
  });

  it('leaves everything alone on an API 500', async () => {
    const { api, deps } = harness([record()], { getMachineError: new FlyApiError('boom', 500, ''), conversations: [] });
    for (let i = 0; i < 40; i++) {
      expect(await sweepFlyMachines(deps)).toEqual([]);
      await vi.advanceTimersByTimeAsync(MINUTE);
    }
    expect(api.destroyMachine).not.toHaveBeenCalled();
    expect(deps.removeLink).not.toHaveBeenCalled();
    expect(deps.removeRecord).not.toHaveBeenCalled();
  });

  it('keeps an idle machine for 29 minutes and removes it at 30', async () => {
    const { deps } = harness([record()], { conversations: [ended('2026-11-01T10:00:00Z')] });
    expect(await sweepFlyMachines(deps)).toEqual([]);
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual([]);
    expect(deps.removeRecord).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual(['destroyed fly-m1: no active conversation for 30 min']);
  });

  it('an active row resets the idle clock', async () => {
    const { deps, state } = harness([record()], { conversations: [ended('2026-11-01T10:00:00Z')] });
    await sweepFlyMachines(deps);
    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    state.conversations = [{ environmentId: ENV, releasedTo: null, status: 'active', lastActivityAt: null }];
    expect(await sweepFlyMachines(deps)).toEqual([]);

    state.conversations = [ended('2026-11-01T10:00:00Z')];
    await sweepFlyMachines(deps);
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual([]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(await sweepFlyMachines(deps)).toHaveLength(1);
  });

  it('counts recent activity, a released row and another machine\'s rows correctly', async () => {
    const { deps, state } = harness([record()]);
    state.conversations = [ended(new Date(Date.now() - 5 * MINUTE).toISOString())];
    await sweepFlyMachines(deps);
    await vi.advanceTimersByTimeAsync(40 * MINUTE);
    state.conversations = [ended(new Date(Date.now() - 5 * MINUTE).toISOString())];
    expect(await sweepFlyMachines(deps)).toEqual([]);

    state.conversations = [
      { environmentId: ENV, releasedTo: 'env-home', status: 'active', lastActivityAt: null },
      { environmentId: 'other-env', releasedTo: null, status: 'active', lastActivityAt: null },
    ];
    await sweepFlyMachines(deps);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(await sweepFlyMachines(deps)).toHaveLength(1);
  });

  it('never removes for idleness when machine_idle_minutes is 0', async () => {
    const { deps } = harness([record()], { idleMinutes: 0 });
    for (let i = 0; i < 5; i++) {
      expect(await sweepFlyMachines(deps)).toEqual([]);
      await vi.advanceTimersByTimeAsync(60 * MINUTE);
    }
    expect(deps.removeRecord).not.toHaveBeenCalled();
  });

  it('removes a record provisioning never linked once it is 30 minutes old', async () => {
    const { api, deps } = harness([record({ linkId: null, environmentId: null })]);
    expect(await sweepFlyMachines(deps)).toEqual([]);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual(['destroyed fly-m1: provisioning never linked it']);
    expect(api.getMachine).not.toHaveBeenCalled();
    expect(deps.removeLink).not.toHaveBeenCalled();
    expect(deps.removeRecord).toHaveBeenCalledWith('rec-1');
  });

  it('keeps the link and record when the destroy fails, to retry next tick', async () => {
    const { api, deps } = harness([record()], { state: 'stopped' });
    api.destroyMachine.mockRejectedValueOnce(new FlyApiError('boom', 500, ''));
    expect((await sweepFlyMachines(deps))[0]).toMatch(/^could not destroy fly-m1 \(machine stopped\)/);
    expect(deps.removeLink).not.toHaveBeenCalled();
    expect(deps.removeRecord).not.toHaveBeenCalled();
  });
});
