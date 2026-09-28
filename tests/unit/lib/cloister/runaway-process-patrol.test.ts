import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sideEffects = vi.hoisted(() => ({
  stopAgent: vi.fn(),
  setAgentPaused: vi.fn(),
  deliverAgentMessage: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/termination.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/agents/termination.js')>(),
  stopAgent: sideEffects.stopAgent,
}));
vi.mock('../../../../src/lib/agents/agent-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/agents/agent-state.js')>(),
  setAgentPaused: sideEffects.setAgentPaused,
}));
vi.mock('../../../../src/lib/agents/delivery.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/agents/delivery.js')>(),
  deliverAgentMessage: sideEffects.deliverAgentMessage,
}));

import {
  createRunawayPatrol,
  parseProcStat,
  RUNAWAY_PATROL_INTERVAL_MS,
  type ProcStat,
  type RunawayFeedEntry,
  type RunawayPatrolDeps,
} from '../../../../src/lib/cloister/runaway-process-patrol.js';

/**
 * PAN-4311 AC-4/AC-5: a synthetic host driven in 30 s fake-timer steps. An
 * orphaned `yes` (parent is the user manager, outside the Overdeck cgroups)
 * burns one core; it started 30 minutes before the patrol's first tick.
 */

const CLK_TCK = 100;
const MIN = 60_000;
const BOOT_UPTIME_S = 100_000;

interface SyntheticProc {
  pid: number;
  ppid: number;
  pgid: number;
  comm: string;
  cmdline: string;
  /** Wall-clock ms the process started. */
  startedAtMs: number;
  /** Cores burned since start. */
  cores: number;
  env?: Record<string, string>;
}

function host(t0: number) {
  const procs = new Map<number, SyntheticProc>();
  const add = (proc: SyntheticProc) => procs.set(proc.pid, proc);
  add({ pid: 100, ppid: 1917, pgid: 100, comm: 'herdr', cmdline: 'herdr server', startedAtMs: t0 - 600 * MIN, cores: 0.05 });
  add({ pid: 200, ppid: 100, pgid: 200, comm: 'bash', cmdline: 'bash', startedAtMs: t0 - 120 * MIN, cores: 0, env: { OVERDECK_AGENT_ID: 'agent-pan-9' } });
  add({ pid: 300, ppid: 200, pgid: 300, comm: 'claude', cmdline: 'claude', startedAtMs: t0 - 120 * MIN, cores: 1, env: { OVERDECK_AGENT_ID: 'agent-pan-9' } });
  add({ pid: 500, ppid: 1917, pgid: 500, comm: 'yes', cmdline: 'yes', startedAtMs: t0 - 30 * MIN, cores: 1, env: { OVERDECK_AGENT_ID: 'agent-pan-9' } });

  // The kernel's boot clock: uptime at t0 is BOOT_UPTIME_S.
  const uptimeAt = (ms: number) => BOOT_UPTIME_S + (ms - t0) / 1000;
  const starttimeOf = (proc: SyntheticProc) => Math.round(uptimeAt(proc.startedAtMs) * CLK_TCK);

  const emitted: RunawayFeedEntry[] = [];
  const readCmdline = vi.fn(async (pid: number) => procs.get(pid)?.cmdline ?? null);
  const deps: Partial<RunawayPatrolDeps> = {
    platform: 'linux',
    dashboardPid: 4242,
    now: () => Date.now(),
    listCgroupProcs: async () => [{ cgroup: '/app.slice/overdeck-herdr.service', pids: [...procs.keys()] }],
    readProcStat: async (pid): Promise<ProcStat | null> => {
      const proc = procs.get(pid);
      if (!proc) return null;
      return {
        comm: proc.comm,
        ppid: proc.ppid,
        pgid: proc.pgid,
        cpuTicks: Math.round(((Date.now() - proc.startedAtMs) / 1000) * proc.cores * CLK_TCK),
        nice: 0,
        starttime: starttimeOf(proc),
        rssPages: 256,
      };
    },
    readEnviron: async (pid) => procs.get(pid)?.env ?? {},
    readCmdline,
    readCwd: async () => null,
    readUptimeSeconds: async () => uptimeAt(Date.now()),
    readAdmissionOwnerPid: async () => null,
    isAgentIdle: () => false,
    readHostCpu: () => ({ cpuPercent: 20, load1: 4, cores: 24 }),
    emit: (entry) => { emitted.push(entry); },
  };
  return { procs, deps, emitted, readCmdline };
}

async function step(patrol: { tick(): Promise<void> }): Promise<void> {
  await vi.advanceTimersByTimeAsync(RUNAWAY_PATROL_INTERVAL_MS);
  await patrol.tick();
}

describe('parseProcStat (PAN-4311)', () => {
  it('reads fields after a comm that contains spaces and parentheses', () => {
    const fields = Array.from({ length: 50 }, (_, i) => String(i + 3));
    fields[4 - 3] = '1917'; // ppid
    fields[5 - 3] = '500'; // pgrp
    fields[14 - 3] = '700'; // utime
    fields[15 - 3] = '300'; // stime
    fields[19 - 3] = '10'; // nice
    fields[22 - 3] = '123456'; // starttime
    fields[24 - 3] = '64'; // rss
    fields[0] = 'R';

    expect(parseProcStat(`500 (my (odd) cmd) ${fields.join(' ')}`)).toEqual({
      comm: 'my (odd) cmd',
      ppid: 1917,
      pgid: 500,
      cpuTicks: 1000,
      nice: 10,
      starttime: 123456,
      rssPages: 64,
    });
  });

  it('returns null for a malformed line', () => {
    expect(parseProcStat('garbage')).toBeNull();
  });
});

