import { describe, expect, it } from 'vitest';
import { getProviderEnv, PROVIDERS } from '../../src/lib/providers.js';

describe('providers', () => {
  it('returns no proxy env for OpenAI subscription routing through claudish', () => {
    expect(getProviderEnv(PROVIDERS.openai, 'subscription-oauth')).toEqual({});
  });

  it('returns OPENAI_API_KEY for direct OpenAI key-based claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.openai, 'sk-test-123')).toEqual({
      OPENAI_API_KEY: 'sk-test-123',
    });
  });

  it('returns GEMINI_API_KEY for direct Google key-based claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.google, 'AIza-test')).toEqual({
      GEMINI_API_KEY: 'AIza-test',
    });
  });

  it('returns KIMI_CODING_API_KEY for Kimi key-based claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.kimi, 'sk-kimi-test')).toEqual({
      KIMI_CODING_API_KEY: 'sk-kimi-test',
    });
  });

  it('returns MINIMAX_API_KEY for MiniMax key-based claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.minimax, 'sk-minimax-test')).toEqual({
      MINIMAX_API_KEY: 'sk-minimax-test',
    });
  });

  it('returns ZHIPU_API_KEY for Z.AI key-based claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.zai, 'sk-zai-test')).toEqual({
      ZHIPU_API_KEY: 'sk-zai-test',
    });
  });

  it('returns ANTHROPIC_API_KEY for Mimo custom-URL claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.mimo, 'sk-mimo-test')).toEqual({
      ANTHROPIC_API_KEY: 'sk-mimo-test',
    });
  });

  it('returns OPENROUTER_API_KEY for OpenRouter key-based claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.openrouter, 'sk-or-test')).toEqual({
      OPENROUTER_API_KEY: 'sk-or-test',
    });
  });
});
