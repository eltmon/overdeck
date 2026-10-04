/**
 * PAN-4506. A review kickoff the terminal backend rejected outright never
 * started — there is no reviewer to recover, so this records the fact and
 * tells the operator directly instead of letting the stall detector
 * re-dispatch the same doomed text forever.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const surfaceIssueFeedbackNeedsYouMock = vi.fn(async () => undefined);
vi.mock('../feedback-target.js', () => ({
  surfaceIssueFeedbackNeedsYou: surfaceIssueFeedbackNeedsYouMock,
}));

const { recordReviewDispatchFailure } = await import('../review-dispatch-failure.js');
const { readPipelineJournal } = await import('../pipeline-journal.js');

let workspace: string;

beforeEach(() => {
  surfaceIssueFeedbackNeedsYouMock.mockClear();
  surfaceIssueFeedbackNeedsYouMock.mockResolvedValue(undefined);
  workspace = mkdtempSync(join(tmpdir(), 'review-dispatch-failure-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('recordReviewDispatchFailure', () => {
  it('journals a review.dispatch-failed entry with the uppercased issueId and the error', async () => {
    await recordReviewDispatchFailure({
      issueId: 'pan-4383',
      workspace,
      reviewer: 'agent-pan-4383-review',
      error: 'invalid_request: unexpected end of hex escape at line 1 column 4021',
    });

    const entries = readPipelineJournal(workspace);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'review.dispatch-failed',
      issueId: 'PAN-4383',
      source: 'review-agent',
      data: {
        reviewer: 'agent-pan-4383-review',
        error: 'invalid_request: unexpected end of hex escape at line 1 column 4021',
      },
    });
  });

  it('surfaces a needs-you with a reason containing the error, exactly once', async () => {
    await recordReviewDispatchFailure({
      issueId: 'pan-4383',
      workspace,
      reviewer: 'agent-pan-4383-review',
      error: 'invalid_request: x',
    });

    expect(surfaceIssueFeedbackNeedsYouMock).toHaveBeenCalledTimes(1);
    expect(surfaceIssueFeedbackNeedsYouMock).toHaveBeenCalledWith(
      'PAN-4383',
      expect.stringContaining('invalid_request: x'),
      expect.anything(),
    );
  });

  it('never throws, even when surfaceIssueFeedbackNeedsYou rejects', async () => {
    surfaceIssueFeedbackNeedsYouMock.mockRejectedValueOnce(new Error('activity logger down'));

    await expect(recordReviewDispatchFailure({
      issueId: 'pan-4383',
      workspace,
      reviewer: 'agent-pan-4383-review',
      error: 'invalid_request: x',
    })).resolves.toBeUndefined();
  });
});
