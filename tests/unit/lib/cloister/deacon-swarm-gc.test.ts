import { describe, expect, it, vi } from 'vitest';
import { gcMergedSlots, gcOrphanedSlots, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem, SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';

function slot(overrides: Partial<ReconciledSlotItem> = {}): ReconciledSlotItem {
  return {
    itemId: 'wi-1',
    slotIndex: 1,
    status: 'merged',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    ...overrides,
  };
}

function deps(sessionNames: string[] = [], options: { worktreeExists?: boolean } = {}): Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'clearSlotAssignment' | 'listSessionNames' | 'slotWorktreeExists'> {
  return {
    runGitCommand: vi.fn(async () => undefined),
    clearSlotAssignment: vi.fn(),
    listSessionNames: vi.fn(async () => sessionNames),
    slotWorktreeExists: vi.fn(() => options.worktreeExists ?? true),
  };
}

describe('deacon-swarm merged slot GC', () => {
  it('removes a merged slot worktree and slot branch', async () => {
    const fakeDeps = deps();

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git worktree remove --force "/repo/workspaces/feature-pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      1,
      'wi-1',
    );
  });

  it('preserves running and failed-merge slots', async () => {
    const fakeDeps = deps();

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [
      slot({ itemId: 'wi-running', slotIndex: 2, status: 'in_flight', branch: 'feature/pan-2203-slot-2' }),
      slot({ itemId: 'wi-failed', slotIndex: 3, status: 'in_flight', branch: 'feature/pan-2203-slot-3' }),
    ], fakeDeps)).resolves.toEqual([]);

    expect(fakeDeps.runGitCommand).not.toHaveBeenCalled();
  });

  it('falls back to the conventional slot branch name when reconcile omits a branch', async () => {
    const fakeDeps = deps();

    await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [
      slot({ branch: undefined }),
    ], fakeDeps);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
  });

  it('never destroys a slot whose agent session is alive (fresh branch misdetected as merged)', async () => {
    const fakeDeps = deps(['agent-pan-2203-slot-1']);

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc skipped slot 1 (item wi-1) for PAN-2203: agent session alive']);

    expect(fakeDeps.runGitCommand).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('guards by conventional agent id when reconcile lost the agentId', async () => {
    const fakeDeps = deps(['agent-pan-2203-slot-4']);

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [
      slot({ slotIndex: 4, itemId: 'wi-4', branch: 'feature/pan-2203-slot-4', agentId: undefined }),
    ], fakeDeps)).resolves.toEqual(['[swarm] gc skipped slot 4 (item wi-4) for PAN-2203: agent session alive']);

    expect(fakeDeps.runGitCommand).not.toHaveBeenCalled();
  });

  it('still gcs a merged slot whose session has ended', async () => {
    const fakeDeps = deps(['agent-pan-2203-slot-9']);

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      1,
      'wi-1',
    );
  });

  it('skips the worktree remove when no worktree exists (branch-only merged slot)', async () => {
    const fakeDeps = deps([], { worktreeExists: false });

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledTimes(1);
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalled();
  });

  it('degrades a worktree-remove failure to a deferred action instead of throwing', async () => {
    const fakeDeps = deps();
    fakeDeps.runGitCommand = vi.fn(async (command: string) => {
      if (command.startsWith('git worktree remove')) throw new Error('worktree is dirty');
      return undefined;
    });

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps);

    expect(actions).toEqual([
      '[swarm] gc deferred slot 1 (item wi-1) for PAN-2203: worktree remove failed: worktree is dirty',
    ]);
    expect(fakeDeps.runGitCommand).toHaveBeenCalledTimes(1);
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('keeps the assignment when the branch delete fails so reconcile still sees the slot', async () => {
    const fakeDeps = deps([], { worktreeExists: false });
    fakeDeps.runGitCommand = vi.fn(async () => {
      throw new Error('branch is checked out');
    });

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps);

    expect(actions).toEqual([
      '[swarm] gc deferred slot 1 (item wi-1) for PAN-2203: branch delete failed: branch is checked out',
    ]);
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });
});

