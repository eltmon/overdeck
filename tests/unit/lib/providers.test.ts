import { describe, expect, it } from 'vitest';

import { getBuiltInDefaultHarness, getProviderEnv, getProviderForModel, PROVIDERS, type ProviderName } from '../../../src/lib/providers.js';
import { getModelProvider } from '../../../src/lib/model-fallback.js';
import { shellQuoteModelId } from '../../../src/lib/model-validation.js';
import { apiLaunchModelId } from '../../../src/lib/model-context-windows.js';
import { normalizeModelName } from '../../../src/lib/cost-parsers/jsonl-parser.js';
import { getPricing } from '../../../src/lib/cost.js';
import type { RuntimeName } from '../../../src/lib/runtimes/types.js';

const EXPECTED_DEFAULT_HARNESSES: Record<ProviderName, RuntimeName> = {
  meta: 'muse',
  anthropic: 'claude-code',
  openai: 'codex',
  google: 'ohmypi',
  kimi: 'kimi-code',
  minimax: 'ohmypi',
  zai: 'ohmypi',
  mimo: 'ohmypi',
  openrouter: 'ohmypi',
  nous: 'ohmypi',
  dashscope: 'ohmypi',
      opencode: 'opencode',
      'opencode-go': 'opencode',
  xai: 'ohmypi',
  groq: 'ohmypi',
  cerebras: 'ohmypi',
  mistral: 'ohmypi',
  quantumllama: 'claude-code',
  ollama: 'claude-code',
};

describe('providers', () => {
  it('stores a built-in default harness for every provider', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(Object.keys(EXPECTED_DEFAULT_HARNESSES).sort());

    for (const [provider, expectedHarness] of Object.entries(EXPECTED_DEFAULT_HARNESSES)) {
      expect(PROVIDERS[provider as ProviderName].defaultHarness).toBe(expectedHarness);
    }
  });

  it('returns the built-in default harness for known providers', () => {
    expect(getBuiltInDefaultHarness('openai')).toBe('codex');
    expect(getBuiltInDefaultHarness('anthropic')).toBe('claude-code');
    expect(getBuiltInDefaultHarness('kimi')).toBe('kimi-code');
  });

  it('falls back to claude-code for unknown providers', () => {
    expect(getBuiltInDefaultHarness('unknown-provider')).toBe('claude-code');
  });
});

describe('getProviderEnv — kimi-code Anthropic-compat gate (PAN-1837 wi7a)', () => {
  it('AC1: omits ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, and KIMI_API_KEY for {kimi, kimi-code}', () => {
    const env = getProviderEnv(PROVIDERS.kimi, 'sk-kimi-test-key', 'kimi-code');
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.KIMI_API_KEY).toBeUndefined();
    // Claude Code subagent-routing vars (Explorer/Plan/general-purpose model
    // picks) are meaningless to the native kimi binary — verified leaking live
    // during wi14 e2e (the launcher exported ANTHROPIC_DEFAULT_OPUS_MODEL etc.
    // into a kimi-code work agent before this gate existed).
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined();
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });

  it('AC2: still sets ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, and KIMI_API_KEY for {kimi, claude-code}', () => {
    const withHarness = getProviderEnv(PROVIDERS.kimi, 'sk-kimi-test-key', 'claude-code');
    const withoutHarness = getProviderEnv(PROVIDERS.kimi, 'sk-kimi-test-key');
    for (const env of [withHarness, withoutHarness]) {
      expect(env.ANTHROPIC_BASE_URL).toBeTruthy();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-kimi-test-key');
      expect(env.KIMI_API_KEY).toBe('sk-kimi-test-key');
    }
    // Omitting harness must produce byte-identical output to explicit claude-code.
    expect(withoutHarness).toEqual(withHarness);
  });

  it('AC3: acp and codex env output is byte-identical whether or not harness is passed', () => {
    const acpProvider = PROVIDERS.kimi;
    expect(getProviderEnv(acpProvider, 'sk-kimi-test-key', 'acp')).toEqual(
      getProviderEnv(acpProvider, 'sk-kimi-test-key'),
    );
    expect(getProviderEnv(PROVIDERS.minimax, 'mm-key', 'codex')).toEqual(
      getProviderEnv(PROVIDERS.minimax, 'mm-key'),
    );
  });
});

describe('Ollama model routing (PAN-1641)', () => {
  it('routes every ollama: id to the local provider, including a tag containing a slash', () => {
    expect(getProviderForModel('ollama:gemma4:12b')).toBe(PROVIDERS.ollama);
    expect(getProviderForModel('ollama:hf.co/user/model:Q4_K_M')).toBe(PROVIDERS.ollama);
    expect(getModelProvider('ollama:gemma4:12b')).toBe('ollama');
    expect(getModelProvider('ollama:hf.co/user/model:Q4_K_M')).toBe('ollama');
  });

  it('leaves OpenRouter slash ids alone', () => {
    expect(getProviderForModel('qwen/qwen3.6-plus:free')).toBe(PROVIDERS.openrouter);
    expect(getModelProvider('qwen/qwen3.6-plus:free')).toBe('openrouter');
  });

  it('points the local provider at the bare Ollama root so claude-code can append /v1/messages', () => {
    expect(PROVIDERS.ollama.baseUrl).toBe('http://localhost:11434');
    expect(PROVIDERS.ollama.defaultHarness).toBe('claude-code');
  });

  it('strips the ollama: prefix at the single launch-arg door', () => {
    expect(apiLaunchModelId('ollama:gemma4:12b')).toBe('gemma4:12b');
    expect(shellQuoteModelId('ollama:gemma4:12b')).toBe("'gemma4:12b'");
    expect(apiLaunchModelId('claude-opus-5')).toBe('claude-opus-5');
  });

  it('prices a local run at nothing, in both the stamped and the bare-tag spelling', () => {
    for (const id of ['ollama:gemma4:12b', 'gemma4:12b']) {
      const { provider, model } = normalizeModelName(id);
      expect(getPricing(provider, model)).toBeNull();
    }
  });
});
