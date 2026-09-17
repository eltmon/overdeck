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

  it('clears reviewStaleSince as part of the durable intent write (PR #3872 finding 1)', async () => {
    updateIssueRecordMock.mockImplementation(async (_project, _issueId, update) => {
      const record = { pipeline: { reviewStaleSince: '2026-09-17T00:00:00.000Z', prUrl: 'https://x' } };
      const result = update(record);
      // JSON.stringify drops undefined-valued keys — the marker is gone from the record.
      expect(JSON.parse(JSON.stringify(result ?? record)).pipeline.reviewStaleSince).toBeUndefined();
    });

    await persistDoneReviewIntent('PAN-3847', '/workspace', {
      reviewRequestedAt: '2026-09-17T12:00:00.000Z',
    });

    expect(updateIssueRecordMock).toHaveBeenCalledTimes(1);
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
