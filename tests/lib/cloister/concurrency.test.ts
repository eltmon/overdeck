import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  workResumeSlotsAvailable,
  canDispatchAdvancing,
  tryReserveAdvancingSlot,
  tryReserveSwarmSlot,
  resetPatrolDispatchBudget,
  type ConcurrencyLimits,
  type RunningCounts,
} from '../../../src/lib/cloister/concurrency.js';

const LIMITS: ConcurrencyLimits = { maxWorkAgents: 6, reservedAdvancingSlots: 3, reservedSwarmSlots: 3, totalCeiling: 9, exemptOperatorStarted: true };

describe('concurrency governor — pure math', () => {
  it('reports free work slots below the cap', () => {
    const counts: RunningCounts = { work: 2, advancing: 1, swarm: 0, total: 3 };
    expect(workResumeSlotsAvailable(counts, LIMITS)).toBe(4);
  });

  it('reports zero slots at the cap (never negative)', () => {
    expect(workResumeSlotsAvailable({ work: 6, advancing: 0, swarm: 0, total: 6 }, LIMITS)).toBe(0);
    // Over the cap (e.g. forced starts) → still 0, never negative; deacon resumes nothing.
    expect(workResumeSlotsAvailable({ work: 9, advancing: 0, swarm: 0, total: 9 }, LIMITS)).toBe(0);
  });

  it('allows advancing dispatch until the total ceiling, using reserved headroom', () => {
    // Work at its cap but total below ceiling → advancing roles can still claim slots.
    expect(canDispatchAdvancing({ work: 6, advancing: 2, swarm: 0, total: 8 }, LIMITS)).toBe(true);
    expect(canDispatchAdvancing({ work: 6, advancing: 3, swarm: 0, total: 9 }, LIMITS)).toBe(false);
  });
});

describe('concurrency governor — swarm reserve (PAN-2212)', () => {
  it('lets the swarm dispatch its reserve even when work+advancing fill the ceiling', () => {
    // Pipeline full at the totalCeiling, but the dedicated swarm reserve is isolated —
    // a busy backlog must never starve the swarm to zero.
    const counts: RunningCounts = { work: 6, advancing: 3, swarm: 0, total: 9 };
    resetPatrolDispatchBudget();
    expect(tryReserveSwarmSlot(counts, LIMITS)).toBe(true);
    expect(tryReserveSwarmSlot(counts, LIMITS)).toBe(true);
    expect(tryReserveSwarmSlot(counts, LIMITS)).toBe(true);
    expect(tryReserveSwarmSlot(counts, LIMITS)).toBe(false); // reserve of 3 exhausted → defer, never fail
    resetPatrolDispatchBudget();
    expect(tryReserveSwarmSlot(counts, LIMITS)).toBe(true);  // budget cleared for the next patrol
  });

  it('counts already-running swarm slots against the reserve', () => {
    const counts: RunningCounts = { work: 0, advancing: 0, swarm: 2, total: 0 };
    resetPatrolDispatchBudget();
    expect(tryReserveSwarmSlot(counts, LIMITS)).toBe(true);  // 2 running + 0 reserved < 3
    expect(tryReserveSwarmSlot(counts, LIMITS)).toBe(false); // 2 + 1 >= 3 → defer
  });
});

