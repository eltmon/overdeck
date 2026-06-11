import { describe, expect, it } from 'vitest';
import { KIMI_CODING_BASE_URL, KIMI_PLATFORM_BASE_URL, OLLAMA_OPENAI_BASE_URL, getProviderEnvSync, getProviderForModelSync, PROVIDERS } from '../../src/lib/providers.js';

describe('providers', () => {
  it('returns no provider-native env for OpenAI subscription routing through CLIProxy', () => {
    expect(getProviderEnvSync(PROVIDERS.openai, 'subscription-oauth')).toEqual({});
  });

  it('does not expose OpenAI API keys through provider env construction', () => {
    expect(getProviderEnvSync(PROVIDERS.openai, 'sk-test-123')).toEqual({});
  });

  it('returns Anthropic-compatible env for Google direct routing', () => {
    expect(getProviderEnvSync(PROVIDERS.google, 'AIza-test')).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'AIza-test',
      GEMINI_API_KEY: 'AIza-test',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gemini-3.1-pro-preview',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gemini-3-flash-preview',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gemini-3.1-flash-lite-preview',
      ANTHROPIC_SMALL_FAST_MODEL: 'gemini-3.1-flash-lite-preview',
      CLAUDE_CODE_SUBAGENT_MODEL: 'gemini-3.1-flash-lite-preview',
    });
  });

  it('routes sk-kimi-* coding keys to the Kimi coding Anthropic endpoint', () => {
    expect(getProviderEnvSync(PROVIDERS.kimi, 'sk-kimi-test')).toEqual({
      ANTHROPIC_BASE_URL: KIMI_CODING_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: 'sk-kimi-test',
      KIMI_API_KEY: 'sk-kimi-test',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2',
      ANTHROPIC_SMALL_FAST_MODEL: 'kimi-k2',
      CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k2',
    });
  });

  it('routes Moonshot platform keys to the Moonshot Anthropic endpoint', () => {
    expect(getProviderEnvSync(PROVIDERS.kimi, 'sk-platform-test')).toEqual({
      ANTHROPIC_BASE_URL: KIMI_PLATFORM_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: 'sk-platform-test',
      KIMI_API_KEY: 'sk-platform-test',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2',
      ANTHROPIC_SMALL_FAST_MODEL: 'kimi-k2',
      CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k2',
    });
  });

  it('routes MiniMax through its direct Anthropic-compatible endpoint', () => {
    expect(PROVIDERS.minimax.compatibility).toBe('direct');
    expect(getProviderEnvSync(PROVIDERS.minimax, 'sk-minimax-test')).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-minimax-test',
      MINIMAX_API_KEY: 'sk-minimax-test',
      API_TIMEOUT_MS: '300000',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M3',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'minimax-m2.7',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'minimax-m2.7-highspeed',
      ANTHROPIC_SMALL_FAST_MODEL: 'minimax-m2.7-highspeed',
      CLAUDE_CODE_SUBAGENT_MODEL: 'minimax-m2.7-highspeed',
    });
  });

  it('routes Z.AI through its direct Anthropic-compatible endpoint', () => {
    expect(PROVIDERS.zai.compatibility).toBe('direct');
    expect(getProviderEnvSync(PROVIDERS.zai, 'sk-zai-test')).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-zai-test',
      ZAI_API_KEY: 'sk-zai-test',
      API_TIMEOUT_MS: '300000',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.1',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.7-flash',
      ANTHROPIC_SMALL_FAST_MODEL: 'glm-4.7-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'glm-4.7-flash',
    });
  });

  it('routes Mimo through its direct Anthropic-compatible endpoint', () => {
    expect(PROVIDERS.mimo.compatibility).toBe('direct');
    expect(getProviderEnvSync(PROVIDERS.mimo, 'sk-mimo-test')).toEqual({
      ANTHROPIC_BASE_URL: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-mimo-test',
      MIMO_API_KEY: 'sk-mimo-test',
      API_TIMEOUT_MS: '300000',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'mimo-v2.5-pro',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'mimo-v2.5-pro',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'mimo-v2.5',
      ANTHROPIC_SMALL_FAST_MODEL: 'mimo-v2.5',
      CLAUDE_CODE_SUBAGENT_MODEL: 'mimo-v2.5',
    });
  });

  it('routes OpenRouter through its direct Anthropic-compatible endpoint', () => {
    expect(PROVIDERS.openrouter.compatibility).toBe('direct');
    expect(getProviderEnvSync(PROVIDERS.openrouter, 'sk-or-test')).toEqual({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
      ANTHROPIC_AUTH_TOKEN: 'sk-or-test',
      OPENROUTER_API_KEY: 'sk-or-test',
    });
  });

  it('routes ollama-prefixed models to the Ollama provider before slash-based OpenRouter routing', () => {
    expect(PROVIDERS.ollama).toMatchObject({
      name: 'ollama',
      baseUrl: OLLAMA_OPENAI_BASE_URL,
      models: [],
      tested: false,
    });
    expect(getProviderForModelSync('ollama:gemma3:12b')).toBe(PROVIDERS.ollama);
    expect(getProviderForModelSync('ollama:anything')).toBe(PROVIDERS.ollama);
    expect(getProviderForModelSync('ollama:library/tag:latest')).toBe(PROVIDERS.ollama);
  });

  it('returns OpenAI-compatible env for Ollama without Anthropic routing vars', () => {
    expect(getProviderEnvSync(PROVIDERS.ollama, 'ollama')).toEqual({
      OPENAI_BASE_URL: OLLAMA_OPENAI_BASE_URL,
      OPENAI_API_KEY: 'ollama',
    });
  });

  it('keeps existing model routing unchanged', () => {
    expect(getProviderForModelSync('claude-sonnet-4-6')).toBe(PROVIDERS.anthropic);
    expect(getProviderForModelSync('gpt-5.4')).toBe(PROVIDERS.openai);
    expect(getProviderForModelSync('gemini-3-flash-preview')).toBe(PROVIDERS.google);
    expect(getProviderForModelSync('minimax-m2.7')).toBe(PROVIDERS.minimax);
    expect(getProviderForModelSync('kimi-k2.6')).toBe(PROVIDERS.kimi);
    expect(getProviderForModelSync('glm-5.1')).toBe(PROVIDERS.zai);
    expect(getProviderForModelSync('mimo-v2.5-pro')).toBe(PROVIDERS.mimo);
    expect(getProviderForModelSync('qwen/qwen3.6-plus:free')).toBe(PROVIDERS.openrouter);
  });

  it('routes DashScope Qwen models to the DashScope provider', () => {
    for (const model of ['qwen3-max', 'qwen3-coder-plus', 'qwen3-plus', 'qwen3.7-max']) {
      expect(getProviderForModelSync(model)).toBe(PROVIDERS.dashscope);
    }
    expect(getProviderForModelSync('qwen/qwen3.6-plus')).toBe(PROVIDERS.nous);
  });

  it('returns Anthropic-compatible env for DashScope direct routing', () => {
    expect(getProviderEnvSync(PROVIDERS.dashscope, 'sk-test')).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:12436/dashscope',
      ANTHROPIC_AUTH_TOKEN: 'sk-test',
      DASHSCOPE_API_KEY: 'sk-test',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3-max',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3-coder-plus',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3-plus',
      ANTHROPIC_SMALL_FAST_MODEL: 'qwen3-plus',
      CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3-plus',
    });
  });
});
