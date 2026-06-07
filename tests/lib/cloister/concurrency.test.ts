import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  workResumeSlotsAvailable,
  canDispatchAdvancing,
  type ConcurrencyLimits,
  type RunningCounts,
} from '../../../src/lib/cloister/concurrency.js';

const LIMITS: ConcurrencyLimits = { maxWorkAgents: 6, reservedAdvancingSlots: 3, totalCeiling: 9 };

describe('concurrency governor — pure math', () => {
  it('reports free work slots below the cap', () => {
    const counts: RunningCounts = { work: 2, advancing: 1, total: 3 };
    expect(workResumeSlotsAvailable(counts, LIMITS)).toBe(4);
  });

  it('reports zero slots at the cap (never negative)', () => {
    expect(workResumeSlotsAvailable({ work: 6, advancing: 0, total: 6 }, LIMITS)).toBe(0);
    // Over the cap (e.g. forced starts) → still 0, never negative; deacon resumes nothing.
    expect(workResumeSlotsAvailable({ work: 9, advancing: 0, total: 9 }, LIMITS)).toBe(0);
  });

  it('allows advancing dispatch until the total ceiling, using reserved headroom', () => {
    // Work at its cap but total below ceiling → advancing roles can still claim slots.
    expect(canDispatchAdvancing({ work: 6, advancing: 2, total: 8 }, LIMITS)).toBe(true);
    expect(canDispatchAdvancing({ work: 6, advancing: 3, total: 9 }, LIMITS)).toBe(false);
  });
});

describe('concurrency governor — config + counting', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../../src/lib/cloister/config.js');
    vi.doUnmock('../../../src/lib/agents.js');
  });

  it('falls back to safe defaults when config omits/garbles concurrency', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/cloister/config.js', () => ({
      loadCloisterConfigSync: () => ({ concurrency: { max_work_agents: 0, reserved_advancing_slots: -5 } }),
    }));
    const { getConcurrencyLimits } = await import('../../../src/lib/cloister/concurrency.js');
    const limits = getConcurrencyLimits();
    expect(limits.maxWorkAgents).toBe(1); // clamped to >= 1
    expect(limits.reservedAdvancingSlots).toBe(0); // clamped to >= 0
  });

  it('counts only tmux-alive agents, grouped into work vs advancing', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/agents.js', () => ({
      listRunningAgentsSync: () => [
        { role: 'work', tmuxActive: true },
        { role: 'work', tmuxActive: false }, // dead — ignored
        { role: 'review', tmuxActive: true },
        { role: 'ship', tmuxActive: true },
        { role: 'plan', tmuxActive: true }, // neither work nor advancing
      ],
    }));
    const { countRunningAgents } = await import('../../../src/lib/cloister/concurrency.js');
    expect(countRunningAgents()).toEqual({ work: 1, advancing: 2, total: 3 });
  });

  it('reserves advancing slots up to the ceiling per patrol, then resets', async () => {
    vi.resetModules();
    // ceiling = max_work_agents (1) + reserved_advancing_slots (1) = 2
    vi.doMock('../../../src/lib/cloister/config.js', () => ({
      loadCloisterConfigSync: () => ({ concurrency: { max_work_agents: 1, reserved_advancing_slots: 1 } }),
    }));
    vi.doMock('../../../src/lib/agents.js', () => ({
      listRunningAgentsSync: () => [], // 0 running → all headroom is from the per-patrol budget
    }));
    const { tryReserveAdvancingSlot, resetPatrolDispatchBudget } = await import('../../../src/lib/cloister/concurrency.js');

    resetPatrolDispatchBudget();
    expect(tryReserveAdvancingSlot()).toBe(true);  // 0 running + 0 reserved < 2
    expect(tryReserveAdvancingSlot()).toBe(true);  // 0 + 1 < 2
    expect(tryReserveAdvancingSlot()).toBe(false); // 0 + 2 >= 2 → defer
    resetPatrolDispatchBudget();
    expect(tryReserveAdvancingSlot()).toBe(true);  // budget cleared for the next patrol
  });
});
