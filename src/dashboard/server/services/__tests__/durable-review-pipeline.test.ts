import { describe, expect, it, vi } from 'vitest';

import { startDashboardDurableReviewPipeline } from '../durable-review-pipeline.js';

describe('startDashboardDurableReviewPipeline', () => {
  it('preserves remote workspace information through verification, push, and review', async () => {
    const workspace = {
      issueId: 'PAN-3135-REMOTE',
      workspacePath: '/workspace/remote',
      workspaceInfo: { isRemote: true, vmName: 'fly-pan-3135' },
      branchName: 'feature/pan-3135-remote',
    };
    const verify = vi.fn(async () => ({ outcome: 'passed' as const }));
    const pushBranch = vi.fn(async () => {});
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const dispatchReview = vi.fn(async () => {
      finish();
      return { success: true };
    });

    expect(await startDashboardDurableReviewPipeline({
      issueId: workspace.issueId,
      setReviewPending: vi.fn(),
      dispatchReview,
    }, {
      resolveWorkspace: () => workspace,
      pushBranch,
      verify,
    })).toBe(true);
    await finished;

    expect(verify).toHaveBeenCalledWith(
      workspace.issueId,
      workspace.workspacePath,
      workspace.workspaceInfo,
    );
    expect(pushBranch).toHaveBeenCalledWith(workspace);
    expect(dispatchReview).toHaveBeenCalledWith({
      issueId: workspace.issueId,
      workspace: workspace.workspacePath,
      branch: workspace.branchName,
    });
  });
});

describe('PAN-3674: dispatch failure persistence', () => {
  it('records a failed dispatch as failed — never silently back to pending', async () => {
    const workspace = {
      issueId: 'PAN-3674-LOCAL',
      workspacePath: '/workspace/local',
      workspaceInfo: { isRemote: false },
      branchName: 'feature/pan-3674-local',
    };
    const verify = vi.fn(async () => ({ outcome: 'passed' as const }));
    const pushBranch = vi.fn(async () => {});
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const dispatchReview = vi.fn(async () => ({
      success: false,
      error: 'Timed out waiting for Codex app-server readiness for agent-pan-3674-local-review. Last status error: app-server socket missing',
    }));
    // The status write trails the dispatch result by a microtask — it is the
    // finish line, not dispatch entry.
    const setReviewPending = vi.fn(() => finish());

    expect(await startDashboardDurableReviewPipeline({
      issueId: workspace.issueId,
      setReviewPending,
      dispatchReview,
    }, {
      resolveWorkspace: () => workspace,
      pushBranch,
      verify,
    })).toBe(true);
    await finished;

    // The row must land in a state the recovery gates and the operator can act
    // on — 'pending' here stranded PAN-3668 with no live reviewers for hours.
    expect(setReviewPending).toHaveBeenCalledWith(expect.objectContaining({
      reviewStatus: 'failed',
      reviewNotes: expect.stringContaining('Timed out waiting'),
    }));
    expect(setReviewPending).not.toHaveBeenCalledWith(expect.objectContaining({
      reviewStatus: 'pending',
    }));
  });
});
