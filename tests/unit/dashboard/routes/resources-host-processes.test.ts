import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildHostProcesses,
  resetHostProcessRetention,
  type AgentSessionProcess,
  type HostProcessRecord,
} from '../../../../src/dashboard/server/routes/resources.js';

const agentSessions: AgentSessionProcess[] = [
  {
    agentId: 'agent-pan-2341-test',
    issueId: 'PAN-2341',
    rootPid: 100,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'));
  resetHostProcessRetention();
});

afterEach(() => {
  resetHostProcessRetention();
  vi.useRealTimers();
});

describe('host process resources payload', () => {
  it('excludes docker-cgroup pids, sorts by CPU, and caps the payload at top 10', () => {
    const processes: HostProcessRecord[] = [
      process(1, 0, '/usr/bin/containerd-shim', 900, 8_000_000_000, '/docker/abc'),
      process(2, 0, 'tmux agent root', 0, 100_000),
      ...Array.from({ length: 12 }, (_, index) => {
        const rank = index + 1;
        return process(200 + rank, 2, `/usr/bin/worker-${rank}`, 100 - rank, rank * 1_000);
      }),
    ];

    const rows = buildHostProcesses(processes, { limit: 10 });

    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.family)).not.toContain('/usr/bin/containerd-shim');
    expect(rows[0]).toMatchObject({
      family: '/usr/bin/worker-1',
      cpuPercent: 99,
      owner: { label: 'host' },
    });
    expect(rows.at(-1)?.family).toBe('/usr/bin/worker-10');
  });

  it('attributes a vitest worker to the ancestor agent tmux session', () => {
    const rows = buildHostProcesses([
      process(100, 0, 'tmux new-session -s agent-pan-2341-test', 0.1, 100_000),
      process(110, 100, 'bash', 0.1, 100_000),
      process(120, 110, 'node ./node_modules/.bin/vitest run', 220, 2_000_000_000),
    ], { agentSessions });

    const vitestRow = rows.find((row) => row.family === 'vitest workers');

    expect(vitestRow).toMatchObject({
      family: 'vitest workers',
      owner: {
        agentId: 'agent-pan-2341-test',
        issueId: 'PAN-2341',
        label: 'spawned by agent-pan-2341-test',
      },
      pidCount: 1,
      pids: [120],
    });
  });

  it('retains an exited high-CPU group for 1 hour with peak values and zero current usage', async () => {
    const highCpuFixture = [
      process(100, 0, 'tmux new-session -s agent-pan-2341-test', 0.1, 100_000),
      process(110, 100, 'bash', 0.1, 100_000),
      process(120, 110, 'node ./node_modules/.bin/vitest run', 160, 2_000_000_000),
    ];

    buildHostProcesses(highCpuFixture, { agentSessions });

    const retained = buildHostProcesses([], {
      agentSessions,
      spikeAnnotations: [{
        label: 'Load 45.0 spike - vitest workers x1',
        targetId: 'agent-pan-2341-test',
      }],
    });

    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({
      family: 'vitest workers',
      cpuPercent: 0,
      memoryBytes: 0,
      peakCpuPercent: 160,
      peakMemoryBytes: 2_000_000_000,
      note: 'caused spike: Load 45.0 spike - vitest workers x1',
    });

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(buildHostProcesses([], { agentSessions })).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(buildHostProcesses([], { agentSessions })).toHaveLength(0);
  });
});

function process(
  pid: number,
  ppid: number,
  command: string,
  cpuPercent: number,
  memoryBytes: number,
  cgroup?: string,
): HostProcessRecord {
  return { pid, ppid, command, cpuPercent, memoryBytes, cgroup };
}
