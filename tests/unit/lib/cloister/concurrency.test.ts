import { describe, expect, it, beforeEach, vi } from 'vitest';

const getCachedMemoryVerdictMock = vi.fn();

vi.mock('../../../../src/lib/cloister/memory-verdict-cache.js', () => ({
  getCachedMemoryVerdict: (...args: unknown[]) => getCachedMemoryVerdictMock(...args),
}));

import {
  canDispatchAdvancing,
  tryReserveAdvancingSlot,
  resetPatrolDispatchBudget,
  type ConcurrencyLimits,
  type RunningCounts,
} from '../../../../src/lib/cloister/concurrency.js';

const GIB = 1024 ** 3;
const limits: ConcurrencyLimits = {
  maxWorkAgents: 6,
  reservedAdvancingSlots: 3,
  reservedSwarmSlots: 3,
  totalCeiling: 9,
  exemptOperatorStarted: true,
};
const countsWithFreeSlot: RunningCounts = { work: 4, advancing: 1, swarm: 0, total: 5 };

describe('canDispatchAdvancing / tryReserveAdvancingSlot — memory gate (PAN-2500 specialist-budget)', () => {
  beforeEach(() => {
    resetPatrolDispatchBudget();
    getCachedMemoryVerdictMock.mockReturnValue(null);
  });

  it('withholds dispatch when the cached band is soft, even though a count slot is free (PRD AC-5)', () => {
    getCachedMemoryVerdictMock.mockReturnValue({ band: 'soft', availableBytes: 3 * GIB, thresholds: { warningBytes: 8 * GIB, criticalBytes: 4 * GIB } });
    expect(canDispatchAdvancing(countsWithFreeSlot, limits)).toBe(false);
    expect(tryReserveAdvancingSlot(countsWithFreeSlot, limits)).toBe(false);
  });

  it('withholds dispatch when the cached band is hard', () => {
    getCachedMemoryVerdictMock.mockReturnValue({ band: 'hard', availableBytes: 1 * GIB, thresholds: { warningBytes: 8 * GIB, criticalBytes: 4 * GIB } });
    expect(canDispatchAdvancing(countsWithFreeSlot, limits)).toBe(false);
  });

  it('proceeds with unchanged count-slot semantics when the cached band is ok', () => {
    getCachedMemoryVerdictMock.mockReturnValue({ band: 'ok', availableBytes: 20 * GIB, thresholds: { warningBytes: 8 * GIB, criticalBytes: 4 * GIB } });
    expect(canDispatchAdvancing(countsWithFreeSlot, limits)).toBe(true);
    expect(tryReserveAdvancingSlot(countsWithFreeSlot, limits)).toBe(true);
  });

  it('proceeds normally when no patrol has assessed memory yet (cached verdict null)', () => {
    getCachedMemoryVerdictMock.mockReturnValue(null);
    expect(canDispatchAdvancing(countsWithFreeSlot, limits)).toBe(true);
  });

  it('still enforces the count ceiling when memory is ok (unrelated failure mode unchanged)', () => {
    getCachedMemoryVerdictMock.mockReturnValue({ band: 'ok', availableBytes: 20 * GIB, thresholds: { warningBytes: 8 * GIB, criticalBytes: 4 * GIB } });
    const atCeiling: RunningCounts = { work: 6, advancing: 3, swarm: 0, total: 9 };
    expect(canDispatchAdvancing(atCeiling, limits)).toBe(false);
  });
});
