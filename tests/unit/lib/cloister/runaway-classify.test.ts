import { describe, expect, it } from 'vitest';

import {
  classifyRunaways,
  resolveHarnessPids,
  type RunawayContext,
  type RunawayProcessFact,
} from '../../../../src/lib/cloister/runaway-classify.js';

/**
 * PAN-4311 AC-3: the ten runaway shapes, as facts the patrol would read.
 * A Herdr host: user manager (pid 1917) → herdr (100) → pane bash (200,
 * carries the agent id) → claude (300, the harness) → tool shell / children.
 */

const MIN = 60_000;
const HERDR_CGROUP = '/user.slice/user-1000.slice/user@1000.service/app.slice/overdeck-herdr.service';
const DASHBOARD_PID = 4242;

let nextStarttime = 1000;
function fact(overrides: Partial<RunawayProcessFact> & Pick<RunawayProcessFact, 'pid' | 'ppid' | 'comm'>): RunawayProcessFact {
  return {
    pgid: overrides.pid,
    cmdline: overrides.comm,
    ageMs: 120 * MIN,
    nice: 0,
    cgroup: HERDR_CGROUP,
    cwd: null,
    agentId: null,
    startedBy: null,
    starttime: nextStarttime++,
    sustainedCores: 0,
    cpuPercent: 0,
    memoryBytes: 0,
    ...overrides,
  };
}

function host(agentId = 'conv-2884'): RunawayProcessFact[] {
  return [
    fact({ pid: 1917, ppid: 1, comm: 'systemd', cgroup: '/user.slice/user-1000.slice/user@1000.service/init.scope' }),
    fact({ pid: 100, ppid: 1917, comm: 'herdr' }),
    fact({ pid: 200, ppid: 100, comm: 'bash', agentId }),
    fact({ pid: 300, ppid: 200, comm: 'claude', agentId, cmdline: 'claude --model opus' }),
  ];
}

function context(overrides: Partial<RunawayContext> = {}): RunawayContext {
  return {
    idleAgentIds: new Set(),
    admissionOwnerPid: null,
    dashboardPid: DASHBOARD_PID,
    windowMs: 10 * MIN,
    ...overrides,
  };
}

const gitLog = 'git log --all --oneline -S fly-hoff';

describe('resolveHarnessPids (PAN-4311 D6)', () => {
  it('picks the harness process, not the pane shell carrying the same agent id', () => {
    expect(resolveHarnessPids(host())).toEqual(new Map([['conv-2884', 300]]));
  });

  it('recognizes a codex app-server host and ignores a nested harness of the same agent', () => {
    const facts = [
      fact({ pid: 10, ppid: 1, comm: 'node', cmdline: 'node /x/codex-app-server-host.js', agentId: 'agent-pan-1' }),
      fact({ pid: 11, ppid: 10, comm: 'codex', agentId: 'agent-pan-1' }),
    ];
    expect(resolveHarnessPids(facts)).toEqual(new Map([['agent-pan-1', 10]]));
  });
});

