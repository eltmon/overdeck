import { describe, expect, it, vi } from 'vitest';
import {
  allocateSlotIndex,
  dispatchNextWave,
  registeredSlotCapacityAvailable,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import { countRunningSwarmSlotsForIssue } from '../../../../src/lib/cloister/concurrency.js';
import type { ReconciledSlotItem, SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';
import { analyzeSwarmReadiness } from '../../../../src/lib/vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

function item(id: string, filesScope: string[]): VBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    metadata: {
      readiness: 'ready',
      files_scope: filesScope,
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function doc(items: VBriefItem[]): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      author: 'test',
      description: 'test plan',
    },
    plan: {
      id: 'pan-2203',
      title: 'test plan',
      status: 'active',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      items,
      edges: [],
    },
  };
}

function reconciled(overrides: Partial<SlotReconcileResult> = {}): SlotReconcileResult {
  return {
    issueId: 'PAN-2203',
    merged: [],
    inFlight: [],
    pending: [],
    branches: [],
    agents: [],
    ...overrides,
  };
}

function mergedSlot(itemId: string, slotIndex = 1): ReconciledSlotItem {
  return {
    itemId,
    slotIndex,
    status: 'merged',
    branch: `feature/pan-2203-slot-${slotIndex}`,
    agentId: `agent-pan-2203-slot-${slotIndex}`,
  };
}

type DispatchTestDeps = Pick<
  CoordinateSwarmSlotsDeps,
  'registeredSlotCapacityAvailable'
  | 'tryReserveSwarmSlot'
  | 'releaseSwarmSlot'
  | 'applyTaskOperationToPlanFile'
  | 'recordSlotAssignment'
  | 'clearSlotAssignment'
  | 'spawnRun'
  | 'shouldDispatch'
  | 'getMaxSlotIndex'
  | 'listSlotAssignments'
  | 'listSessionNames'
  | 'slotWorktreeExists'
>;

function deps(overrides: Partial<DispatchTestDeps> = {}): DispatchTestDeps {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    spawnRun: vi.fn(async () => undefined),
    shouldDispatch: vi.fn(() => true),
    getMaxSlotIndex: vi.fn(() => 4),
    listSlotAssignments: vi.fn(() => []),
    listSessionNames: vi.fn(async () => []),
    slotWorktreeExists: vi.fn(() => false),
    ...overrides,
  };
}

