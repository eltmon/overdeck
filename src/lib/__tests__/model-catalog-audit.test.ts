import { describe, expect, it } from 'vitest';
import { MODEL_CAPABILITIES, MODEL_DEPRECATIONS, modelSupportsEffortSync } from '../model-capabilities.js';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';
import { apiLaunchModelIdSync } from '../model-context-windows.js';
import { getClaudeCodeContextPolicyForModel } from '../agents/provider-env.js';

describe('September model catalog no-loss audit', () => {
  it('accounts for retired GPT selections without losing historical capabilities', () => {
    for (const id of ['gpt-5.2', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5']) {
      expect(Object.hasOwn(MODEL_CAPABILITIES, id)).toBe(true);
      const replacement = MODEL_DEPRECATIONS[id];
      expect(replacement).toBeDefined();
      expect(Object.hasOwn(MODEL_DEPRECATIONS, replacement)).toBe(false);
      expect(PROVIDERS.openai.models).toContain(replacement);
      expect(PROVIDERS.openai.models).not.toContain(id);
    }
  });

  it.each([
    ['gpt-6-astra', 'openai', 272000],
    ['gpt-5.6-sol', 'openai', 272000],
    ['gpt-5.6-terra', 'openai', 272000],
    ['gpt-5.6-luna', 'openai', 272000],
    ['claude-fable-5-1', 'anthropic', 1000000],
    ['gemini-3.8-flash', 'google', 1048576],
    ['gemini-3.5-flash-lite', 'google', 1048576],
    ['glm-5.3', 'zai', 1000000],
    ['qwen3.7-plus', 'dashscope', 1000000],
    ['qwen3.8-flash', 'dashscope', 1000000],
    ['mimo-v2.5', 'mimo', 1048576],
  ] as const)('registers %s with the intended context and provider', (id, provider, contextWindow) => {
    expect(MODEL_CAPABILITIES[id].contextWindow).toBe(contextWindow);
    expect(getProviderForModelSync(id).name).toBe(provider);
    expect(PROVIDERS[provider].models).toContain(id);
    if (provider !== 'anthropic') {
      expect(getClaudeCodeContextPolicyForModel(id)).toEqual({ autoCompactWindow: contextWindow, maxContextTokens: contextWindow });
    }
  });

  it('preserves K3 context tier across launch translation and hides unsupported K2.7 effort', () => {
    expect(apiLaunchModelIdSync('k3')).toBe('k3-256k');
    expect(apiLaunchModelIdSync('k3[1m]')).toBe('k3[1m]');
    expect(MODEL_CAPABILITIES['kimi-code/kimi-for-coding'].effortLevels).toEqual([]);
    expect(MODEL_CAPABILITIES['kimi-code/kimi-for-coding-highspeed'].effortLevels).toEqual([]);
    // Generic role effort remains valid; the native launcher omits unsupported controls.
    expect(modelSupportsEffortSync('kimi-code/kimi-for-coding', 'high')).toBe(true);
  });
});
