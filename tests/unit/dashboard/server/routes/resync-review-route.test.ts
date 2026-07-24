import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../../../src/lib/review-status.js';

const {
  mockGetReviewStatusSync,
  mockSetReviewStatusSync,
  mockSetReviewStatus,
  mockNotifyPipelineSync,
} = vi.hoisted(() => ({
  mockGetReviewStatusSync: vi.fn(),
  mockSetReviewStatusSync: vi.fn(),
  mockSetReviewStatus: vi.fn(),
  mockNotifyPipelineSync: vi.fn(),
}));

vi.mock('../../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatusSync,
  setReviewStatusSync: mockSetReviewStatusSync,
  markWorkspaceStuck: vi.fn(),
  setDeaconIgnored: vi.fn(),
  setAutoMerge: vi.fn(),
}));

vi.mock('../../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipelineSync: mockNotifyPipelineSync,
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn(),
}));

vi.mock('../../../../../src/lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: vi.fn(),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/routes/workspaces.js', () => ({
  getProjectPath: vi.fn(),
  readJsonBody: Effect.succeed({}),
  getWorkspaceInfoForIssue: vi.fn(() => ({ exists: false })),
  setReviewStatus: mockSetReviewStatus,
  requireTrustedMutationOrigin: Effect.void,
}));

import { processResyncReviewStatus } from '../../../../../src/dashboard/server/routes/workspaces/review-control.js';

const status: ReviewStatus = {
  issueId: 'PAN-2988',
  reviewStatus: 'passed',
  testStatus: 'passed',
  verificationStatus: 'passed',
  mergeStatus: 'pending',
  readyForMerge: true,
  updatedAt: '2026-07-22T20:01:00.000Z',
};

describe('processResyncReviewStatus — POST /api/review/:issueId/resync', () => {
  beforeEach(() => {
    mockGetReviewStatusSync.mockReset();
    mockSetReviewStatusSync.mockReset();
    mockSetReviewStatus.mockReset();
    mockNotifyPipelineSync.mockReset();
  });

  it('returns the canonical status and emits one status_changed notification', () => {
    mockGetReviewStatusSync.mockReturnValue(status);

    const result = processResyncReviewStatus(status.issueId);

    expect(result).toEqual({ httpStatus: 200, body: { ok: true, status } });
    expect(mockNotifyPipelineSync).toHaveBeenCalledOnce();
    expect(mockNotifyPipelineSync).toHaveBeenCalledWith({
      type: 'status_changed',
      issueId: status.issueId,
      status,
    });
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('returns 404 and emits nothing when no review status exists', () => {
    mockGetReviewStatusSync.mockReturnValue(null);

    expect(processResyncReviewStatus('PAN-404')).toEqual({
      httpStatus: 404,
      body: { ok: false, error: 'no review status found for PAN-404' },
    });
    expect(mockNotifyPipelineSync).not.toHaveBeenCalled();
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});