describe('deacon-swarm orphaned slot GC', () => {
  const workspacePath = '/repo/workspaces/feature-pan-2203';

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

  function orphanDeps(options: {
    worktreeSlotIndexes?: number[];
    aheadCountByBranch?: Record<string, string>;
    sessionNames?: string[];
    slotAssignments?: Array<{ slotIndex: number; itemId: string }>;
  } = {}): Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'listSessionNames' | 'listSlotAssignments'> {
    return {
      runGitCommand: vi.fn(async (command: string) => {
        if (command === 'git worktree list --porcelain') {
          const lines = [`worktree ${workspacePath}`, ''];
          for (const slotIndex of options.worktreeSlotIndexes ?? []) {
            lines.push(`worktree ${workspacePath}-slot-${slotIndex}`, '');
          }
          return { stdout: lines.join('\n') };
        }
        for (const [branch, count] of Object.entries(options.aheadCountByBranch ?? {})) {
          if (command === `git rev-list --count HEAD..${JSON.stringify(branch)}`) return { stdout: `${count}\n` };
        }
        return undefined;
      }),
      listSessionNames: vi.fn(async () => options.sessionNames ?? []),
      listSlotAssignments: vi.fn(() => options.slotAssignments ?? []),
    };
  }

  it('removes an orphaned slot worktree and branch with zero commits ahead', async () => {
    const fakeDeps = orphanDeps({
      worktreeSlotIndexes: [2],
      aheadCountByBranch: { 'feature/pan-2203-slot-2': '0' },
    });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [{ slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false }],
    }), fakeDeps)).resolves.toEqual(['[swarm] gc-orphan slot 2 for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git worktree remove --force "${workspacePath}-slot-2"`,
      workspacePath,
    );
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-2"',
      workspacePath,
    );
  });

  it('preserves an orphaned branch with unmerged commits and points at pan swarm reset', async () => {
    const fakeDeps = orphanDeps({
      worktreeSlotIndexes: [2],
      aheadCountByBranch: { 'feature/pan-2203-slot-2': '3' },
    });

    const actions = await gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [{ slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false }],
    }), fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('feature/pan-2203-slot-2');
    expect(actions[0]).toContain('3 unmerged commit(s)');
    expect(actions[0]).toContain('pan swarm reset PAN-2203');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });

  it('preserves an orphaned branch report-only when the ahead count cannot be determined', async () => {
    const fakeDeps = orphanDeps({ worktreeSlotIndexes: [2] });
    vi.mocked(fakeDeps.runGitCommand).mockImplementation(async (command: string) => {
      if (command === 'git worktree list --porcelain') {
        return { stdout: `worktree ${workspacePath}\n\nworktree ${workspacePath}-slot-2\n` };
      }
      if (command.startsWith('git rev-list')) throw new Error('unknown revision');
      return undefined;
    });

    const actions = await gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [{ slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false }],
    }), fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('pan swarm reset PAN-2203');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });

  it('removes an orphaned worktree that has no local branch left', async () => {
    const fakeDeps = orphanDeps({ worktreeSlotIndexes: [4] });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled(), fakeDeps))
      .resolves.toEqual(['[swarm] gc-orphan slot 4 for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git worktree remove --force "${workspacePath}-slot-4"`,
      workspacePath,
    );
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('branch -D'))).toBe(false);
  });

  it('sends zero deletion commands for slots with a live agent session or a slotAssignments entry', async () => {
    const fakeDeps = orphanDeps({
      worktreeSlotIndexes: [1, 3],
      sessionNames: ['agent-pan-2203-slot-1'],
      slotAssignments: [{ slotIndex: 3, itemId: 'wi-3' }],
    });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [
        { slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false },
        { slotIndex: 3, branch: 'feature/pan-2203-slot-3', merged: false },
      ],
    }), fakeDeps)).resolves.toEqual([]);

    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });

  it('skips slots handled by merged-slot GC in the same cycle', async () => {
    const fakeDeps = orphanDeps({
      aheadCountByBranch: { 'feature/pan-2203-slot-5': '0' },
    });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      merged: [slot({ itemId: 'wi-5', slotIndex: 5, status: 'merged', branch: 'feature/pan-2203-slot-5' })],
      branches: [{ slotIndex: 5, branch: 'feature/pan-2203-slot-5', merged: true }],
    }), fakeDeps)).resolves.toEqual([]);

    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });
});
