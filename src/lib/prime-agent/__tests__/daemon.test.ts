import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { primeAgentDaemonSocketPath } from '../../runtimes/storage/prime-agent.js';
import {
  findPrimeAgentSupervisor,
  listOrphanedPrimeAgentDaemons,
  reapPrimeAgentDaemon,
  type PrimeAgentStatusRunner,
} from '../daemon.js';

const HOME = '/home/op/.overdeck';
const DEFAULT_SOCKET = '/tmp/prime-agent-1000/daemon.sock';

function statusJson(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify(entries);
}

/** A status runner whose listing is read from `current` on every call. */
function liveStatus(current: { entries: Array<Record<string, unknown>> }): PrimeAgentStatusRunner {
  return vi.fn(async () => statusJson(current.entries));
}

describe('Prime Agent daemon reaper (PAN-3668 WI-10, D3)', () => {
  const agentSocket = primeAgentDaemonSocketPath('agent-pan-1', HOME);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches the supervisor by exact socket path', async () => {
    const run = liveStatus({ entries: [
      { socketPath: DEFAULT_SOCKET, pid: 100, sessionCount: 2, isDefault: true },
      { socketPath: agentSocket, pid: 200, sessionCount: 1 },
      { socketPath: '/tmp/prime-agent-forkserver-x/control.sock', pid: 300, status: 'stale' },
    ] });
    await expect(findPrimeAgentSupervisor('prime-agent', agentSocket, run)).resolves.toEqual({ pid: 200, sessionCount: 1 });
    await expect(findPrimeAgentSupervisor('prime-agent', `${agentSocket}.other`, run)).resolves.toBeNull();
  });

  it("returns 'none' and signals nothing when no supervisor is listed", async () => {
    const killGroup = vi.fn();
    const result = await reapPrimeAgentDaemon('agent-pan-1', {
      binary: 'prime-agent',
      home: HOME,
      run: liveStatus({ entries: [{ socketPath: DEFAULT_SOCKET, pid: 100, sessionCount: 3, isDefault: true }] }),
      killGroup,
    });
    expect(result).toBe('none');
    expect(killGroup).not.toHaveBeenCalled();
  });

  it("returns 'terminated' when the entry disappears after SIGTERM to the process group", async () => {
    const current = { entries: [
      { socketPath: DEFAULT_SOCKET, pid: 100, sessionCount: 3, isDefault: true },
      { socketPath: agentSocket, pid: 4242, sessionCount: 1 },
    ] };
    const killGroup = vi.fn((pid: number, signal: NodeJS.Signals) => {
      if (signal === 'SIGTERM') current.entries = current.entries.filter((entry) => entry.pid !== pid);
    });

    const pending = reapPrimeAgentDaemon('agent-pan-1', { binary: 'prime-agent', home: HOME, run: liveStatus(current), killGroup });
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toBe('terminated');
    expect(killGroup.mock.calls).toEqual([[4242, 'SIGTERM']]);
  });

  it("escalates to SIGKILL after the 5 s grace when the entry persists, and returns 'killed'", async () => {
    const killGroup = vi.fn();
    const run = liveStatus({ entries: [{ socketPath: agentSocket, pid: 4242, sessionCount: 1 }] });

    let settled = false;
    const pending = reapPrimeAgentDaemon('agent-pan-1', { binary: 'prime-agent', home: HOME, run, killGroup }).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_750);
    expect(settled).toBe(false);
    expect(killGroup.mock.calls).toEqual([[4242, 'SIGTERM']]);

    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBe('killed');
    expect(killGroup.mock.calls).toEqual([[4242, 'SIGTERM'], [4242, 'SIGKILL']]);
  });

  it('never signals the default socket supervisor', async () => {
    const killGroup = vi.fn();
    const run = liveStatus({ entries: [{ socketPath: DEFAULT_SOCKET, pid: 100, sessionCount: 3, isDefault: true }] });
    await reapPrimeAgentDaemon('agent-pan-1', { binary: 'prime-agent', home: HOME, run, killGroup });
    const orphans = await listOrphanedPrimeAgentDaemons({ binary: 'prime-agent', home: HOME, run, listOwnerIds: async () => [], isOwnerAlive: async () => false });
    expect(killGroup).not.toHaveBeenCalled();
    expect(orphans).toEqual([]);
  });
});

describe('listOrphanedPrimeAgentDaemons (PAN-3668 WI-10, FR-4)', () => {
  it('lists Overdeck-owned supervisors whose owner is missing or dead, and skips live owners', async () => {
    const live = primeAgentDaemonSocketPath('agent-live', HOME);
    const dead = primeAgentDaemonSocketPath('agent-dead', HOME);
    const unowned = primeAgentDaemonSocketPath('agent-gone', HOME);
    const run = liveStatus({ entries: [
      { socketPath: DEFAULT_SOCKET, pid: 100, sessionCount: 3, isDefault: true },
      { socketPath: live, pid: 201, sessionCount: 1 },
      { socketPath: dead, pid: 202, sessionCount: 0 },
      { socketPath: unowned, pid: 203, sessionCount: 0 },
    ] });

    const orphans = await listOrphanedPrimeAgentDaemons({
      binary: 'prime-agent',
      home: HOME,
      run,
      listOwnerIds: async () => ['agent-live', 'agent-dead', 'conv-unrelated'],
      isOwnerAlive: async (ownerId) => ownerId === 'agent-live',
    });

    expect(orphans).toEqual([
      { socketPath: dead, pid: 202 },
      { socketPath: unowned, pid: 203 },
    ]);
  });
});
