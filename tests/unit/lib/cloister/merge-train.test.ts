import { beforeEach, describe, it, expect, vi } from 'vitest';

const mergeTrainMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  isMergeTrainEnabledForProject: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mergeTrainMocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/cloister/auto-merge-policy.js', () => ({
  isMergeTrainEnabledForProject: mergeTrainMocks.isMergeTrainEnabledForProject,
}));

import { runMergeTrainReconcile } from '../../../../src/lib/cloister/merge-train.js';
import type { ReconcileDeps } from '../../../../src/lib/cloister/merge-train-reconciler.js';

const mockDeps = (siblings: string[]): ReconcileDeps => ({
  getReadySiblings: () => siblings,
  rebaseSibling: async () => ({ status: 'up-to-date' }),
  reDispatchVerification: vi.fn(),
  dispatchConflictResolver: vi.fn(),
});

describe('runMergeTrainReconcile (PAN-1691 flag gating)', () => {
  beforeEach(() => {
    mergeTrainMocks.resolveProjectFromIssueSync.mockReset();
    mergeTrainMocks.isMergeTrainEnabledForProject.mockReset();
    mergeTrainMocks.isMergeTrainEnabledForProject.mockReturnValue(false);
  });

  it('is a no-op when the merge-train flag is off and never touches the deps', async () => {
    const getReadySiblings = vi.fn(() => ['PAN-2']);
    const out = await runMergeTrainReconcile('PAN-1', {
      enabled: () => false,
      deps: { ...mockDeps(['PAN-2']), getReadySiblings },
    });
    expect(out).toEqual([]);
    expect(getReadySiblings).not.toHaveBeenCalled();
  });

  it('runs the reconciler over the ready siblings when the flag is on', async () => {
    const out = await runMergeTrainReconcile('PAN-1', {
      enabled: () => true,
      deps: mockDeps(['PAN-2', 'PAN-3']),
    });
    expect(out).toEqual([
      { issueId: 'PAN-2', result: 'unaffected' },
      { issueId: 'PAN-3', result: 'unaffected' },
    ]);
  });

  it('does not load git deps when the merged issue project disables merge train', async () => {
    mergeTrainMocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'pan',
      projectName: 'Panopticon',
      projectPath: '/repo/pan',
    });
    mergeTrainMocks.isMergeTrainEnabledForProject.mockReturnValue(false);

    const out = await runMergeTrainReconcile('PAN-1');

    expect(out).toEqual([]);
    expect(mergeTrainMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-1');
    expect(mergeTrainMocks.isMergeTrainEnabledForProject).toHaveBeenCalledWith('pan');
  });
});
