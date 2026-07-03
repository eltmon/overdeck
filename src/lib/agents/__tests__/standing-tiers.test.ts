import { describe, expect, it, vi } from 'vitest';
import type { VBriefDifficulty, VBriefDocument, VBriefItem } from '../../vbrief/types.js';
import type { AgentState } from '../agent-state.js';
import type { ResolveTierConfig } from '../resolve-tier.js';
import { ResolveTierError } from '../resolve-tier.js';
import {
  computeTierRunSchedule,
  StandingTierError,
  StandingTierManager,
  tiersNeededForSchedule,
  type StandingTierSpawn,
  type TierRun,
} from '../standing-tiers.js';

const TIER_CONFIG: ResolveTierConfig = {
  tiers: {
    cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
    standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
    frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
  },
  difficultyToTier: {
    trivial: 'cheap',
    simple: 'cheap',
    medium: 'standard',
    complex: 'standard',
    expert: 'frontier',
  },
};

function planItem(id: string, difficulty: VBriefDifficulty): VBriefItem {
  return { id, title: id, status: 'pending', metadata: { difficulty } };
}

function doc(items: VBriefItem[], edges: Array<{ from: string; to: string }> = []): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
    plan: {
      id: 'plan-1',
      title: 'test plan',
      status: 'running',
      items,
      edges: edges.map((edge) => ({ ...edge, type: 'blocks' as const })),
    },
  };
}

function fakeSpawn(): { spawn: StandingTierSpawn; calls: Array<{ issueId: string; role: string; options: Record<string, unknown> }> } {
  const calls: Array<{ issueId: string; role: string; options: Record<string, unknown> }> = [];
  const spawn: StandingTierSpawn = vi.fn(async (issueId, role, options) => {
    calls.push({ issueId, role, options: options as Record<string, unknown> });
    return { id: `agent-${issueId.toLowerCase()}-slot-${options.slotIndex}` } as AgentState;
  });
  return { spawn, calls };
}

describe('computeTierRunSchedule', () => {
  it('cuts runs at tier-change boundaries following wave order', () => {
    const plan = doc(
      [
        planItem('a', 'trivial'),
        planItem('b', 'simple'),
        planItem('c', 'expert'),
        planItem('d', 'medium'),
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ],
    );

    expect(computeTierRunSchedule(plan, TIER_CONFIG)).toEqual([
      { tierName: 'cheap', beadIds: ['a', 'b'] },
      { tierName: 'frontier', beadIds: ['c'] },
      { tierName: 'standard', beadIds: ['d'] },
    ]);
  });

  it('propagates a named error for an unroutable item instead of falling back', () => {
    const plan = doc([{ id: 'a', title: 'a', status: 'pending', metadata: {} }]);
    expect(() => computeTierRunSchedule(plan, TIER_CONFIG)).toThrow(ResolveTierError);
  });
});

describe('tiersNeededForSchedule', () => {
  it('returns exactly the tier names the schedule contains, deduplicated in order', () => {
    const schedule: TierRun[] = [
      { tierName: 'cheap', beadIds: ['a'] },
      { tierName: 'frontier', beadIds: ['b'] },
      { tierName: 'cheap', beadIds: ['c'] },
    ];
    expect(tiersNeededForSchedule(schedule)).toEqual(['cheap', 'frontier']);
  });
});

