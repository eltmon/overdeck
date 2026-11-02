import { describe, expect, it } from 'vitest';
import { MODEL_CAPABILITIES, MODEL_DEPRECATIONS, getModelEffortLevels, resolveModelId } from '../model-capabilities.js';
import { getProviderForModel, PROVIDERS } from '../providers.js';
import { apiLaunchModelId } from '../model-context-windows.js';
import { getClaudeCodeContextPolicyForModel } from '../agents/provider-env.js';
import { getPricing } from '../cost.js';
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
    ['gpt-6-sol', 'openai', 272000],
    ['gpt-6-luna', 'openai', 272000],
    ['gpt-6.1-sol', 'openai', 272000],
    ['gpt-6.1-terra', 'openai', 272000],
    ['gpt-6-rosalind', 'openai', 272000],
    ['gpt-6-astra-law', 'openai', 272000],
    ['gpt-5.6-sol', 'openai', 272000],
    ['gpt-5.6-terra', 'openai', 272000],
    ['gpt-5.6-luna', 'openai', 272000],
    ['claude-fable-5-1', 'anthropic', 1000000],
    ['claude-opus-5-5', 'anthropic', 1000000],
    ['claude-sonnet-5-5', 'anthropic', 1000000],
    ['claude-haiku-5-5', 'anthropic', 1000000],
    ['gemini-4-argon', 'google', 1048576],
    ['gemini-3.8-flash', 'google', 1048576],
    ['gemini-3.5-flash-lite', 'google', 1048576],
    ['glm-5.3', 'zai', 1000000],
    ['qwen3.7-plus', 'dashscope', 1000000],
    ['qwen3.8-flash', 'dashscope', 1000000],
    ['mimo-v2.6-pro', 'mimo', 1048576],
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
    expect(MODEL_CAPABILITIES['kimi-code/kimi-for-coding'].effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(MODEL_CAPABILITIES['kimi-code/kimi-for-coding-highspeed'].effortLevels).toEqual([]);
    // Generic role effort remains valid; the native launcher omits unsupported controls.
    expect(modelSupportsEffortSync('kimi-code/kimi-for-coding', 'high')).toBe(true);
  });

  it('registers the K3.1 Pro and K3.1 Pro Highspeed ids at the 1M context tier', () => {
    const k3EffortLevels = MODEL_CAPABILITIES['k3[1m]'].effortLevels;
    for (const id of ['k3.1-pro', 'k3.1-pro-highspeed', 'kimi-code/k3.1-pro', 'kimi-code/k3.1-pro-highspeed']) {
      expect(MODEL_CAPABILITIES[id].contextWindow).toBe(1048576);
      expect(MODEL_CAPABILITIES[id].effortLevels).toEqual(k3EffortLevels);
    }
  });

  it('records the published Opus 5.5 output and effort limits', () => {
    const capability = MODEL_CAPABILITIES['claude-opus-5-5'];
    expect(capability.maxOutputTokens).toBe(128000);
    expect(capability.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('retires claude-sonnet-4-5 from new selections while it still migrates and resolves (Anthropic retires it 2026-11-30)', () => {
    expect(PROVIDERS.anthropic.models).not.toContain('claude-sonnet-4-5');
    expect(MODEL_DEPRECATIONS['claude-sonnet-4-5']).toBe('claude-sonnet-4-6');
    expect(resolveModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4-6');
    expect(getProviderForModel('claude-sonnet-4-5').name).toBe('anthropic');
    expect(Object.hasOwn(MODEL_CAPABILITIES, 'claude-sonnet-4-5')).toBe(true);
    expect(getPricing('anthropic', 'claude-sonnet-4-5')?.inputPer1k).toBe(0.003);
  });
});