describe('deacon-swarm next-wave dispatch', () => {
  it('dispatches two non-overlapping items into distinct slots when capacity is free', async () => {
    const plan = doc([
      item('wi-a', ['src/a.ts']),
      item('wi-b', ['src/b.ts']),
    ]);
    const fakeDeps = deps();

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled(),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual([
      '[swarm] dispatched implementation slot 1 (item wi-a) for PAN-2203',
      '[swarm] dispatched implementation slot 2 (item wi-b) for PAN-2203',
    ]);

    expect(fakeDeps.spawnRun).toHaveBeenCalledTimes(2);
    expect(fakeDeps.recordSlotAssignment).toHaveBeenNthCalledWith(
      1,
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      {
        slotIndex: 1,
        itemId: 'wi-a',
        agentId: 'agent-pan-2203-slot-1',
        branch: 'feature/pan-2203-slot-1',
      },
    );
    expect(fakeDeps.recordSlotAssignment).toHaveBeenNthCalledWith(
      2,
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      {
        slotIndex: 2,
        itemId: 'wi-b',
        agentId: 'agent-pan-2203-slot-2',
        branch: 'feature/pan-2203-slot-2',
      },
    );
    expect(fakeDeps.spawnRun).toHaveBeenNthCalledWith(1, 'PAN-2203', 'work', {
      workspace: '/repo/workspaces/feature-pan-2203',
      slotIndex: 1,
      slotItemId: 'wi-a',
    });
    expect(fakeDeps.spawnRun).toHaveBeenNthCalledWith(2, 'PAN-2203', 'work', {
      workspace: '/repo/workspaces/feature-pan-2203',
      slotIndex: 2,
      slotItemId: 'wi-b',
    });
  });

  it('defers an item whose files_scope overlaps a running or selected item', async () => {
    const plan = doc([
      item('wi-a', ['src/shared.ts']),
      item('wi-b', ['src/shared.ts']),
    ]);
    const fakeDeps = deps();

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled(),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual([
      '[swarm] dispatched implementation slot 1 (item wi-a) for PAN-2203',
      '[swarm] deferred wi-b for PAN-2203: files_scope overlaps wi-a',
    ]);

    expect(fakeDeps.spawnRun).toHaveBeenCalledTimes(1);
  });

  it('defers dispatch when the registered slot cap is reached', async () => {
    const plan = doc([item('wi-a', ['src/a.ts'])]);
    const fakeDeps = deps({
      registeredSlotCapacityAvailable: vi.fn(() => false),
    });

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled(),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual(['[swarm] deferred wi-a for PAN-2203: registered slot cap reached']);

    expect(fakeDeps.spawnRun).not.toHaveBeenCalled();
    expect(fakeDeps.tryReserveSwarmSlot).not.toHaveBeenCalled();
  });

  it('releases the item claim and advancing-slot budget when spawnRun throws', async () => {
    const plan = doc([item('wi-a', ['src/a.ts'])]);
    const fakeDeps = deps({
      spawnRun: vi.fn(async () => {
        throw new Error('spawn failed');
      }),
    });

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled({ merged: [mergedSlot('wi-parent')] }),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual(['[swarm] failed-dispatch wi-a for PAN-2203: spawn failed']);

    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenNthCalledWith(
      1,
      '/repo/workspaces/feature-pan-2203/.pan/spec.vbrief.json',
      { type: 'claim', itemId: 'wi-a', writerId: 'deacon-swarm' },
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenNthCalledWith(
      2,
      '/repo/workspaces/feature-pan-2203/.pan/spec.vbrief.json',
      {
        type: 'unblock',
        itemId: 'wi-a',
        writerId: 'deacon-swarm',
        reason: 'slot dispatch failed: spawn failed',
      },
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      1,
      'wi-a',
    );
    expect(fakeDeps.releaseSwarmSlot).toHaveBeenCalledTimes(1);
  });
});

describe('bounded slot index allocation (PAN-2214 slot-5..slot-20 climb regression)', () => {
  it('allocateSlotIndex returns the lowest free index and null when 1..bound are occupied, across permutations', () => {
    const bound = 3;
    const universe = [1, 2, 3, 4, 5, 17];
    // Every subset of occupied indexes (including ones above the bound).
    for (let mask = 0; mask < 1 << universe.length; mask++) {
      const occupied = new Set(universe.filter((_, bit) => mask & (1 << bit)));
      const result = allocateSlotIndex(occupied, bound);
      let expected: number | null = null;
      for (let index = 1; index <= bound; index++) {
        if (!occupied.has(index)) { expected = index; break; }
      }
      expect(result, `occupied={${[...occupied].join(',')}}`).toBe(expected);
      if (result !== null) {
        expect(result).toBeLessThanOrEqual(bound);
        expect(result).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('an orphaned slot worktree occupies its index and dispatch spawns on the next free index (PAN-2213)', async () => {
    const plan = doc([item('wi-a', ['src/a.ts'])]);
    // Worktree on disk at slot 2 with no assignment, agent, or branch entry.
    const fakeDeps = deps({
      slotWorktreeExists: vi.fn((path: string) => path === '/repo/workspaces/feature-pan-2203-slot-2'),
    });

    const actions = await dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled({ branches: [{ slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false }] }),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    );

    expect(actions).toEqual(['[swarm] dispatched implementation slot 3 (item wi-a) for PAN-2203']);
    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({ slotIndex: 3 }));
  });

  it('durable slot assignments and merged branches occupy their indexes even when the registry is empty', async () => {
    const plan = doc([item('wi-a', ['src/a.ts'])]);
    const fakeDeps = deps({
      listSlotAssignments: vi.fn(() => [{ slotIndex: 1 }]),
    });

    const actions = await dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled({ branches: [{ slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: true }] }),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    );

    expect(actions).toEqual(['[swarm] dispatched implementation slot 3 (item wi-a) for PAN-2203']);
  });

  it('never spawns or assigns an index above the bound even under an inconsistent registry', async () => {
    const plan = doc([
      item('wi-a', ['src/a.ts']),
      item('wi-b', ['src/b.ts']),
      item('wi-c', ['src/c.ts']),
    ]);
    const fakeDeps = deps({
      getMaxSlotIndex: vi.fn(() => 2),
      // Registry misses these live sessions entirely — the conflict probe finds them.
      listSessionNames: vi.fn(async () => ['agent-pan-2203-slot-1']),
    });

    const actions = await dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled(),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    );

    for (const call of vi.mocked(fakeDeps.spawnRun).mock.calls) {
      expect((call[2] as { slotIndex: number }).slotIndex).toBeLessThanOrEqual(2);
    }
    for (const call of vi.mocked(fakeDeps.recordSlotAssignment).mock.calls) {
      expect((call[2] as { slotIndex: number }).slotIndex).toBeLessThanOrEqual(2);
    }
    expect(fakeDeps.spawnRun).toHaveBeenCalledTimes(1);
    expect(actions).toContain('[swarm] slot 1 occupied for PAN-2203: live agent-pan-2203-slot-1 session already exists — advancing');
    expect(actions).toContain('[swarm] dispatched implementation slot 2 (item wi-a) for PAN-2203');
  });

  it('defers the wave naming the occupying slots when all bounded indexes are occupied', async () => {
    const plan = doc([item('wi-a', ['src/a.ts']), item('wi-b', ['src/b.ts'])]);
    const fakeDeps = deps({ getMaxSlotIndex: vi.fn(() => 2) });

    const actions = await dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled({
        branches: [
          { slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false },
          { slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false },
        ],
      }),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    );

    expect(actions).toEqual([
      '[swarm] deferred wi-a for PAN-2203: all slot indexes 1..2 are occupied (slots 1, 2) — run `pan swarm reset PAN-2203` if these slots are orphans',
    ]);
    expect(fakeDeps.spawnRun).not.toHaveBeenCalled();
    expect(fakeDeps.recordSlotAssignment).not.toHaveBeenCalled();
    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
  });
});

