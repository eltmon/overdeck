/**
 * PAN-5619: a background review-request pipeline failure is journalled with
 * its error and head, so `pan show` reports it, and a second identical
 * failure is recognised as deterministic (deacon-lite stops re-requesting it).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readPrimaryHead8: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/verified-head.js', () => ({ readPrimaryHead8: mocks.readPrimaryHead8 }));
vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({ surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou }));
vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

const { readPipelineJournal } = await import('../../../../src/lib/cloister/pipeline-journal.js');
const { isRepeatedPipelineFailure, recordReviewPipelineFailure } = await import('../../../../src/lib/cloister/review-dispatch-failure.js');

let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  workspace = mkdtempSync(join(tmpdir(), 'review-pipeline-failure-'));
  mocks.readPrimaryHead8.mockResolvedValue('abcd1234');
  mocks.surfaceIssueFeedbackNeedsYou.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workspace, { recursive: true, force: true });
});

const failures = () => readPipelineJournal(workspace).filter((entry) => entry.type === 'review.dispatch-failed');

describe('recordReviewPipelineFailure', () => {
  it('returns the error text and journals it with the head', async () => {
    const detail = recordReviewPipelineFailure('pan-5601', workspace, new Error('Command failed: git push origin feature/pan-5601'));

    expect(detail).toBe('Command failed: git push origin feature/pan-5601');
    await vi.waitFor(() => expect(failures()).toHaveLength(1));
    expect(failures()[0]).toMatchObject({
      issueId: 'PAN-5601',
      source: 'request-review',
      data: { error: 'Command failed: git push origin feature/pan-5601', head: 'abcd1234' },
    });
    expect(mocks.surfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
  });

  it('tells the operator once the same failure repeats at the same head', async () => {
    recordReviewPipelineFailure('PAN-5601', workspace, new Error('boom'));
    await vi.waitFor(() => expect(failures()).toHaveLength(1));
    recordReviewPipelineFailure('PAN-5601', workspace, new Error('boom'));
    await vi.waitFor(() => expect(failures()).toHaveLength(2));

    await vi.waitFor(() => expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledTimes(1));
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith('PAN-5601', expect.stringContaining('failed twice'), expect.any(Object));
  });

  it('never throws, even when the head cannot be read', async () => {
    mocks.readPrimaryHead8.mockRejectedValue(new Error('not a git repository'));

    expect(recordReviewPipelineFailure('PAN-5601', workspace, 'plain string')).toBe('plain string');
    await vi.waitFor(() => expect(failures()).toHaveLength(1));
    expect(failures()[0]?.data).toEqual({ reviewer: 'review', error: 'plain string' });
  });
});

describe('isRepeatedPipelineFailure', () => {
  const failure = (error: string, head: string, source = 'request-review') =>
    ({ type: 'review.dispatch-failed', source, data: { error, head } });

  it('is false for a first failure', () => {
    expect(isRepeatedPipelineFailure([{ type: 'review.requested' }], failure('e', 'h'))).toBe(false);
  });

  it('is true for the same error at the same head, and compares a journal entry never with itself', () => {
    const last = failure('e', 'h');
    expect(isRepeatedPipelineFailure([failure('e', 'h'), { type: 'review.requested' }, last], last)).toBe(true);
    expect(isRepeatedPipelineFailure([{ type: 'review.requested' }, last], last)).toBe(false);
  });

  it('is false when the error or the head changed, or a dispatch succeeded in between', () => {
    expect(isRepeatedPipelineFailure([failure('e', 'h')], failure('other', 'h'))).toBe(false);
    expect(isRepeatedPipelineFailure([failure('e', 'h')], failure('e', 'h2'))).toBe(false);
    expect(isRepeatedPipelineFailure([failure('e', 'h'), { type: 'review.dispatched' }], failure('e', 'h'))).toBe(false);
  });

  it('ignores failures other writers journalled', () => {
    expect(isRepeatedPipelineFailure([failure('e', 'h', 'conflict-gate')], failure('e', 'h'))).toBe(false);
  });
});
