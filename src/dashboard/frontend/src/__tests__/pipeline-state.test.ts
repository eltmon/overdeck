import { describe, expect, it } from 'vitest';
import { getPendingQuestionTitle, hasActualPendingQuestion, isReviewPipelineStuck } from '../lib/pipeline-state';

describe('pipeline-state helpers', () => {
  it('only treats actual queued questions or detected prompts as input-needed', () => {
    expect(hasActualPendingQuestion({ hasPendingQuestion: true, pendingQuestionCount: 1 })).toBe(true);
    expect(hasActualPendingQuestion({ hasPendingQuestion: true, pendingQuestionCount: 0 })).toBe(false);
    expect(hasActualPendingQuestion({ hasPendingQuestion: true, pendingQuestionCount: 0, pendingQuestionPrompt: 'Do you want to proceed?' })).toBe(true);
    expect(hasActualPendingQuestion({ hasPendingQuestion: false, pendingQuestionCount: 2, pendingQuestionPrompt: 'Do you want to proceed?' })).toBe(false);
  });

  it('formats detected prompt titles for tool permissions', () => {
    expect(getPendingQuestionTitle({
      hasPendingQuestion: true,
      pendingQuestionCount: 0,
      pendingQuestionReason: 'tool_permission',
      pendingQuestionPrompt: 'Do you want to proceed?\n1. Yes',
    })).toBe('Permission prompt: Do you want to proceed?');
  });

  it('treats failed pipeline states as stuck', () => {
    expect(isReviewPipelineStuck({ mergeStatus: 'failed' })).toBe(true);
    expect(isReviewPipelineStuck({ verificationStatus: 'failed' })).toBe(true);
    expect(isReviewPipelineStuck({ reviewStatus: 'blocked' })).toBe(true);
    expect(isReviewPipelineStuck({ testStatus: 'dispatch_failed' })).toBe(true);
    expect(isReviewPipelineStuck({ reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'queued' })).toBe(false);
  });
});
