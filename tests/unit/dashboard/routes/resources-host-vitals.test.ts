import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHostVitalsSnapshot,
  resetHostVitalsForTests,
} from '../../../../src/dashboard/server/routes/resources.js';

const NOW_MS = Date.parse('2026-07-07T12:00:00.000Z');

afterEach(() => {
  resetHostVitalsForTests();
  vi.useRealTimers();
});

describe('host vitals resources payload', () => {
  it('returns the expected hostVitals field groups', () => {
    const snapshot = buildHostVitalsSnapshot({
      nowMs: NOW_MS,
      hostMetrics: hostMetrics({
        cpuPercent: 42.4,
        loadAverage1m: 1.1,
        usedMemoryBytes: 8,
        availableMemoryBytes: 4,
        swapUsedBytes: 1,
        swapTotalBytes: 2,
      }),
      disk: {
        usedBytes: 100,
        freeBytes: 50,
      },
      containers: [
        container('a', 'running', 'pan'),
        container('b', 'stopped', 'pan'),
        container('c', 'running', 'other'),
      ],
      networkCount: 7,
      agents: [
        agent('agent-active', 1, true),
        agent('agent-idle', 20, true),
        agent('agent-offline', 30, false),
      ],
      agentFleet: {
        burnUsdPerHour: 1.5,
        totalUsd: 4.2,
      },
    });

    expect(snapshot).toMatchObject({
      cpu: {
        percent: 42.4,
        load: [1.1, null, null],
      },
      mem: {
        usedBytes: 8,
        availableBytes: 4,
        swapUsedBytes: 1,
      },
      disk: {
        usedBytes: 100,
        freeBytes: 50,
        reclaimableBytes: 0,
      },
      docker: {
        containers: 3,
        running: 2,
        stacks: 2,
        networks: 7,
        networkPool: { used: 7, total: 31 },
      },
      agents: {
        sessions: 3,
        active: 2,
        idleOver15m: 2,
        burnUsdPerHour: 1.5,
      },
    });
    expect(snapshot.cpu.spark).toHaveLength(1);
  });

  it('preserves unavailable accepted metrics instead of fabricating measured zeroes', () => {
    const snapshot = buildHostVitalsSnapshot({
      nowMs: NOW_MS,
      hostMetrics: hostMetrics({
        cpuPercent: null,
        loadAverage1m: null,
        usedMemoryBytes: null,
        availableMemoryBytes: null,
        swapUsedBytes: null,
        swapTotalBytes: null,
      }),
    });

    expect(snapshot.cpu).toMatchObject({
      percent: null,
      load: [null, null, null],
      spark: [],
    });
    expect(snapshot.mem).toEqual({
      usedBytes: null,
      availableBytes: null,
      swapUsedBytes: null,
      swapTotalBytes: null,
    });
  });

  it('marks stale when docker counts fail and preserves the last cached counts', () => {
    buildHostVitalsSnapshot({
      nowMs: NOW_MS,
      hostMetrics: hostMetrics(),
      containers: [
        container('a', 'running', 'pan'),
        container('b', 'stopped', 'pan'),
      ],
      networkCount: 3,
    });

    const stale = buildHostVitalsSnapshot({
      nowMs: NOW_MS + 5_000,
      hostMetrics: hostMetrics(),
      dockerStale: true,
      containers: [],
      networkCount: 0,
    });

    expect(stale.stale).toBe(true);
    expect(stale.docker).toMatchObject({
      containers: 2,
      running: 1,
      stacks: 1,
      networks: 3,
      stale: true,
    });
  });

  it('caps cpu.spark at 30 points after 35 collector ticks', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 35; i += 1) {
      buildHostVitalsSnapshot({
        nowMs: NOW_MS + i * 5_000,
        hostMetrics: hostMetrics({ cpuPercent: i }),
      });
      await vi.advanceTimersByTimeAsync(5_000);
    }

    const snapshot = buildHostVitalsSnapshot({
      nowMs: NOW_MS + 35 * 5_000,
      hostMetrics: hostMetrics({ cpuPercent: 35 }),
    });

    expect(snapshot.cpu.spark).toHaveLength(30);
    expect(snapshot.cpu.spark[0]).toBe(6);
    expect(snapshot.cpu.spark.at(-1)).toBe(35);
  });
});

function hostMetrics(overrides: Record<string, number | null> = {}) {
  return {
    cpuPercent: 0,
    loadAverage1m: 0,
    loadPerCore1m: 0,
    totalMemoryBytes: 0,
    usedMemoryBytes: 0,
    availableMemoryBytes: 0,
    memoryUsedPercent: 0,
    memoryPressureSomeAvg10: 0,
    memoryPressureFullAvg10: 0,
    memoryPressureFreePercent: null,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
    swapUsedPercent: 0,
    swapActivityBytesPerMinute: 0,
    committedMemoryBytes: 0,
    commitLimitBytes: 0,
    virtualCommitmentPercent: 0,
    ...overrides,
  };
}

function container(id: string, status: string, project: string) {
  return {
    id,
    status,
    labels: {
      'com.docker.compose.project': project,
    },
  };
}

function agent(id: string, idleMinutes: number, hasLiveTmuxSession: boolean) {
  return {
    id,
    hasLiveTmuxSession,
    lastActivity: new Date(NOW_MS - idleMinutes * 60_000).toISOString(),
  };
}
