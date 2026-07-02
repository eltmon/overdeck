import { describe, expect, it, vi } from 'vitest';
import { gcMergedSlots, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem } from '../../../../src/lib/agents/slot-reconcile.js';

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

function deps(sessionNames: string[] = []): Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'clearSlotAssignment' | 'listSessionNames'> {
  return {
    runGitCommand: vi.fn(async () => undefined),
    clearSlotAssignment: vi.fn(),
    listSessionNames: vi.fn(async () => sessionNames),
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
});