describe('concurrency governor — config + counting', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../../src/lib/cloister/config.js');
    vi.doUnmock('../../../src/lib/agents.js');
    vi.doUnmock('../../../src/lib/overdeck/agents.js');
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
    expect(limits.exemptOperatorStarted).toBe(true); // defaults to true
  });

  it('counts status=running agents from the agents table, grouped into work vs advancing', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/agents.js', () => ({
      listRunningAgentsSync: () => [],
    }));
    vi.doMock('../../../src/lib/overdeck/agents.js', () => ({
      countAgentsByStatus: (status: string) => {
        if (status !== 'running') return {};
        return {
          work: 1,
          review: 1,
          ship: 1,
          plan: 1, // neither work nor advancing
        };
      },
    }));
    const { countRunningAgents } = await import('../../../src/lib/cloister/concurrency.js');
    expect(countRunningAgents()).toEqual({ work: 1, advancing: 2, swarm: 0, total: 3 });
  });

  it('reserves advancing slots up to the ceiling per patrol, then resets', () => {
    // PAN-2000: inject counts + limits directly instead of vi.doMock'ing config.js
    // and agents.js. The mock-based form flaked under the parallel run when the
    // doMock intermittently didn't apply (the real config/running-count leaked in),
    // mirroring the deterministic dependency-injection pattern the "pure math"
    // tests above already use. ceiling = max_work_agents (1) + reserved (1) = 2.
    const counts: RunningCounts = { work: 0, advancing: 0, swarm: 0, total: 0 }; // 0 running
    const limits: ConcurrencyLimits = { maxWorkAgents: 1, reservedAdvancingSlots: 1, reservedSwarmSlots: 3, totalCeiling: 2, exemptOperatorStarted: true };

    resetPatrolDispatchBudget();
    expect(tryReserveAdvancingSlot(counts, limits)).toBe(true);  // 0 running + 0 reserved < 2
    expect(tryReserveAdvancingSlot(counts, limits)).toBe(true);  // 0 + 1 < 2
    expect(tryReserveAdvancingSlot(counts, limits)).toBe(false); // 0 + 2 >= 2 → defer
    resetPatrolDispatchBudget();
    expect(tryReserveAdvancingSlot(counts, limits)).toBe(true);  // budget cleared for the next patrol
  });

  it('emergency brake stops excess work agents idle-first and clears stoppedByUser', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/cloister/config.js', () => ({
      loadCloisterConfigSync: () => ({ concurrency: { max_work_agents: 2, reserved_advancing_slots: 1, exempt_operator_started: false } }),
    }));
    const states: Record<string, { id: string; stoppedByUser?: boolean }> = {
      'agent-a': { id: 'agent-a' }, 'agent-b': { id: 'agent-b' },
      'agent-c': { id: 'agent-c' }, 'agent-d': { id: 'agent-d' },
    };
    const saved: Record<string, { id: string; stoppedByUser?: boolean }> = {};
    const idle = new Set(['agent-c', 'agent-d']);
    vi.doMock('../../../src/lib/agents.js', () => ({
      listRunningAgentsSync: () => [
        { id: 'agent-a', role: 'work', tmuxActive: true, lastActivity: '2026-01-01T00:00:00Z' }, // active
        { id: 'agent-b', role: 'work', tmuxActive: true, lastActivity: '2026-01-03T00:00:00Z' }, // active
        { id: 'agent-c', role: 'work', tmuxActive: true, lastActivity: '2026-01-02T00:00:00Z' }, // idle
        { id: 'agent-d', role: 'work', tmuxActive: true, lastActivity: '2026-01-04T00:00:00Z' }, // idle
      ],
      stopAgentSync: (id: string) => { states[id].stoppedByUser = true; },
      getAgentStateSync: (id: string) => states[id],
      saveAgentStateSync: (s: { id: string }) => { saved[s.id] = states[s.id]; },
      getAgentRuntimeStateSync: (id: string) => ({ state: idle.has(id) ? 'idle' : 'active' }),
    }));
    const { emergencyBrake } = await import('../../../src/lib/cloister/concurrency.js');

    const result = emergencyBrake();

    // 4 running, cap 2 → stop the 2 idle ones first.
    expect(result.before).toBe(4);
    expect(result.cap).toBe(2);
    expect(result.remaining).toBe(2);
    expect(result.stopped).toEqual(['agent-c', 'agent-d']);
    // stoppedByUser cleared so the deacon re-admits them as slots free.
    expect(saved['agent-c'].stoppedByUser).toBeUndefined();
    expect(saved['agent-d'].stoppedByUser).toBeUndefined();
  });

  it('emergency brake is a no-op when within the cap', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/cloister/config.js', () => ({
      loadCloisterConfigSync: () => ({ concurrency: { max_work_agents: 6, reserved_advancing_slots: 3 } }),
    }));
    vi.doMock('../../../src/lib/agents.js', () => ({
      listRunningAgentsSync: () => [{ id: 'agent-a', role: 'work', tmuxActive: true }],
      stopAgentSync: () => { throw new Error('should not stop anything'); },
      getAgentStateSync: () => null,
      saveAgentStateSync: () => {},
      getAgentRuntimeStateSync: () => null,
    }));
    const { emergencyBrake } = await import('../../../src/lib/cloister/concurrency.js');
    expect(emergencyBrake()).toEqual({ before: 1, cap: 6, stopped: [], remaining: 1 });
  });

  it('emergency brake skips operator-started agents when exemptOperatorStarted is true (PAN-1812)', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/cloister/config.js', () => ({
      loadCloisterConfigSync: () => ({ concurrency: { max_work_agents: 2, reserved_advancing_slots: 1, exempt_operator_started: true } }),
    }));
    const states: Record<string, { id: string; stoppedByUser?: boolean }> = {
      'agent-fly-a': { id: 'agent-fly-a' },
      'agent-op-b': { id: 'agent-op-b' },
      'agent-op-c': { id: 'agent-op-c' },
    };
    vi.doMock('../../../src/lib/agents.js', () => ({
      listRunningAgentsSync: () => [
        { id: 'agent-fly-a', role: 'work', tmuxActive: true, flywheelRunId: 'RUN-1', lastActivity: '2026-01-01T00:00:00Z' },
        { id: 'agent-op-b', role: 'work', tmuxActive: true, lastActivity: '2026-01-02T00:00:00Z' },
        { id: 'agent-op-c', role: 'work', tmuxActive: true, lastActivity: '2026-01-03T00:00:00Z' },
      ],
      stopAgentSync: (id: string) => { states[id].stoppedByUser = true; },
      getAgentStateSync: (id: string) => states[id],
      saveAgentStateSync: (s: { id: string }) => { states[s.id] = states[s.id]; },
      getAgentRuntimeStateSync: (id: string) => ({ state: 'active' }),
    }));
    const { emergencyBrake } = await import('../../../src/lib/cloister/concurrency.js');

    const result = emergencyBrake();

    expect(result.before).toBe(3);
    expect(result.stopped).toEqual(['agent-fly-a']);
    expect(result.remaining).toBe(2);
  });
});
