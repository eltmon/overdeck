import { describe, expect, it } from 'vitest';
import { KIMI_CODING_BASE_URL, KIMI_PLATFORM_BASE_URL, getProviderEnv, PROVIDERS } from '../../src/lib/providers.js';

describe('providers', () => {
  it('returns no proxy env for OpenAI subscription routing through claudish', () => {
    expect(getProviderEnv(PROVIDERS.openai, 'subscription-oauth')).toEqual({});
  });

  it('returns OPENAI_API_KEY for direct OpenAI key-based claudish routing', () => {
    expect(getProviderEnv(PROVIDERS.openai, 'sk-test-123')).toEqual({
      OPENAI_API_KEY: 'sk-test-123',
    });
  });

  it('returns Anthropic-compatible env for Google direct routing', () => {
    expect(getProviderEnv(PROVIDERS.google, 'AIza-test')).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'AIza-test',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gemini-3.1-pro-preview',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gemini-3-flash-preview',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gemini-3.1-flash-lite-preview',
      ANTHROPIC_SMALL_FAST_MODEL: 'gemini-3.1-flash-lite-preview',
      CLAUDE_CODE_SUBAGENT_MODEL: 'gemini-3.1-flash-lite-preview',
    });
  });

  it('routes sk-kimi-* coding keys to the Kimi coding Anthropic endpoint', () => {
    expect(getProviderEnv(PROVIDERS.kimi, 'sk-kimi-test')).toEqual({
      ANTHROPIC_BASE_URL: KIMI_CODING_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: 'sk-kimi-test',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2',
      ANTHROPIC_SMALL_FAST_MODEL: 'kimi-k2',
      CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k2',
    });
  });

  it('routes Moonshot platform keys to the Moonshot Anthropic endpoint', () => {
    expect(getProviderEnv(PROVIDERS.kimi, 'sk-platform-test')).toEqual({
      ANTHROPIC_BASE_URL: KIMI_PLATFORM_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: 'sk-platform-test',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2',
      ANTHROPIC_SMALL_FAST_MODEL: 'kimi-k2',
      CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k2',
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
