import { describe, expect, it, beforeEach, vi } from 'vitest';

// PAN-2504: memory-driven work-agent admission ceiling.

const getCachedMemoryVerdictMock = vi.fn();
const concurrencyConfig: Record<string, unknown> = {};

vi.mock('../../../../src/lib/cloister/memory-verdict-cache.js', () => ({
  getCachedMemoryVerdict: (...args: unknown[]) => getCachedMemoryVerdictMock(...args),
}));

vi.mock('../../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfigSync: () => ({ concurrency: concurrencyConfig }),
}));

// countAgentsByStatus / agents.js are pulled transitively — stub the minimum.
vi.mock('../../../../src/lib/overdeck/agents.js', () => ({
  countAgentsByStatus: () => ({}),
}));
vi.mock('../../../../src/lib/agents.js', () => ({
  listRunningAgentsSync: () => [],
  stopAgentSync: vi.fn(),
  getAgentStateSync: () => null,
  saveAgentStateSync: vi.fn(),
  getAgentRuntimeStateSync: () => null,
}));

import {
  memoryDrivenWorkSlots,
  workResumeSlotsAvailable,
  type ConcurrencyLimits,
  type RunningCounts,
} from '../../../../src/lib/cloister/concurrency.js';

const GIB = 1024 ** 3;
// 62.6 GB box: SOFT reserve ~9.4 GB (15%). footprint 2 GB/work agent.
const verdict = (availGb: number, softGb = 9.4) => ({
  band: 'ok' as const,
  availableBytes: availGb * GIB,
  thresholds: { warningBytes: softGb * GIB, criticalBytes: 5 * GIB },
});

const limits: ConcurrencyLimits = {
  maxWorkAgents: 6,
  reservedAdvancingSlots: 3,
  reservedSwarmSlots: 3,
  totalCeiling: 9,
  exemptOperatorStarted: true,
};
const counts = (work: number): RunningCounts => ({ work, advancing: 0, swarm: 0, total: work });

describe('memoryDrivenWorkSlots — PAN-2504 memory-budget ceiling', () => {
  beforeEach(() => {
    getCachedMemoryVerdictMock.mockReset().mockReturnValue(null);
    for (const k of Object.keys(concurrencyConfig)) delete concurrencyConfig[k];
    Object.assign(concurrencyConfig, {
      max_work_agents: 6,
      memory_driven: true,
      memory_driven_max_work_agents: 24,
      work_footprint_gb: 2,
    });
  });

  it('returns null (defer to count cap) when memory_driven is off', () => {
    concurrencyConfig.memory_driven = false;
    getCachedMemoryVerdictMock.mockReturnValue(verdict(49.8));
    expect(memoryDrivenWorkSlots(2)).toBeNull();
    // workResumeSlotsAvailable then uses the count cap: 6 - 2 = 4.
    expect(workResumeSlotsAvailable(counts(2), limits)).toBe(4);
  });

  it('returns null (fail safe to count cap) when the governor has not measured yet', () => {
    getCachedMemoryVerdictMock.mockReturnValue(null);
    expect(memoryDrivenWorkSlots(2)).toBeNull();
    expect(workResumeSlotsAvailable(counts(2), limits)).toBe(4);
  });

  it('fills toward the memory budget instead of the fixed cap of 6', () => {
    // floor((49.8 - 9.4) / 2) = floor(20.2) = 20; running 2, ceiling 24 -> min(20, 22) = 20.
    getCachedMemoryVerdictMock.mockReturnValue(verdict(49.8));
    expect(memoryDrivenWorkSlots(2)).toBe(20);
    expect(workResumeSlotsAvailable(counts(2), limits)).toBe(20); // NOT 4
  });

  it('respects the safety ceiling when memory is abundant', () => {
    // floor((200 - 9.4)/2) = 95 fits, but ceiling 24 - running 5 = 19.
    getCachedMemoryVerdictMock.mockReturnValue(verdict(200));
    expect(memoryDrivenWorkSlots(5)).toBe(19);
  });

  it('admits nothing once free memory is at/below the SOFT reserve', () => {
    // available 10 GB, soft 9.4 GB -> budget 0.6 GB -> floor(0.6/2) = 0.
    getCachedMemoryVerdictMock.mockReturnValue(verdict(10));
    expect(memoryDrivenWorkSlots(0)).toBe(0);
  });

  it('never returns negative when already at/over the ceiling', () => {
    getCachedMemoryVerdictMock.mockReturnValue(verdict(49.8));
    expect(memoryDrivenWorkSlots(30)).toBe(0); // 24 - 30 clamped to 0
  });

  it('honours a custom (larger) footprint estimate — fewer admissions', () => {
    concurrencyConfig.work_footprint_gb = 4;
    getCachedMemoryVerdictMock.mockReturnValue(verdict(49.8));
    // floor((49.8 - 9.4)/4) = floor(10.1) = 10.
    expect(memoryDrivenWorkSlots(0)).toBe(10);
  });
});
