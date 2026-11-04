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
    ['gemini-3.1-flash-lite', 'google', 1048576],
    ['gemini-3.6-flash', 'google', 1048576],
    ['qwen3.8-max', 'dashscope', 1000000],
    ['glm-5.3-flash', 'zai', 1000000],
    ['glm-5.3-flashx', 'zai', 1000000],
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

describe('November 2026 Gemini, Qwen and GLM refresh (PAN-4827)', () => {
  it('retires gemini-3.1-flash-lite-preview to the GA id', () => {
    const id = 'gemini-3.1-flash-lite-preview';
    const target = 'gemini-3.1-flash-lite';
    expect(MODEL_DEPRECATIONS[id]).toBe(target);
    expect(resolveModelId(id)).toBe(target);
    expect(Object.hasOwn(MODEL_DEPRECATIONS, target)).toBe(false);
    expect(PROVIDERS.google.models).toContain(target);
    expect(PROVIDERS.google.models).not.toContain(id);
    expect(Object.hasOwn(MODEL_CAPABILITIES, id)).toBe(true);
    expect(PROVIDERS.google.tierModels.haiku).toBe(target);
  });

  it('registers gemini-3.6-flash with its official price', () => {
    expect(getPricing('google', 'gemini-3.6-flash')).toMatchObject({ inputPer1k: 0.00075, outputPer1k: 0.00375 });
  });

  it('reprices gemini-3.8-flash and gemini-3-flash-preview to the official rates', () => {
    expect(getPricing('google', 'gemini-3.8-flash')).toMatchObject({ inputPer1k: 0.00075, outputPer1k: 0.00375 });
    expect(getPricing('google', 'gemini-3-flash-preview')).toMatchObject({ inputPer1k: 0.0005, outputPer1k: 0.003 });
    expect(MODEL_CAPABILITIES['gemini-3.8-flash'].costPer1MTokens).toBe(2.25);
    expect(MODEL_CAPABILITIES['gemini-3-flash-preview'].costPer1MTokens).toBe(1.75);
  });

  it.each([
    ['qwen3-coder-plus', 'qwen3.7-plus'],
    ['qwen3-max', 'qwen3.7-max'],
    ['qwen3-plus', 'qwen3.8-flash'],
  ] as const)('retires %s to %s', (id, target) => {
    expect(MODEL_DEPRECATIONS[id]).toBe(target);
    expect(resolveModelId(id)).toBe(target);
    expect(Object.hasOwn(MODEL_DEPRECATIONS, target)).toBe(false);
    expect(PROVIDERS.dashscope.models).toContain(target);
    expect(PROVIDERS.dashscope.models).not.toContain(id);
    expect(Object.hasOwn(MODEL_CAPABILITIES, id)).toBe(true);
  });

  it('sets the DashScope tiers to the live ids', () => {
    expect(PROVIDERS.dashscope.tierModels).toEqual({ opus: 'qwen3.8-max', sonnet: 'qwen3.7-plus', haiku: 'qwen3.8-flash' });
    expect(PROVIDERS.dashscope.haikuModel).toBe('qwen3.8-flash');
  });

  it.each([
    ['qwen3.7-plus', 1, 0.0004, 0.0016],
    ['qwen3.8-flash', 0.31, 0.00015, 0.00047],
    ['qwen3.7-max', 5, 0.0025, 0.0075],
    ['qwen3.8-max', 4, 0.002, 0.006],
  ] as const)('prices the live DashScope id %s with no $0 placeholder', (id, costPer1MTokens, inputPer1k, outputPer1k) => {
    expect(MODEL_CAPABILITIES[id].costPer1MTokens).not.toBe(0);
    expect(MODEL_CAPABILITIES[id].costPer1MTokens).toBe(costPer1MTokens);
    expect(getPricing('custom', id)).toMatchObject({ inputPer1k, outputPer1k });
  });

  it('registers glm-5.3-flash and glm-5.3-flashx with image support and prefix-correct pricing', () => {
    expect(getPricing('custom', 'glm-5.3-flashx-legal')!.inputPer1k).toBe(0.00037);
    for (const id of ['glm-5.3-flash', 'glm-5.3-flashx'] as const) {
      expect(MODEL_CAPABILITIES[id].effortLevels).toEqual(['low', 'high', 'max']);
      expect(MODEL_CAPABILITIES[id].supportsImages).toBe(true);
    }
  });

  it('corrects the glm-4.7 and glm-4.7-flash capability costs', () => {
    expect(MODEL_CAPABILITIES['glm-4.7'].costPer1MTokens).toBe(1.4);
    expect(MODEL_CAPABILITIES['glm-4.7-flash'].costPer1MTokens).toBe(0);
  });

  it.each(Object.entries(PROVIDERS))('%s tier ids and haikuModel name no retired model', (_name, provider) => {
    const ids = [...Object.values(provider.tierModels ?? {}), provider.haikuModel]
      .filter((id): id is string => typeof id === 'string');
    for (const id of ids) expect(Object.hasOwn(MODEL_DEPRECATIONS, id), id).toBe(false);
  });
});
