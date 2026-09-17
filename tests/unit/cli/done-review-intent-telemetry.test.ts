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
    // PAN-3848 (W25): the write retries three times on the lock backoff
    // ladder before failing — every attempt must fail for the intent to fail.
    vi.useFakeTimers();
    updateIssueRecordMock.mockRejectedValue(new Error('state write failed'));

    const promise = persistDoneReviewIntent('PAN-2599', '/workspace', {
      reviewRequestedAt: '2026-07-22T12:00:00.000Z',
    });
    const rejection = expect(promise).rejects.toThrow('state write failed');
    await vi.runAllTimersAsync();
    await rejection;

    expect(updateIssueRecordMock).toHaveBeenCalledTimes(4);
    expect(capturePipelineStageForIssueMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
