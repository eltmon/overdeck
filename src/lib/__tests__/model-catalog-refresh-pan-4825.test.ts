import { describe, expect, it } from 'vitest';
import { getPricing } from '../cost.js';
import { MODEL_CAPABILITY_CLASSES } from '../model-capability-class.js';
import { getModelCapability, getModelEffortLevels, hasModelCapability, resolveModelId } from '../model-capabilities.js';
import { resolveKimiNativeEffort } from '../kimi-effort.js';
import { MODEL_DEPRECATIONS } from '../model-deprecations.js';
import { getModelProvider, isOpenRouterModel } from '../model-fallback.js';
import { getProviderForModel, PROVIDERS, type ProviderName } from '../providers.js';

// PAN-4825: November 2026 catalog refresh. Sources: docs/MODEL-CONTEXT-AUDIT.md.

function expectRegistered(id: string, provider: ProviderName): void {
  expect(getProviderForModel(id).name).toBe(provider);
  expect(PROVIDERS[provider].models).toContain(id);
  expect(hasModelCapability(id)).toBe(true);
  expect(getPricing('custom', id)?.model).toBe(id);
  expect(MODEL_CAPABILITY_CLASSES[id]).toBeDefined();
}

function expectRetired(id: string, target: string, provider: ProviderName): void {
  expect(MODEL_DEPRECATIONS[id]).toBe(target);
  expect(resolveModelId(id)).toBe(target);
  expect(PROVIDERS[provider].models).toContain(target);
  expect(PROVIDERS[provider].models).not.toContain(id);
}

function expectNoRetiredSlots(provider: ProviderName): void {
  const config = PROVIDERS[provider];
  const slots = [...config.models, config.haikuModel, ...Object.values(config.tierModels ?? {})];
  for (const id of slots) {
    if (id) expect(MODEL_DEPRECATIONS).not.toHaveProperty(id);
  }
}

describe('MiMo V2.6 replaces the retired V2.5 ids', () => {
  it.each(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'])('registers %s', (id) => {
    expectRegistered(id, 'mimo');
  });

  it('retires V2.5 Pro and V2.5 to their V2.6 successors', () => {
    expectRetired('mimo-v2.5-pro', 'mimo-v2.6-pro', 'mimo');
    expectRetired('mimo-v2.5', 'mimo-v2.6-flash', 'mimo');
  });

  it('lists only V2.6 ids and keeps retired ids out of every launch slot', () => {
    expect(PROVIDERS.mimo.models).toEqual(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed']);
    expect(PROVIDERS.mimo.haikuModel).toBe('mimo-v2.6-flash');
    expect(PROVIDERS.mimo.tierModels).toEqual({ opus: 'mimo-v2.6-pro', sonnet: 'mimo-v2.6-pro', haiku: 'mimo-v2.6-flash' });
    expectNoRetiredSlots('mimo');
  });
});

describe('Groq gpt-oss replaces the shut-down Llama, QwQ and Gemma ids', () => {
  it.each(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])('registers %s under groq, not openrouter', (id) => {
    expectRegistered(id, 'groq');
    expect(getModelProvider(id)).toBe('groq');
    expect(isOpenRouterModel(id)).toBe(false);
  });

  it('still routes other openai/ ids to OpenRouter', () => {
    expect(getProviderForModel('openai/gpt-oss-safeguard-20b').name).toBe('openrouter');
    expect(getModelProvider('openai/gpt-oss-safeguard-20b')).toBe('openrouter');
  });

  it('retires every dead Groq id to a live gpt-oss id', () => {
    expectRetired('llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'groq');
    expectRetired('qwen-qwq-32b', 'openai/gpt-oss-120b', 'groq');
    expectRetired('llama-3.1-8b-instant', 'openai/gpt-oss-20b', 'groq');
    expectRetired('gemma2-9b-it', 'openai/gpt-oss-20b', 'groq');
  });

  it('launches tiers and the haiku slot on gpt-oss', () => {
    expect(PROVIDERS.groq.haikuModel).toBe('openai/gpt-oss-20b');
    expect(PROVIDERS.groq.tierModels).toEqual({ opus: 'openai/gpt-oss-120b', sonnet: 'openai/gpt-oss-120b', haiku: 'openai/gpt-oss-20b' });
    expectNoRetiredSlots('groq');
  });
});

