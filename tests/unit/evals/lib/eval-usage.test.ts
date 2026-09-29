import { describe, expect, it } from 'vitest';
import { evalCostUsd, usageFromAnthropic, usageFromOpenAI } from '../../../../evals/lib/eval-usage.js';

describe('usageFromAnthropic', () => {
  it('maps cache read and creation tokens, defaulting null to 0', () => {
    expect(
      usageFromAnthropic({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: null,
    });
  });
});

describe('usageFromOpenAI', () => {
  it('subtracts cached tokens from input and records reasoning tokens', () => {
    expect(
      usageFromOpenAI({
        input_tokens: 314,
        output_tokens: 5,
        input_tokens_details: { cached_tokens: 100 },
        output_tokens_details: { reasoning_tokens: 0 },
      }),
    ).toEqual({
      inputTokens: 214,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
  });
});

describe('evalCostUsd', () => {
  it('prices claude-sonnet-5-5', () => {
    expect(
      evalCostUsd('anthropic', 'claude-sonnet-5-5', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: null,
      }),
    ).toBe(12);
  });

  it('prices gpt-6-luna', () => {
    expect(
      evalCostUsd('openai', 'gpt-6-luna', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: null,
      }),
    ).toBe(0.6);
  });

  it('prices a dated snapshot through prefix match', () => {
    const cost = evalCostUsd('anthropic', 'claude-haiku-4-5-20251001', {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: null,
    });
    expect(typeof cost).toBe('number');
  });

  it('returns null when no pricing row exists', () => {
    expect(
      evalCostUsd('anthropic', 'claude-nonexistent-9', {
        inputTokens: 100,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: null,
      }),
    ).toBeNull();
  });
});
