/**
 * PAN-4652 WI-11: the Fly machine heartbeat and sweep — no client with zero
 * records (NFR-1), failures never read as refreshed, positive evidence only
 * for gone machines, the idle window under fake timers, and the unlinked
 * provisioning limit. PAN-4296 WI-7: the Codex sign-in sync — no client
 * without a Codex-ready record, push, pull, skip on an indeterminate read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlyMachineRecord } from '../../../../src/lib/anywhere/fly/machine-store.js';
import { FlyApiError, flyTokenRejectedMessage } from '../../../../src/lib/remote/fly-api.js';
import {
  _resetFlyMachineLoopsForTests,
  destroyAndForgetFlyMachine,
  type FlyCodexSyncDeps,
  type FlyMachineLoopDeps,
  heartbeatFlyMachines,
  type LinkedConversationActivity,
  sweepFlyMachines,
  syncFlyCodexAuth,
} from '../../../../src/lib/remote/fly-machine-loops.js';

const ENV = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';
const MINUTE = 60_000;

function record(overrides: Partial<FlyMachineRecord> = {}): FlyMachineRecord {
  return {
    id: 'rec-1', linkId: 'link-1', environmentId: ENV, machineId: 'm1', machineName: 'overdeck-machine-1a2b3c4d',
    appName: 'overdeck-ws', region: 'iad', label: 'fly-m1', projectKey: null, docker: true, codexAuthPath: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function harness(records: FlyMachineRecord[], opts: { state?: string; getMachineError?: Error; conversations?: LinkedConversationActivity[]; idleMinutes?: number; busyEnvironments?: string[] } = {}) {
  const api = {
    execCommand: vi.fn(async () => ({ stdout: '', stderr: '', exit_code: 0 })),
    getMachine: vi.fn(async () => {
      if (opts.getMachineError) throw opts.getMachineError;
      return { id: 'm1', name: 'overdeck-machine-1a2b3c4d', state: opts.state ?? 'started', region: 'iad' };
    }),
    destroyMachine: vi.fn(async () => undefined),
  };
  const state = { conversations: opts.conversations ?? [], busyEnvironments: opts.busyEnvironments ?? [] };
  const deps = {
    listRecords: vi.fn(async () => records),
    api: vi.fn(async () => api),
    listConversations: () => state.conversations,
    idleMinutes: async () => opts.idleMinutes ?? 30,
    removeLink: vi.fn(async () => null),
    removeRecord: vi.fn(async () => null),
    activity: vi.fn(),
    now: () => Date.now(),
    activeLinkedAgentEnvironmentIds: () => new Set(state.busyEnvironments),
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

  it('prints Fly token rejected for a 403 (PAN-4748)', async () => {
    const { api, deps } = harness([record()]);
    const error = new FlyApiError('Fly API error 403', 403, '{"error":"unauthorized"}');
    api.execCommand.mockRejectedValueOnce(error);

    const lines = await heartbeatFlyMachines(deps);

    expect(lines).toEqual([`failed to refresh host heartbeat on fly-m1: ${flyTokenRejectedMessage(error)}`]);
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

  it('keeps the record and prints could not check … Fly token rejected on a 403 from getMachine (PAN-4748)', async () => {
    const error = new FlyApiError('Fly API error 403', 403, '{"error":"unauthorized"}');
    const { api, deps } = harness([record()], { getMachineError: error });

    const lines = await sweepFlyMachines(deps);

    expect(lines).toEqual([`could not check fly-m1: ${flyTokenRejectedMessage(error)}`]);
    expect(api.destroyMachine).not.toHaveBeenCalled();
    expect(deps.removeLink).not.toHaveBeenCalled();
    expect(deps.removeRecord).not.toHaveBeenCalled();
  });
});

describe('sweepFlyMachines with a linked work agent (PAN-4734 WI-4)', () => {
  it('keeps the machine of an active linked work agent past the idle window', async () => {
    const { api, deps } = harness([record()], { conversations: [ended('2026-11-01T10:00:00Z')], busyEnvironments: [ENV] });
    expect(await sweepFlyMachines(deps)).toEqual([]);
    await vi.advanceTimersByTimeAsync(31 * MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual([]);
    expect(api.destroyMachine).not.toHaveBeenCalled();
    expect(deps.removeRecord).not.toHaveBeenCalled();
  });

  it('still removes a stopped machine that hosts an active linked work agent', async () => {
    const { deps } = harness([record()], { state: 'stopped', busyEnvironments: [ENV] });
    expect(await sweepFlyMachines(deps)).toEqual(['destroyed fly-m1: machine stopped']);
    expect(deps.removeRecord).toHaveBeenCalledWith('rec-1');
  });

  it('applies the idle rule again once the agent is no longer active', async () => {
    const { deps, state } = harness([record()], { conversations: [ended('2026-11-01T10:00:00Z')], busyEnvironments: [ENV] });
    await vi.advanceTimersByTimeAsync(40 * MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual([]);

    state.busyEnvironments = [];
    expect(await sweepFlyMachines(deps)).toEqual([]);
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual([]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(await sweepFlyMachines(deps)).toEqual(['destroyed fly-m1: no active conversation for 30 min']);
  });
});

describe('destroyAndForgetFlyMachine (PAN-4734 WI-4)', () => {
  it('destroys, unlinks and forgets the record with one activity entry', async () => {
    const { api, deps } = harness([]);
    expect(await destroyAndForgetFlyMachine(record(), 'work agent handed to review', deps))
      .toEqual({ destroyed: true, line: 'destroyed fly-m1: work agent handed to review' });
    expect(api.destroyMachine).toHaveBeenCalledWith('overdeck-ws', 'm1');
    expect(deps.removeLink).toHaveBeenCalledWith('link-1');
    expect(deps.removeRecord).toHaveBeenCalledWith('rec-1');
    expect(deps.activity).toHaveBeenCalledTimes(1);
  });

  it('counts a machine the API no longer knows (404) as destroyed', async () => {
    const { api, deps } = harness([]);
    api.destroyMachine.mockRejectedValueOnce(new FlyApiError('not found', 404, ''));
    expect((await destroyAndForgetFlyMachine(record(), 'work agent handed to review', deps)).destroyed).toBe(true);
    expect(deps.removeRecord).toHaveBeenCalledWith('rec-1');
  });

  it('keeps the link and record when the destroy fails', async () => {
    const { api, deps } = harness([]);
    api.destroyMachine.mockRejectedValueOnce(new FlyApiError('boom', 500, ''));
    const result = await destroyAndForgetFlyMachine(record(), 'work agent handed to review', deps);
    expect(result.destroyed).toBe(false);
    expect(result.line).toMatch(/^could not destroy fly-m1 \(work agent handed to review\)/);
    expect(deps.removeLink).not.toHaveBeenCalled();
    expect(deps.removeRecord).not.toHaveBeenCalled();
  });
});

describe('syncFlyCodexAuth (PAN-4296 WI-7)', () => {
  const PATH = '/.codex/auth.json';
  const signIn = (refresh: string, lastRefresh: string) => JSON.stringify({
    tokens: { access_token: 'a', id_token: 'i', refresh_token: refresh, account_id: 'acct-1' },
    last_refresh: lastRefresh,
  });
  const HOME = signIn('rt-home', '2026-11-01T10:00:00.000Z');
  const NEWER_VM = signIn('rt-vm', '2026-11-01T11:00:00.000Z');
  const ready = (overrides: Partial<FlyMachineRecord> = {}) => record({ codexAuthPath: PATH, ...overrides });

  function sync(records: FlyMachineRecord[], vmRead: { stdout: string; exit_code: number } | Error, homeAuth: string | null = HOME) {
    const execCommand = vi.fn(async (_app: string, _id: string, command: string[]) => {
      const script = command[2]!;
      if (script.startsWith('if [ -f')) {
        if (vmRead instanceof Error) throw vmRead;
        return { stdout: vmRead.stdout, stderr: '', exit_code: vmRead.exit_code };
      }
      return { stdout: '', stderr: '', exit_code: 0 };
    });
    const deps = {
      listRecords: vi.fn(async () => records),
      api: vi.fn(async () => ({ execCommand })),
      readHomeAuth: vi.fn(async () => homeAuth),
      writeHomeAuth: vi.fn(async () => undefined),
      activity: vi.fn(),
    } satisfies FlyCodexSyncDeps;
    const scripts = () => execCommand.mock.calls.map((call) => call[2][2]!);
    return { deps, execCommand, scripts };
  }

  it('makes no Fly API call without a Codex-ready record', async () => {
    const { deps } = sync([record(), ready({ id: 'rec-2', linkId: null })], { stdout: HOME, exit_code: 0 });
    expect(await syncFlyCodexAuth(deps)).toEqual([]);
    expect(deps.api).not.toHaveBeenCalled();
    expect(deps.readHomeAuth).not.toHaveBeenCalled();
  });

  it('skips a record without codexAuthPath and pushes to a VM with no sign-in', async () => {
    const { deps, scripts } = sync([record({ id: 'rec-0', label: 'fly-m0' }), ready()], { stdout: '__MISSING__', exit_code: 0 });
    expect(await syncFlyCodexAuth(deps)).toEqual(['Codex sign-in copied to fly-m1']);
    expect(scripts()).toHaveLength(2);
    expect(scripts()[1]).toContain(`printf %s '${Buffer.from(HOME).toString('base64')}' | base64 -d`);
    expect(deps.writeHomeAuth).not.toHaveBeenCalled();
  });

  it('copies a newer same-account VM refresh home and pushes nothing', async () => {
    const { deps, scripts } = sync([ready()], { stdout: NEWER_VM, exit_code: 0 });
    expect(await syncFlyCodexAuth(deps)).toEqual(['Codex sign-in refreshed on fly-m1 copied home']);
    expect(deps.writeHomeAuth).toHaveBeenCalledWith(NEWER_VM);
    expect(scripts()).toHaveLength(1);
    expect(deps.activity).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(deps.activity.mock.calls)).not.toContain('rt-vm');
  });

  it('rereads home before a pull and skips it when home signed in again during the pass', async () => {
    const { deps, scripts } = sync([ready()], { stdout: NEWER_VM, exit_code: 0 });
    const relogin = signIn('rt-relogin', '2026-11-01T12:00:00.000Z');
    deps.readHomeAuth.mockResolvedValueOnce(HOME).mockResolvedValueOnce(relogin);
    expect(await syncFlyCodexAuth(deps)).toEqual(["Codex sign-in sync skipped on fly-m1: this machine's sign-in changed during the pass"]);
    expect(deps.readHomeAuth).toHaveBeenCalledTimes(2);
    expect(deps.writeHomeAuth).not.toHaveBeenCalled();
    expect(deps.activity).not.toHaveBeenCalled();
    expect(scripts()).toHaveLength(1);
  });

  it('compares a later machine against the pulled sign-in, not the stale home copy', async () => {
    const { deps, scripts } = sync([ready(), ready({ id: 'rec-2', machineId: 'm2', label: 'fly-m2' })], { stdout: NEWER_VM, exit_code: 0 });
    expect(await syncFlyCodexAuth(deps)).toEqual(['Codex sign-in refreshed on fly-m1 copied home']);
    expect(deps.writeHomeAuth).toHaveBeenCalledTimes(1);
    expect(scripts()).toHaveLength(2);
  });

  it('neither pushes nor writes when the read exits non-zero or throws', async () => {
    for (const vmRead of [{ stdout: '', exit_code: 1 }, new Error('Fly API error 429')]) {
      const { deps, scripts } = sync([ready()], vmRead);
      expect(await syncFlyCodexAuth(deps)).toEqual(['Codex sign-in sync skipped on fly-m1: the Fly machine did not answer']);
      expect(scripts()).toHaveLength(1);
      expect(deps.writeHomeAuth).not.toHaveBeenCalled();
    }
  });

  it('prints Fly token rejected instead of did not answer on a 403 (PAN-4748)', async () => {
    const error = new FlyApiError('Fly API error 403', 403, '{"error":"unauthorized"}');
    const { deps } = sync([ready()], error);
    expect(await syncFlyCodexAuth(deps)).toEqual([`Codex sign-in sync skipped on fly-m1: ${flyTokenRejectedMessage(error)}`]);
    expect(deps.writeHomeAuth).not.toHaveBeenCalled();
  });

  it('runs nothing beyond the read when both sides hold the same sign-in', async () => {
    const { deps, scripts } = sync([ready()], { stdout: `${JSON.stringify(JSON.parse(HOME), null, 2)}\n`, exit_code: 0 });
    expect(await syncFlyCodexAuth(deps)).toEqual([]);
    expect(scripts()).toHaveLength(1);
    expect(deps.writeHomeAuth).not.toHaveBeenCalled();
  });

  it('reports a failed push as a failure, never as copied', async () => {
    const { deps, execCommand } = sync([ready()], { stdout: '__MISSING__', exit_code: 0 });
    execCommand.mockImplementation(async (_app: string, _id: string, command: string[]) =>
      (command[2]!.startsWith('if [ -f') ? { stdout: '__MISSING__', stderr: '', exit_code: 0 } : { stdout: '', stderr: HOME, exit_code: 1 }));
    const lines = await syncFlyCodexAuth(deps);
    expect(lines).toEqual([`failed to copy the Codex sign-in to fly-m1: Could not write ${PATH} on the Fly machine (exit 1)`]);
  });
});