type RunningAgentRow = Parameters<typeof countRunningSwarmSlotsForIssue>[1] extends (infer R)[] | undefined ? R : never;

function agentRow(id: string, tmuxActive: boolean): RunningAgentRow {
  return { id, role: 'work', status: 'running', tmuxActive } as unknown as RunningAgentRow;
}

describe('registered slot capacity (PAN-2214 cap-reached-at-zero-live-slots regression)', () => {
  const limits = { reservedSwarmSlots: 3 };

  it('stale running rows with dead tmux sessions do not consume capacity', () => {
    const stale = [
      agentRow('agent-pan-1791-slot-5', false),
      agentRow('agent-pan-1791-slot-6', false),
      agentRow('agent-pan-1791-slot-7', false),
    ];

    const live = countRunningSwarmSlotsForIssue('PAN-1791', stale);

    expect(live).toBe(0);
    expect(registeredSlotCapacityAvailable('PAN-1791', 0, live, limits)).toBe(true);
  });

  it('K tmux-alive slots against reservedSwarmSlots=K exhausts capacity; K-1 leaves room', () => {
    const alive = [
      agentRow('agent-pan-1791-slot-1', true),
      agentRow('agent-pan-1791-slot-2', true),
      agentRow('agent-pan-1791-slot-3', true),
    ];

    expect(registeredSlotCapacityAvailable(
      'PAN-1791', 0, countRunningSwarmSlotsForIssue('PAN-1791', alive), limits,
    )).toBe(false);
    expect(registeredSlotCapacityAvailable(
      'PAN-1791', 0, countRunningSwarmSlotsForIssue('PAN-1791', alive.slice(0, 2)), limits,
    )).toBe(true);
  });

  it('other issues\' live slots and same-wave selections count correctly', () => {
    const alive = [
      agentRow('agent-pan-1791-slot-1', true),
      agentRow('agent-pan-9999-slot-1', true),
    ];

    const live = countRunningSwarmSlotsForIssue('PAN-1791', alive);

    expect(live).toBe(1);
    expect(registeredSlotCapacityAvailable('PAN-1791', 1, live, limits)).toBe(true);
    expect(registeredSlotCapacityAvailable('PAN-1791', 2, live, limits)).toBe(false);
  });

  it('capacity respects reservedSwarmSlots only — raising maxWorkAgents changes nothing', () => {
    const alive = [
      agentRow('agent-pan-1791-slot-1', true),
      agentRow('agent-pan-1791-slot-2', true),
    ];
    const live = countRunningSwarmSlotsForIssue('PAN-1791', alive);
    const base = {
      maxWorkAgents: 4,
      reservedAdvancingSlots: 2,
      reservedSwarmSlots: 2,
      totalCeiling: 6,
      exemptOperatorStarted: true,
    };

    expect(registeredSlotCapacityAvailable('PAN-1791', 0, live, base)).toBe(false);
    expect(registeredSlotCapacityAvailable('PAN-1791', 0, live, { ...base, maxWorkAgents: 40, totalCeiling: 42 })).toBe(false);
  });
});
