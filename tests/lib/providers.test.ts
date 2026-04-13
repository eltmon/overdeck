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
});
