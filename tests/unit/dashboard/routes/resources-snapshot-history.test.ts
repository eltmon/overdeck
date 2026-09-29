import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

/**
 * PAN-4311 FR-13: every resources snapshot refresh records one history sample
 * with the host CPU percent, memory percent and CPU PSI.
 */

const recordResourceHistorySample = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/agents.js', () => ({ listAgentStates: () => [] }));
vi.mock('../../../../src/lib/tmux.js', () => ({
  listSessionsSync: () => [],
  listPaneValuesSync: () => [],
  listSessions: () => Effect.succeed([]),
  listPaneValues: async () => [],
}));
vi.mock('../../../../src/lib/runtime-census.js', () => ({
  getRuntimeCensus: async () => ({ sessionNames: new Set(), processesByPid: new Map() }),
  panePidsForSession: () => [],
}));
vi.mock('../../../../src/lib/system-health/cpu-psi.js', () => ({
  readCpuPsi: async () => ({ someAvg10: 12, someAvg60: 40 }),
}));
vi.mock('../../../../src/dashboard/server/routes/resources/host-vitals.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/dashboard/server/routes/resources/host-vitals.js')>();
  return {
    ...actual,
    buildHostVitalsSnapshot: (...args: Parameters<typeof actual.buildHostVitalsSnapshot>) => {
      const vitals = actual.buildHostVitalsSnapshot(...args);
      return {
        ...vitals,
        cpu: { ...vitals.cpu, percent: 37 },
        mem: { ...vitals.mem, usedBytes: 16 * 1024 ** 3, availableBytes: 48 * 1024 ** 3 },
      };
    },
  };
});
vi.mock('../../../../src/dashboard/server/routes/resources/history.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/dashboard/server/routes/resources/history.js')>(),
  recordResourceHistorySample,
}));

const { refreshResourcesSnapshot } = await import('../../../../src/dashboard/server/routes/resources/snapshot.js');

describe('resources snapshot history wiring (PAN-4311 history-psi.ac3)', () => {
  it('records one history sample with CPU percent, memory percent and CPU PSI per refresh', async () => {
    await refreshResourcesSnapshot();

    expect(recordResourceHistorySample).toHaveBeenCalledTimes(1);
    expect(recordResourceHistorySample).toHaveBeenCalledWith({
      cpuPercent: 37,
      memoryPercent: 25,
      psiCpuSomeAvg10: 12,
      psiCpuSomeAvg60: 40,
    });
  });
});