describe('Cerebras gpt-oss-120b replaces every deprecated Llama id', () => {
  it('registers gpt-oss-120b under cerebras, not openai', () => {
    expectRegistered('gpt-oss-120b', 'cerebras');
    expect(getModelProvider('gpt-oss-120b')).toBe('cerebras');
  });

  it.each(['llama3.3-70b', 'llama-3.3-70b', 'llama3.1-70b', 'llama3.1-8b'])('retires %s to gpt-oss-120b', (id) => {
    expectRetired(id, 'gpt-oss-120b', 'cerebras');
    expect(getProviderForModel(id).name).toBe('cerebras');
  });

  it('launches every tier and the haiku slot on gpt-oss-120b', () => {
    expect(PROVIDERS.cerebras.haikuModel).toBe('gpt-oss-120b');
    expect(PROVIDERS.cerebras.tierModels).toEqual({ opus: 'gpt-oss-120b', sonnet: 'gpt-oss-120b', haiku: 'gpt-oss-120b' });
    expectNoRetiredSlots('cerebras');
  });
});

describe('Mistral Large 4', () => {
  it('registers mistral-large-4-0 under mistral and leaves the -latest tier slots alone', () => {
    expectRegistered('mistral-large-4-0', 'mistral');
    expect(getModelProvider('mistral-large-4-0')).toBe('mistral');
    expect(PROVIDERS.mistral.tierModels).toEqual({ opus: 'mistral-large-latest', sonnet: 'mistral-large-latest', haiku: 'mistral-small-latest' });
  });
});

describe('xAI Grok 4.7 and 4.3', () => {
  it.each(['grok-4.7', 'grok-4.3'])('registers %s under xai', (id) => {
    expectRegistered(id, 'xai');
    expect(getModelProvider(id)).toBe('xai');
  });

  it('keeps grok-build-0.1 in every tier slot', () => {
    expect(PROVIDERS.xai.tierModels).toEqual({ opus: 'grok-build-0.1', sonnet: 'grok-build-0.1', haiku: 'grok-build-0.1' });
  });
});

describe('MiniMax M3.1 Flash', () => {
  it('registers MiniMax-M3.1-Flash under minimax and keeps the live M2.7 tier slots', () => {
    expectRegistered('MiniMax-M3.1-Flash', 'minimax');
    expect(getModelProvider('MiniMax-M3.1-Flash')).toBe('minimax');
    // Official MiniMax pages show no M2.7 retirement notice (checked 2026-11-02), so M2.7 stays live.
    expect(PROVIDERS.minimax.tierModels).toEqual({ opus: 'MiniMax-M3', sonnet: 'minimax-m2.7', haiku: 'minimax-m2.7-highspeed' });
    expectNoRetiredSlots('minimax');
  });
});

describe('Muse max effort', () => {
  it('lists max for Muse Wonder and Muse Spark 1.3 but not the Contributor tier', () => {
    expect(getModelEffortLevels('muse-wonder-1.0')).toContain('max');
    expect(getModelEffortLevels('muse-spark-1.3')).toContain('max');
    expect(getModelEffortLevels('muse-spark-1.3-contributor')).not.toContain('max');
  });
});

describe('Kimi kimi-for-coding is K2.8 Preview', () => {
  it('reports the 1M window and translates canonical effort to native levels', () => {
    expect(getModelCapability('kimi-code/kimi-for-coding').contextWindow).toBe(1048576);
    expect(resolveKimiNativeEffort('kimi-code/kimi-for-coding', 'medium')).toBe('high');
    expect(getModelEffortLevels('kimi-code/kimi-for-coding-highspeed')).toEqual([]);
  });
});