describe('StandingTierManager', () => {
  const SCHEDULE: TierRun[] = [
    { tierName: 'cheap', beadIds: ['a', 'b'] },
    { tierName: 'standard', beadIds: ['c'] },
    { tierName: 'frontier', beadIds: ['d'] },
  ];

  it('reports exactly the scheduled tiers and never spawns a tier absent from the schedule', async () => {
    const { spawn, calls } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: 'PAN-1', schedule: SCHEDULE, spawn });

    expect(manager.tiersNeeded()).toEqual(['cheap', 'standard', 'frontier']);

    await manager.ensureStandingTiersForRun(99);
    expect(calls.map((call) => call.options.slotItemId)).toEqual(['a', 'c', 'd']);

    await expect(manager.ensureStandingAgentForTier('unscheduled', { id: 'x' })).rejects.toThrow(StandingTierError);
    expect(calls).toHaveLength(3);
  });

  it('spawns a tier lazily when its first run is within one run, and not before', async () => {
    const { spawn, calls } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: 'PAN-1', schedule: SCHEDULE, spawn });

    await manager.ensureStandingTiersForRun(0);
    expect(calls.map((call) => call.options.slotItemId)).toEqual(['a', 'c']);
    expect(manager.getStandingAgent('frontier')).toBeUndefined();

    await manager.ensureStandingTiersForRun(1);
    expect(calls.map((call) => call.options.slotItemId)).toEqual(['a', 'c', 'd']);
  });

  it('reuses a spawned standing session for subsequent beads instead of respawning', async () => {
    const { spawn, calls } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: 'PAN-1', schedule: SCHEDULE, spawn });

    const first = await manager.ensureStandingAgentForTier('cheap', { id: 'a' });
    const second = await manager.ensureStandingAgentForTier('cheap', { id: 'b' });

    expect(first).toBe(second);
    expect(calls).toHaveLength(1);

    await manager.ensureStandingTiersForRun(0);
    expect(calls.map((call) => call.options.slotItemId)).toEqual(['a', 'c']);
  });

  it('routes a bead through the registered-slot spawn path and returns that slot agent id', async () => {
    const { spawn, calls } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: 'PAN-1', schedule: SCHEDULE, spawn, firstSlotIndex: 7 });

    const agentId = await manager.ensureStandingAgentForTier('standard', { id: 'c' });

    expect(agentId).toBe('agent-pan-1-slot-7');
    expect(calls).toEqual([
      {
        issueId: 'PAN-1',
        role: 'work',
        options: { slotIndex: 7, slotItemId: 'c', prompt: undefined },
      },
    ]);
    expect(manager.getStandingAgent('standard')).toEqual({
      tierName: 'standard',
      slotIndex: 7,
      agentId: 'agent-pan-1-slot-7',
      firstItemId: 'c',
    });
  });

  it('enforces the single-implementer invariant: a second dispatch before completeBead throws', async () => {
    const { spawn } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: 'PAN-1', schedule: SCHEDULE, spawn });

    const agentId = await manager.dispatchBeadToTier('cheap', { id: 'a' });
    expect(manager.getInFlightBead()).toEqual({ beadId: 'a', tierName: 'cheap', agentId });

    await expect(manager.dispatchBeadToTier('cheap', { id: 'b' })).rejects.toThrow(
      'only one implementation agent works a bead at a time',
    );
    await expect(manager.dispatchBeadToTier('standard', { id: 'c' })).rejects.toThrow(StandingTierError);

    manager.completeBead('a');
    expect(manager.getInFlightBead()).toBeUndefined();
    await expect(manager.dispatchBeadToTier('cheap', { id: 'b' })).resolves.toBe(agentId);
  });

  it('rejects completing a bead that is not the in-flight bead', async () => {
    const { spawn } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: 'PAN-1', schedule: SCHEDULE, spawn });

    expect(() => manager.completeBead('a')).toThrow(StandingTierError);

    await manager.dispatchBeadToTier('cheap', { id: 'a' });
    expect(() => manager.completeBead('b')).toThrow(StandingTierError);
    manager.completeBead('a');
  });

  it('allocates distinct slot indexes per tier starting at firstSlotIndex', async () => {
    const { spawn, calls } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: 'PAN-1', schedule: SCHEDULE, spawn, firstSlotIndex: 3 });

    await manager.ensureStandingTiersForRun(99);

    expect(calls.map((call) => call.options.slotIndex)).toEqual([3, 4, 5]);
    expect(manager.getStandingAgent('cheap')?.agentId).toBe('agent-pan-1-slot-3');
    expect(manager.getStandingAgent('frontier')?.agentId).toBe('agent-pan-1-slot-5');
  });
});
