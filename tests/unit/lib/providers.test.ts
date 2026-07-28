import { describe, expect, it } from 'vitest';

import { getBuiltInDefaultHarness, getProviderEnvSync, PROVIDERS, type ProviderName } from '../../../src/lib/providers.js';
import type { RuntimeName } from '../../../src/lib/runtimes/types.js';

const EXPECTED_DEFAULT_HARNESSES: Record<ProviderName, RuntimeName> = {
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
  xai: 'ohmypi',
  groq: 'ohmypi',
  cerebras: 'ohmypi',
  mistral: 'ohmypi',
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

describe('getProviderEnvSync — kimi-code Anthropic-compat gate (PAN-1837 wi7a)', () => {
  it('AC1: omits ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, and KIMI_API_KEY for {kimi, kimi-code}', () => {
    const env = getProviderEnvSync(PROVIDERS.kimi, 'sk-kimi-test-key', 'kimi-code');
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
    const withHarness = getProviderEnvSync(PROVIDERS.kimi, 'sk-kimi-test-key', 'claude-code');
    const withoutHarness = getProviderEnvSync(PROVIDERS.kimi, 'sk-kimi-test-key');
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
    expect(getProviderEnvSync(acpProvider, 'sk-kimi-test-key', 'acp')).toEqual(
      getProviderEnvSync(acpProvider, 'sk-kimi-test-key'),
    );
    expect(getProviderEnvSync(PROVIDERS.minimax, 'mm-key', 'codex')).toEqual(
      getProviderEnvSync(PROVIDERS.minimax, 'mm-key'),
    );
  });
});
