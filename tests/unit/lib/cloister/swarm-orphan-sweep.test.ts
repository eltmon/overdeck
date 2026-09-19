import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

/**
 * PAN-3917 FR-11: swarm orphan-slot GC is the one half of the old
 * `swarmJanitorPass` that is hygiene rather than pipeline machinery, and it now
 * runs on its own hygiene interval. Its liveness evidence is the SELECTED
 * backend's inventory: under Herdr a live slot agent has no tmux session, and
 * GC must never delete a worktree an agent is still working in.
 */

const mocks = vi.hoisted(() => ({
  listLiveAgentIds: vi.fn(),
  listFeatureWorkspaces: vi.fn(),
  findSpecByIssue: vi.fn(),
  reconcileSlotState: vi.fn(),
  listSlotAssignments: vi.fn(() => []),
  gcOrphanedSlots: vi.fn(async () => [] as string[]),
}));

vi.mock('../../../../src/lib/terminal-backends/inventory.js', () => ({
  listLiveAgentIds: mocks.listLiveAgentIds,
}));
vi.mock('../../../../src/lib/cloister/deacon-workspaces.js', () => ({
  listFeatureWorkspaces: mocks.listFeatureWorkspaces,
}));
vi.mock('../../../../src/lib/pan-dir/specs.js', () => ({
  findSpecByIssue: mocks.findSpecByIssue,
}));
vi.mock('../../../../src/lib/cloister/swarm-slot-reconcile.js', () => ({
  reconcileSlotState: mocks.reconcileSlotState,
  listSlotAssignments: mocks.listSlotAssignments,
}));
vi.mock('../../../../src/lib/cloister/deacon-swarm-orphan-gc.js', () => ({
  gcOrphanedSlots: mocks.gcOrphanedSlots,
}));

const { sweepOrphanedSwarmSlots } = await import('../../../../src/lib/cloister/swarm-orphan-sweep.js');

describe('sweepOrphanedSwarmSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFeatureWorkspaces.mockReturnValue([
      { issueId: 'pan-2203', projectPath: '/project', workspacePath: '/project/workspaces/feature-pan-2203' },
    ]);
    mocks.findSpecByIssue.mockReturnValue(Effect.succeed({ document: { plan: { items: [] } } }));
    mocks.reconcileSlotState.mockResolvedValue({ merged: [], inFlight: [], branches: [], agents: [] });
    mocks.gcOrphanedSlots.mockResolvedValue(['[swarm] gc-orphan slot 2 for PAN-2203']);
  });

  it('passes the backend inventory in as the live-agent list', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(new Set(['agent-pan-2203-slot-1']));

    const actions = await sweepOrphanedSwarmSlots();

    expect(actions).toEqual(['[swarm] gc-orphan slot 2 for PAN-2203']);
    const deps = mocks.gcOrphanedSlots.mock.calls[0]![3] as { listSessionNames: () => Promise<string[]> };
    await expect(deps.listSessionNames()).resolves.toEqual(['agent-pan-2203-slot-1']);
  });

  it('skips the whole sweep when the backend inventory cannot be read', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(null);

    await expect(sweepOrphanedSwarmSlots()).resolves.toEqual([]);
    expect(mocks.gcOrphanedSlots).not.toHaveBeenCalled();
  });

  it('reports a per-issue failure instead of aborting the sweep', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(new Set<string>());
    mocks.reconcileSlotState.mockRejectedValue(new Error('git worktree list failed'));

    const actions = await sweepOrphanedSwarmSlots();

    expect(actions[0]).toContain('orphan GC for PAN-2203 failed');
  });
});
