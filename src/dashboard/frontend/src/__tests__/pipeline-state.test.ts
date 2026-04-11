import { describe, expect, it } from 'vitest';
import { hasActualPendingQuestion, isReviewPipelineStuck } from '../lib/pipeline-state';

describe('pipeline-state helpers', () => {
  it('only treats actual queued questions as input-needed', () => {
    expect(hasActualPendingQuestion({ hasPendingQuestion: true, pendingQuestionCount: 1 })).toBe(true);
    expect(hasActualPendingQuestion({ hasPendingQuestion: true, pendingQuestionCount: 0 })).toBe(false);
    expect(hasActualPendingQuestion({ hasPendingQuestion: false, pendingQuestionCount: 2 })).toBe(false);
  });

  it('treats failed pipeline states as stuck', () => {
    expect(isReviewPipelineStuck({ mergeStatus: 'failed' })).toBe(true);
    expect(isReviewPipelineStuck({ verificationStatus: 'failed' })).toBe(true);
    expect(isReviewPipelineStuck({ reviewStatus: 'blocked' })).toBe(true);
    expect(isReviewPipelineStuck({ testStatus: 'dispatch_failed' })).toBe(true);
    expect(isReviewPipelineStuck({ reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'queued' })).toBe(false);
  });
});
