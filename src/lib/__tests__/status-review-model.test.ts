import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config-yaml/defaults.js';
import { mergeConfigs } from '../config-yaml/merge.js';
import { resolveStatusReviewModel } from '../status-review-model.js';

// PAN-4160: the Command Deck status review and fork summaries read documented
// config keys instead of literals scattered through the call sites.
describe('status review model (PAN-4160)', () => {
  it('runs on models.status_review_model from config.yaml', () => {
    const { config } = mergeConfigs({ models: { status_review_model: 'claude-haiku-4-5' } });
    expect(resolveStatusReviewModel(config)).toBe('claude-haiku-4-5');
  });

  it('falls back to the documented default in config-yaml/defaults.ts', () => {
    const { config } = mergeConfigs({});
    expect(resolveStatusReviewModel(config)).toBe(DEFAULT_CONFIG.statusReviewModel);
  });

  it('fails loudly when no model is configured', () => {
    expect(() => resolveStatusReviewModel({ statusReviewModel: '' })).toThrow(
      /No status review model configured: set models\.status_review_model/,
    );
  });
});

describe('fork summary model config (PAN-4160)', () => {
  it('reads conversations.fork_summary_model from config.yaml', () => {
    const { config } = mergeConfigs({ conversations: { fork_summary_model: 'claude-haiku-4-5' } });
    expect(config.conversations.forkSummaryModel).toBe('claude-haiku-4-5');
  });

  it('keeps the documented default when unset', () => {
    const { config } = mergeConfigs({});
    expect(config.conversations.forkSummaryModel).toBe(DEFAULT_CONFIG.conversations.forkSummaryModel);
  });
});
