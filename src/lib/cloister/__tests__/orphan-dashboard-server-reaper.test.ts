/**
 * PAN-1625 — safety coverage for the deacon's orphan dashboard-server reaper.
 * The kill set must NEVER include the live server, the port owner, a freshly
 * spawned server, or a container process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../database/app-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntrySync: vi.fn() }));
vi.mock('../../persistent-logger.js', () => ({ logDeaconEventSync: vi.fn() }));

import {
  selectOrphanServerPids,
  parseDashboardServerProcs,
  reapOrphanedDashboardServers,
} from '../orphan-dashboard-server-reaper.js';
import { isDeaconGloballyPaused } from '../../database/app-settings.js';

describe('selectOrphanServerPids (PAN-1625)', () => {
  const base = { selfPid: 100, portOwnerPid: 100, minAgeSeconds: 120 };

  it('never selects the deacon’s own process', () => {
    const pids = selectOrphanServerPids({
      ...base,
      servers: [{ pid: 100, ageSeconds: 9999 }],
    });
    expect(pids).toEqual([]);
  });

  it('never selects the port owner', () => {
    const pids = selectOrphanServerPids({
      ...base,
      selfPid: 100,
      portOwnerPid: 200,
      servers: [{ pid: 200, ageSeconds: 9999 }],
    });
    expect(pids).toEqual([]);
  });

  it('never selects a just-spawned server (younger than minAge)', () => {
    const pids = selectOrphanServerPids({
      ...base,
      servers: [{ pid: 300, ageSeconds: 30 }],
    });
    expect(pids).toEqual([]);
  });

  it('selects a genuine orphan (old, not self, not port owner)', () => {
    const pids = selectOrphanServerPids({
      ...base,
      servers: [
        { pid: 100, ageSeconds: 9999 }, // self
        { pid: 300, ageSeconds: 9999 }, // orphan
        { pid: 400, ageSeconds: 10 },   // too young
      ],
    });
    expect(pids).toEqual([300]);
  });

  it('still excludes self + young when the port owner is unknown', () => {
    const pids = selectOrphanServerPids({
      selfPid: 100,
      portOwnerPid: null,
      minAgeSeconds: 120,
      servers: [
        { pid: 100, ageSeconds: 9999 },
        { pid: 500, ageSeconds: 9999 },
      ],
    });
    expect(pids).toEqual([500]);
  });
});

describe('parseDashboardServerProcs (PAN-1625)', () => {
  it('matches a real node dist/dashboard/server.js invocation', () => {
    const out = '  4145437   305 /home/u/.nvm/versions/node/v22/bin/node /home/u/proj/dist/dashboard/server.js';
    expect(parseDashboardServerProcs(out)).toEqual([{ pid: 4145437, ageSeconds: 305 }]);
  });

  it('ignores a shell command that merely mentions the path', () => {
    const out = "  28432   0 /bin/bash -c 'grep dist/dashboard/server.js'";
    expect(parseDashboardServerProcs(out)).toEqual([]);
  });

  it('ignores vite / npm and other non-node-server lines', () => {
    const out = [
      '  111  10 npm exec vite --host 0.0.0.0 --port 3010',
      '  222  20 /usr/bin/node /home/u/proj/dist/supervisor/server.js',
    ].join('\n');
    expect(parseDashboardServerProcs(out)).toEqual([]);
  });
});

describe('reapOrphanedDashboardServers (PAN-1625)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isDeaconGloballyPaused).mockReturnValue(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('no-ops when the deacon is globally paused', async () => {
    vi.mocked(isDeaconGloballyPaused).mockReturnValue(true);
    const kill = vi.fn();
    const actions = await reapOrphanedDashboardServers({
      selfPid: 100,
      apiPort: 3011,
      listServers: async () => [{ pid: 300, ageSeconds: 9999 }],
      resolvePortOwner: async () => 100,
      isContainerProcess: async () => false,
      kill,
    });
    expect(actions).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  it('excludes a container process even if it is otherwise an orphan', async () => {
    const kill = vi.fn();
    const promise = reapOrphanedDashboardServers({
      selfPid: 100,
      apiPort: 3011,
      listServers: async () => [{ pid: 700, ageSeconds: 9999 }],
      resolvePortOwner: async () => 100,
      isContainerProcess: async (pid) => pid === 700, // workspace-container server
      kill,
      graceMs: 10,
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  it('SIGTERMs an orphan, then SIGKILLs it if it survives the grace window', async () => {
    const killed: Array<[number, string | number]> = [];
    const kill = vi.fn((pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) return; // liveness check: pid still alive
      killed.push([pid, signal]);
    });
    const promise = reapOrphanedDashboardServers({
      selfPid: 100,
      apiPort: 3011,
      listServers: async () => [
        { pid: 100, ageSeconds: 9999 }, // self — must be spared
        { pid: 800, ageSeconds: 9999 }, // orphan
      ],
      resolvePortOwner: async () => 100,
      isContainerProcess: async () => false,
      kill,
      graceMs: 10,
    });
    await vi.runAllTimersAsync();
    const actions = await promise;

    expect(killed).toContainEqual([800, 'SIGTERM']);
    expect(killed).toContainEqual([800, 'SIGKILL']);
    // self pid must never receive a terminating signal
    expect(killed.some(([pid]) => pid === 100)).toBe(false);
    expect(actions).toEqual(['Reaped orphan dashboard server pid 800']);
  });

  it('does not SIGKILL an orphan that already died on SIGTERM', async () => {
    const kill = vi.fn((pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) throw new Error('ESRCH'); // liveness check: already dead
    });
    const promise = reapOrphanedDashboardServers({
      selfPid: 100,
      apiPort: 3011,
      listServers: async () => [{ pid: 900, ageSeconds: 9999 }],
      resolvePortOwner: async () => 100,
      isContainerProcess: async () => false,
      kill,
      graceMs: 10,
    });
    await vi.runAllTimersAsync();
    const actions = await promise;

    expect(kill).toHaveBeenCalledWith(900, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(900, 'SIGKILL');
    expect(actions).toEqual(['Reaped orphan dashboard server pid 900']);
  });
});
