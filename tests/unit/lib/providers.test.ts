import { describe, expect, it } from 'vitest';

import { getBuiltInDefaultHarness, PROVIDERS, type ProviderName } from '../../../src/lib/providers.js';
import type { RuntimeName } from '../../../src/lib/runtimes/types.js';

const EXPECTED_DEFAULT_HARNESSES: Record<ProviderName, RuntimeName> = {
  anthropic: 'claude-code',
  openai: 'codex',
  google: 'ohmypi',
  kimi: 'claude-code',
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
    expect(getBuiltInDefaultHarness('kimi')).toBe('claude-code');
  });

  it('falls back to claude-code for unknown providers', () => {
    expect(getBuiltInDefaultHarness('unknown-provider')).toBe('claude-code');
  });
});