describe('classifyRunaways (PAN-4311 AC-3)', () => {
  it('flags the conv-2884 shape as outlived-tool-call', () => {
    const facts = [
      ...host(),
      fact({ pid: 400, ppid: 300, comm: 'bash', cmdline: `bash -c ${gitLog} | head`, ageMs: 16 * MIN, pgid: 400 }),
      fact({ pid: 401, ppid: 400, comm: 'git', cmdline: gitLog, ageMs: 16 * MIN - 1, pgid: 401, sustainedCores: 0.9 }),
    ];

    const { runaways } = classifyRunaways(facts, context({ idleAgentIds: new Set(['conv-2884']) }));

    expect(runaways).toEqual([expect.objectContaining({
      owner: 'conv-2884',
      agentId: 'conv-2884',
      pgid: 401,
      reason: 'outlived-tool-call',
      command: gitLog,
      count: 1,
      cpuMinutes: 9,
    })]);
  });

  it('flags a git that is a direct child of the harness as detached-from-tool-shell', () => {
    const facts = [
      ...host(),
      fact({ pid: 401, ppid: 300, comm: 'git', cmdline: gitLog, ageMs: 11 * MIN, sustainedCores: 0.9 }),
    ];

    expect(classifyRunaways(facts, context()).runaways)
      .toEqual([expect.objectContaining({ pgid: 401, reason: 'detached-from-tool-shell' })]);
  });

  it('leaves a busy agent\'s tool call alone at 16 min and flags it as long-burn at 30 min', () => {
    const shaped = (ageMs: number) => [
      ...host(),
      fact({ pid: 400, ppid: 300, comm: 'bash', cmdline: 'bash -c make', ageMs, pgid: 400 }),
      fact({ pid: 401, ppid: 400, comm: 'git', ageMs: ageMs - 1, pgid: 400, sustainedCores: 0.9 }),
    ];

    expect(classifyRunaways(shaped(16 * MIN), context()).runaways).toEqual([]);
    expect(classifyRunaways(shaped(30 * MIN), context()).runaways)
      .toEqual([expect.objectContaining({ pgid: 400, reason: 'long-burn', count: 2 })]);
  });

  it('never flags the harness or its pane shell, even burning a core for 40 min', () => {
    const facts = host().map((f) => (f.pid === 300 || f.pid === 200 ? { ...f, ageMs: 40 * MIN, sustainedCores: 1 } : f));

    const result = classifyRunaways(facts, context({ idleAgentIds: new Set(['conv-2884']) }));

    expect(result.runaways).toEqual([]);
    expect(result.attributed.map((f) => f.pid)).not.toContain(300);
    expect(result.attributed.map((f) => f.pid)).not.toContain(200);
  });

  it('never flags the Herdr server at 1.2 cores for 2 h', () => {
    const facts = host().map((f) => (f.comm === 'herdr' ? { ...f, sustainedCores: 1.2 } : f));

    const result = classifyRunaways(facts, context());

    expect(result.runaways).toEqual([]);
    expect(result.coreServicePids).toEqual([100, DASHBOARD_PID]);
  });

  it('flags an orphan re-parented to the user manager as orphaned', () => {
    const facts = [
      ...host(),
      fact({ pid: 500, ppid: 1917, comm: 'node', cmdline: 'node busy.js', agentId: 'agent-pan-9', ageMs: 11 * MIN, sustainedCores: 0.9 }),
    ];

    expect(classifyRunaways(facts, context()).runaways)
      .toEqual([expect.objectContaining({ owner: 'agent-pan-9', reason: 'orphaned', pgid: 500 })]);
  });

  it('groups 42 yes processes sharing one pgid under a lane conversation', () => {
    const lane = 'conv-lane-b1';
    const yes = Array.from({ length: 42 }, (_, i) => fact({
      pid: 700 + i,
      ppid: 600,
      comm: 'yes',
      cmdline: 'yes',
      pgid: 700,
      ageMs: 31 * MIN,
      sustainedCores: 0.5,
    }));
    const facts = [
      ...host(lane),
      fact({ pid: 600, ppid: 300, comm: 'bash', cmdline: 'bash -c for i in $(seq 42); do yes > /dev/null & done', agentId: lane, pgid: 600, ageMs: 31 * MIN }),
      ...yes,
    ];

    const { runaways } = classifyRunaways(facts, context());

    expect(runaways).toHaveLength(1);
    expect(runaways[0]).toMatchObject({ owner: lane, pgid: 700, count: 42, sustainedCores: 21, reason: 'long-burn', command: 'yes' });
  });

  it('excludes a gate-shaped group at 19 min and includes it at 21 min', () => {
    const gate = (ageMs: number) => [
      ...host(),
      fact({ pid: 800, ppid: 300, comm: 'bash', cmdline: 'bash -c npm test', ageMs: ageMs + 1, pgid: 800 }),
      fact({ pid: 801, ppid: 800, comm: 'node', cmdline: 'node vitest', nice: 19, pgid: 801, ageMs, sustainedCores: 4 }),
    ];
    const idle = context({ idleAgentIds: new Set(['conv-2884']) });

    expect(classifyRunaways(gate(19 * MIN), idle).runaways).toEqual([]);
    expect(classifyRunaways(gate(21 * MIN), idle).runaways)
      .toEqual([expect.objectContaining({ pgid: 801, reason: 'outlived-tool-call' })]);
  });

  it('never flags a process in a Docker cgroup', () => {
    const facts = [
      ...host(),
      fact({
        pid: 900,
        ppid: 1917,
        comm: 'postgres',
        cgroup: '/system.slice/docker-0123abcd.scope',
        ageMs: 60 * MIN,
        sustainedCores: 2,
      }),
    ];

    const result = classifyRunaways(facts, context());

    expect(result.runaways).toEqual([]);
    expect(result.attributed.map((f) => f.pid)).not.toContain(900);
  });

  it('never flags the quality-gate admission owner or its descendants', () => {
    const facts = [
      ...host(),
      fact({ pid: 950, ppid: 1917, comm: 'node', cmdline: 'node verification-worker.js', ageMs: 40 * MIN, sustainedCores: 1 }),
      fact({ pid: 951, ppid: 950, comm: 'node', cmdline: 'node vitest', ageMs: 40 * MIN, sustainedCores: 3 }),
    ];

    expect(classifyRunaways(facts, context({ admissionOwnerPid: 950 })).runaways).toEqual([]);
    expect(classifyRunaways(facts, context()).runaways).toHaveLength(2);
  });

  it('treats a tool call left under Herdr after its harness exited as outlived, not orphaned', () => {
    const facts = [
      fact({ pid: 1917, ppid: 1, comm: 'systemd' }),
      fact({ pid: 100, ppid: 1917, comm: 'herdr' }),
      fact({ pid: 200, ppid: 100, comm: 'bash', agentId: 'agent-pan-7' }),
      fact({ pid: 401, ppid: 200, comm: 'git', cmdline: gitLog, ageMs: 11 * MIN, sustainedCores: 0.9 }),
    ];

    expect(classifyRunaways(facts, context()).runaways).toEqual([]);
    const later = facts.map((f) => (f.pid === 401 ? { ...f, ageMs: 16 * MIN } : f));
    expect(classifyRunaways(later, context()).runaways)
      .toEqual([expect.objectContaining({ owner: 'agent-pan-7', reason: 'outlived-tool-call' })]);
  });

  it('attributes ownership by cgroup unit, then workspace cwd, then host', () => {
    const facts = [
      fact({ pid: 10, ppid: 1, comm: 'python', cgroup: '/app.slice/tmux-spawn-abc.scope', sustainedCores: 0 }),
      fact({ pid: 11, ppid: 1, comm: 'python', cgroup: '', cwd: '/home/u/Projects/overdeck/workspaces/feature-pan-4311/src' }),
      fact({ pid: 12, ppid: 1, comm: 'python', cgroup: '' }),
    ];

    expect(classifyRunaways(facts, context()).attributed.map((f) => f.owner))
      .toEqual(['tmux-spawn-abc.scope', 'PAN-4311', 'host']);
  });

  it('does not flag a group before its window is filled or below half a core', () => {
    const facts = [
      ...host(),
      fact({ pid: 401, ppid: 1917, comm: 'yes', ageMs: 60 * MIN, sustainedCores: null }),
      fact({ pid: 402, ppid: 1917, comm: 'yes', ageMs: 60 * MIN, sustainedCores: 0.4 }),
    ];

    expect(classifyRunaways(facts, context()).runaways).toEqual([]);
  });
});
