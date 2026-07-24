import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateIssueRecordMock = vi.hoisted(() => vi.fn());
const capturePipelineStageForIssueMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/lib/pan-dir/record.js', () => ({
  getProjectConfigFromWorkspacePath: vi.fn(() => ({ projectKey: 'overdeck' })),
  resolveProjectForIssue: vi.fn(() => ({ projectKey: 'overdeck' })),
}));

vi.mock('../../../src/lib/pan-dir/record-update.js', () => ({
  updateIssueRecord: updateIssueRecordMock,
}));

vi.mock('../../../src/lib/telemetry/pipeline.js', () => ({
  capturePipelineStageForIssue: capturePipelineStageForIssueMock,
}));

import { persistDoneReviewIntent } from '../../../src/cli/commands/done-review-intent.js';

describe('done review intent telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateIssueRecordMock.mockImplementation(async (_project, _issueId, update) => {
      update({ pipeline: {} });
    });
  });

  it('captures work_done only after the durable review intent succeeds', async () => {
    await persistDoneReviewIntent('PAN-2599', '/workspace', {
      reviewRequestedAt: '2026-07-22T12:00:00.000Z',
    });

    expect(updateIssueRecordMock).toHaveBeenCalledTimes(1);
    expect(capturePipelineStageForIssueMock).toHaveBeenCalledWith('PAN-2599', 'work_done');
  });

  it('does not capture work_done when the durable review intent fails', async () => {
    updateIssueRecordMock.mockRejectedValueOnce(new Error('state write failed'));

    await expect(persistDoneReviewIntent('PAN-2599', '/workspace', {
      reviewRequestedAt: '2026-07-22T12:00:00.000Z',
    })).rejects.toThrow('state write failed');

    expect(capturePipelineStageForIssueMock).not.toHaveBeenCalled();
  });
});
