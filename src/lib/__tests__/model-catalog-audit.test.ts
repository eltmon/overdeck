import { describe, expect, it } from 'vitest';
import { MODEL_CAPABILITIES, MODEL_DEPRECATIONS, getModelEffortLevels } from '../model-capabilities.js';
import { getProviderForModel, PROVIDERS } from '../providers.js';
import { apiLaunchModelId } from '../model-context-windows.js';
import { getClaudeCodeContextPolicyForModel } from '../agents/provider-env.js';
import type { EffortLevel } from '../model-capability-types.js';
import { ModelId } from '../settings.js';

// Moved here from src/lib/model-capabilities.ts, which no production code called (PAN-3958 CH-8).
/**
 * Whether a model accepts the given effort level. Returns true when the model
 * has no enumerated effort levels (permissive fallback — see {@link getModelEffortLevels}).
 */
function modelSupportsEffortSync(model: ModelId | string, effort: EffortLevel): boolean {
  const levels = getModelEffortLevels(model);
  return levels === undefined || levels.length === 0 || levels.includes(effort);
}

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
    ['claude-opus-5-5', 'anthropic', 1000000],
    ['gemini-3.8-flash', 'google', 1048576],
    ['gemini-3.5-flash-lite', 'google', 1048576],
    ['glm-5.3', 'zai', 1000000],
    ['qwen3.7-plus', 'dashscope', 1000000],
    ['qwen3.8-flash', 'dashscope', 1000000],
    ['mimo-v2.5', 'mimo', 1048576],
  ] as const)('registers %s with the intended context and provider', (id, provider, contextWindow) => {
    expect(MODEL_CAPABILITIES[id].contextWindow).toBe(contextWindow);
    expect(getProviderForModel(id).name).toBe(provider);
    expect(PROVIDERS[provider].models).toContain(id);
    if (provider !== 'anthropic') {
      expect(getClaudeCodeContextPolicyForModel(id)).toEqual({ autoCompactWindow: contextWindow, maxContextTokens: contextWindow });
    }
  });

  it('preserves K3 context tier across launch translation and hides unsupported K2.7 effort', () => {
    expect(apiLaunchModelId('k3')).toBe('k3-256k');
    expect(apiLaunchModelId('k3[1m]')).toBe('k3[1m]');
    expect(MODEL_CAPABILITIES['kimi-code/kimi-for-coding'].effortLevels).toEqual([]);
    expect(MODEL_CAPABILITIES['kimi-code/kimi-for-coding-highspeed'].effortLevels).toEqual([]);
    // Generic role effort remains valid; the native launcher omits unsupported controls.
    expect(modelSupportsEffortSync('kimi-code/kimi-for-coding', 'high')).toBe(true);
  });

  it('records the published Opus 5.5 output and effort limits', () => {
    const capability = MODEL_CAPABILITIES['claude-opus-5-5'];
    expect(capability.maxOutputTokens).toBe(128000);
    expect(capability.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});