describe('createRunawayPatrol (PAN-4311 AC-4, AC-5)', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    for (const spy of Object.values(sideEffects)) spy.mockClear();
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.useRealTimers();
  });

  it('warns once when the window fills, escalates once at 60 min, and resolves once on exit', async () => {
    const { procs, deps, emitted } = host(Date.now());
    const patrol = createRunawayPatrol(deps);

    await patrol.tick();
    for (let i = 1; i < 20; i += 1) await step(patrol); // 9.5 min observed
    expect(emitted).toEqual([]);

    await step(patrol); // 10 min: the window is full
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      level: 'warn',
      source: 'cloister',
      link: '/resources',
      details: { category: 'resources', targetKind: 'runaway-process', targetId: 'agent-pan-9', pgid: 500, reason: 'orphaned', count: 1 },
    });
    expect(emitted[0]!.message).toBe('yes (agent-pan-9) has burned 10 CPU-min over 40 min [orphaned]. pgid 500. Stop: kill -TERM -500');

    for (let i = 0; i < 39; i += 1) await step(patrol); // 29.5 min: group age 59.5 min
    expect(emitted).toHaveLength(1);

    await step(patrol); // group age 60 min
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ level: 'warn' });
    expect(emitted[1]!.message).toContain('still running after 60 min');

    for (let i = 0; i < 10; i += 1) await step(patrol);
    expect(emitted).toHaveLength(2);

    procs.delete(500);
    await step(patrol);
    expect(emitted).toHaveLength(3);
    expect(emitted[2]).toMatchObject({ level: 'info' });
    expect(emitted[2]!.message).toContain('exited');

    await step(patrol);
    expect(emitted).toHaveLength(3);

    // AC-5: the whole lifecycle never killed, paused, stopped or messaged anything.
    expect(killSpy).not.toHaveBeenCalled();
    expect(sideEffects.stopAgent).not.toHaveBeenCalled();
    expect(sideEffects.setAgentPaused).not.toHaveBeenCalled();
    expect(sideEffects.deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('treats a reused pid with a different starttime as a new process', async () => {
    const { procs, deps, emitted, readCmdline } = host(Date.now());
    const patrol = createRunawayPatrol(deps);

    await patrol.tick();
    for (let i = 0; i < 20; i += 1) await step(patrol);
    expect(emitted).toHaveLength(1);

    procs.delete(500);
    await step(patrol);
    expect(emitted).toHaveLength(2); // resolved

    readCmdline.mockClear();
    procs.set(500, { pid: 500, ppid: 1917, pgid: 500, comm: 'yes', cmdline: 'yes', startedAtMs: Date.now() - 30 * MIN, cores: 1 });
    await step(patrol);
    expect(readCmdline).toHaveBeenCalledWith(500); // new identity: its facts are read again
    expect(emitted).toHaveLength(2); // and its window starts over

    for (let i = 0; i < 20; i += 1) await step(patrol);
    expect(emitted).toHaveLength(3);
    expect(emitted[2]!.details.targetId).toBe('overdeck-herdr.service'); // no agent environ: the cgroup unit owns it
  });

  it('publishes a snapshot with harness roots, core services and attributed records', async () => {
    const { deps } = host(Date.now());
    const patrol = createRunawayPatrol(deps);

    expect(patrol.snapshot()).toBeNull();
    await patrol.tick();

    const snapshot = patrol.snapshot()!;
    expect(snapshot.agentSessions).toEqual([{ agentId: 'agent-pan-9', rootPid: 300 }]);
    expect(snapshot.coreServicePids).toEqual([100, 4242]);
    expect(snapshot.records.map((record) => record.pid).sort((a, b) => a - b)).toEqual([100, 200, 300, 500]);
    expect(snapshot).toMatchObject({ load1: 4, cores: 24, cpuPercent: 20, runaways: [] });
    expect(snapshot.processGroups).toEqual([expect.objectContaining({ label: 'yes', agentId: 'agent-pan-9', count: 1 })]);
  });

  it('does nothing off Linux', async () => {
    const { deps, emitted } = host(Date.now());
    const patrol = createRunawayPatrol({ ...deps, platform: 'darwin' });

    await patrol.tick();

    expect(patrol.snapshot()).toBeNull();
    expect(emitted).toEqual([]);
  });

  it('asks isIdle only for agents behind an outlived-tool-call candidate', async () => {
    const { procs, deps } = host(Date.now());
    const isAgentIdle = vi.fn(() => true);
    procs.delete(500);
    procs.set(401, {
      pid: 401, ppid: 300, pgid: 401, comm: 'bash', cmdline: 'bash -c git log', startedAtMs: Date.now() - 16 * MIN, cores: 0,
    });
    procs.set(402, {
      pid: 402, ppid: 401, pgid: 402, comm: 'git', cmdline: 'git log -S x', startedAtMs: Date.now() - 16 * MIN, cores: 0.9,
    });
    const patrol = createRunawayPatrol({ ...deps, isAgentIdle });

    await patrol.tick();
    expect(isAgentIdle).not.toHaveBeenCalled(); // window not full: no candidates yet

    for (let i = 0; i < 20; i += 1) await step(patrol);
    expect(isAgentIdle).toHaveBeenCalledWith('agent-pan-9');
    expect(new Set(isAgentIdle.mock.calls.map(([id]) => id))).toEqual(new Set(['agent-pan-9']));
    expect(patrol.snapshot()!.runaways).toEqual([expect.objectContaining({ pgid: 402, reason: 'outlived-tool-call' })]);
  });
});
