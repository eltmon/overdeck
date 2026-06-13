import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllReviewStatusesFromDb: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  isMergeTrainEnabledForProject: vi.fn(),
  spawnRun: vi.fn(),
}));

vi.mock('../../../../src/lib/database/review-status-db.js', () => ({
  getAllReviewStatusesFromDb: mocks.getAllReviewStatusesFromDb,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/cloister/auto-merge-policy.js', () => ({
  isMergeTrainEnabledForProject: mocks.isMergeTrainEnabledForProject,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  spawnRun: mocks.spawnRun,
}));

import { buildRealReconcileDeps } from '../../../../src/lib/cloister/merge-train-deps.js';

describe('buildRealReconcileDeps', () => {
  it('only returns enabled siblings from the merged issue project', () => {
    mocks.getAllReviewStatusesFromDb.mockReturnValue({
      'PAN-1': { issueId: 'PAN-1', readyForMerge: true, mergeStatus: 'merged' },
      'PAN-2': { issueId: 'PAN-2', readyForMerge: true, mergeStatus: 'ready' },
      'PAN-3': { issueId: 'PAN-3', readyForMerge: true, mergeStatus: 'ready' },
      'MIN-1': { issueId: 'MIN-1', readyForMerge: true, mergeStatus: 'ready' },
      'AUR-1': { issueId: 'AUR-1', readyForMerge: false, mergeStatus: 'ready' },
    });
    mocks.resolveProjectFromIssueSync.mockImplementation((issueId: string) => {
      if (issueId.startsWith('PAN-')) {
        return { projectKey: 'pan', projectName: 'Panopticon', projectPath: '/repo/pan' };
      }
      if (issueId.startsWith('MIN-')) {
        return { projectKey: 'mind', projectName: 'Mind', projectPath: '/repo/mind' };
      }
      return { projectKey: 'aur', projectName: 'Auricle', projectPath: '/repo/aur' };
    });
    mocks.isMergeTrainEnabledForProject.mockImplementation((projectKey: string) => projectKey === 'pan');

    expect(buildRealReconcileDeps().getReadySiblings('PAN-1')).toEqual(['PAN-2', 'PAN-3']);
    expect(mocks.isMergeTrainEnabledForProject).toHaveBeenCalledWith('pan');
    expect(mocks.isMergeTrainEnabledForProject).toHaveBeenCalledWith('mind');
  });
});
