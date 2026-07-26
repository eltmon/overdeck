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
