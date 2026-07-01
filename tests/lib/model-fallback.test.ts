import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ModelProvider,
  getModelProviderSync,
  requiresExternalKeySync,
  getModelsByProviderSync,
  isProviderEnabled,
  applyFallbackSync,
  getFallbackModelSync,
  detectEnabledProvidersSync,
  filterAvailableModelsSync,
  getAvailableModelsSync,
} from '../../src/lib/model-fallback.js';
import { ModelId } from '../../src/lib/settings.js';
import { hasModelCapabilitySync, getModelEffortLevelsSync, modelSupportsEffortSync, MODEL_CAPABILITIES, modelSupportsImagesSync } from '../../src/lib/model-capabilities.js';

describe('model-fallback', () => {
  // Spy on console.warn to test warning logs
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('getModelProvider', () => {
    it('should return anthropic for Claude models', () => {
      expect(getModelProviderSync('claude-opus-4-6')).toBe('anthropic');
      expect(getModelProviderSync('claude-sonnet-4-5')).toBe('anthropic');
      expect(getModelProviderSync('claude-haiku-4-5')).toBe('anthropic');
    });

    it('should return openai for OpenAI models', () => {
      expect(getModelProviderSync('gpt-5.3-codex')).toBe('openai');
      expect(getModelProviderSync('o3-deep-research')).toBe('openai');
      expect(getModelProviderSync('gpt-4o')).toBe('openai');
      expect(getModelProviderSync('gpt-4o-mini')).toBe('openai');
    });

    it('should return google for Gemini models', () => {
      expect(getModelProviderSync('gemini-3-pro-preview')).toBe('google');
      expect(getModelProviderSync('gemini-3-flash-preview')).toBe('google');
    });

    it('should return nous for Nous Portal models', () => {
      expect(getModelProviderSync('qwen/qwen3.6-plus')).toBe('nous');
    });
  });

  describe('requiresExternalKey', () => {
    it('should return false for Anthropic models', () => {
      expect(requiresExternalKeySync('claude-opus-4-6')).toBe(false);
      expect(requiresExternalKeySync('claude-sonnet-4-5')).toBe(false);
      expect(requiresExternalKeySync('claude-haiku-4-5')).toBe(false);
    });

    it('should return true for OpenAI models', () => {
      expect(requiresExternalKeySync('gpt-5.3-codex')).toBe(true);
      expect(requiresExternalKeySync('gpt-4o')).toBe(true);
    });

    it('should return true for Google models', () => {
      expect(requiresExternalKeySync('gemini-3-pro-preview')).toBe(true);
      expect(requiresExternalKeySync('gemini-3-flash-preview')).toBe(true);
    });

    it('should return true for Nous Portal models', () => {
      expect(requiresExternalKeySync('qwen/qwen3.6-plus')).toBe(true);
    });
  });

  describe('getModelsByProvider', () => {
    it('should return all Anthropic models', () => {
      const models = getModelsByProviderSync('anthropic');
      expect(models).toContain('claude-fable-5');
      expect(models).toContain('claude-opus-4-8');
      expect(models).toContain('claude-opus-4-7');
      expect(models).toContain('claude-opus-4-6');
      expect(models).toContain('claude-sonnet-5');
      expect(models).toContain('claude-sonnet-4-6');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(8);
    });

    it('should return all OpenAI models', () => {
      const models = getModelsByProviderSync('openai');
      expect(models).toContain('gpt-5.5');
      expect(models).toContain('gpt-5.5-pro');
      expect(models).toContain('gpt-5.4');
      expect(models).toContain('gpt-5.4-mini');
      expect(models).toContain('gpt-5.4-pro');
      expect(models).toContain('gpt-5.3-codex');
      expect(models).toContain('gpt-5.3-codex-spark');
      expect(models).toContain('gpt-5.2');
      expect(models).toContain('o3');
      expect(models).toContain('o4-mini');
      expect(models).toContain('o3-deep-research'); // legacy
      expect(models).toContain('gpt-4o'); // legacy
      expect(models).toContain('gpt-4o-mini'); // legacy
      expect(models).toHaveLength(13);
    });

    it('should return all Google models', () => {
      const models = getModelsByProviderSync('google');
      expect(models).toContain('gemini-3.1-pro-preview');
      expect(models).toContain('gemini-3-flash-preview');
      expect(models).toContain('gemini-3.1-flash-lite-preview');
      expect(models).toContain('gemini-3-pro-preview'); // legacy
      expect(models).toContain('gemini-2.5-pro'); // legacy
      expect(models).toContain('gemini-2.5-flash'); // legacy
      expect(models).toHaveLength(6);
    });

    it('should return all Nous Portal models', () => {
      const models = getModelsByProviderSync('nous');
      expect(models).toEqual(['qwen/qwen3.6-plus']);
    });
  });

  describe('isProviderEnabled', () => {
    it('respects enabledProviders set for all providers including Anthropic', () => {
      expect(isProviderEnabled('anthropic', new Set())).toBe(false);
      expect(isProviderEnabled('anthropic', new Set<ModelProvider>(['anthropic']))).toBe(true);
      expect(isProviderEnabled('anthropic', new Set<ModelProvider>(['openai']))).toBe(false);
    });

    it('should return true if provider is in enabled set', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      expect(isProviderEnabled('openai', enabled)).toBe(true);
    });

    it('should return false if provider not in enabled set', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(isProviderEnabled('openai', enabled)).toBe(false);
      expect(isProviderEnabled('google', enabled)).toBe(false);
    });
  });

  describe('Anthropic-disabled provider behavior', () => {
    it('filterAvailableModels excludes Claude models when Anthropic is disabled', () => {
      const noAnthropic = new Set<ModelProvider>(['openai']);
      const filtered = filterAvailableModelsSync(
        ['claude-opus-4-6', 'claude-sonnet-5', 'gpt-5.4'] as ModelId[],
        noAnthropic
      );
      expect(filtered).not.toContain('claude-opus-4-6');
      expect(filtered).not.toContain('claude-sonnet-5');
      expect(filtered).toContain('gpt-5.4');
    });

    it('getAvailableModels excludes Claude models when Anthropic is disabled', () => {
      const noAnthropic = new Set<ModelProvider>(['openai']);
      const available = getAvailableModelsSync(noAnthropic);
      for (const model of available) {
        expect(getModelProviderSync(model)).not.toBe('anthropic');
      }
    });

    it('applyFallback does not fall back to Anthropic when Anthropic is disabled (MiniMax-only)', () => {
      // Regression: with anthropic=false and minimax=true, a disabled-provider model must NOT
      // silently rewrite to claude-sonnet-5. The original model is returned with a warning.
      const minimaxOnly = new Set<ModelProvider>(['minimax']);
      // minimax-m2.7 is enabled — should pass through unchanged
      expect(applyFallbackSync('minimax-m2.7' as ModelId, minimaxOnly)).toBe('minimax-m2.7');
      // gpt-5.4 is disabled (openai not in set) AND Anthropic is also disabled —
      // must NOT return claude-sonnet-5
      const result = applyFallbackSync('gpt-5.4' as ModelId, minimaxOnly);
      expect(getModelProviderSync(result)).not.toBe('anthropic');
    });

    it('applyFallback falls back to Anthropic when Anthropic IS enabled and provider is disabled', () => {
      // Standard path: openai disabled, anthropic enabled → Anthropic fallback applied
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gpt-5.4' as ModelId, anthropicOnly)).toBe('claude-sonnet-5');
    });
  });

  describe('applyFallback', () => {
    it('should return original model if provider is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      expect(applyFallbackSync('gpt-5.3-codex', enabled)).toBe('gpt-5.3-codex');
      expect(applyFallbackSync('claude-opus-4-6', enabled)).toBe('claude-opus-4-6');
    });

    it('should fallback GPT-5.2 Codex to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gpt-5.3-codex', enabled)).toBe('claude-sonnet-5');
    });

    it('should fallback O3 Deep Research to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('o3-deep-research', enabled)).toBe('claude-sonnet-5');
    });

    it('should fallback GPT-4o to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gpt-4o', enabled)).toBe('claude-sonnet-5');
    });

    it('should fallback GPT-4o-mini to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gpt-4o-mini', enabled)).toBe('claude-haiku-4-5');
    });

    it('should fallback Gemini Pro to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gemini-3-pro-preview', enabled)).toBe('claude-sonnet-5');
    });

    it('should fallback Gemini Flash to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gemini-3-flash-preview', enabled)).toBe('claude-haiku-4-5');
    });

    it('should log warning when applying fallback', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      applyFallbackSync('gpt-5.3-codex', enabled);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Model gpt-5.3-codex requires openai API key')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to claude-sonnet-5')
      );
    });

    it('should not log warning when provider is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      applyFallbackSync('gpt-5.3-codex', enabled);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should always return Anthropic models unchanged', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('claude-opus-4-6', enabled)).toBe('claude-opus-4-6');
      expect(applyFallbackSync('claude-sonnet-4-5', enabled)).toBe('claude-sonnet-4-5');
      expect(applyFallbackSync('claude-haiku-4-5', enabled)).toBe('claude-haiku-4-5');
    });
  });

  describe('getFallbackModel', () => {
    it('should return Anthropic models unchanged', () => {
      expect(getFallbackModelSync('claude-opus-4-6')).toBe('claude-opus-4-6');
      expect(getFallbackModelSync('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
      expect(getFallbackModelSync('claude-haiku-4-5')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for OpenAI models', () => {
      expect(getFallbackModelSync('gpt-5.3-codex')).toBe('claude-sonnet-5');
      expect(getFallbackModelSync('o3-deep-research')).toBe('claude-sonnet-5');
      expect(getFallbackModelSync('gpt-4o')).toBe('claude-sonnet-5');
      expect(getFallbackModelSync('gpt-4o-mini')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for Google models', () => {
      expect(getFallbackModelSync('gemini-3-pro-preview')).toBe('claude-sonnet-5');
      expect(getFallbackModelSync('gemini-3-flash-preview')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for Nous Portal models', () => {
      expect(getFallbackModelSync('qwen/qwen3.6-plus')).toBe('claude-sonnet-5');
    });
  });

  describe('detectEnabledProviders', () => {
    it('should always include Anthropic', () => {
      const enabled = detectEnabledProvidersSync({});
      expect(enabled.has('anthropic')).toBe(true);
    });

    it('should detect OpenAI when key present', () => {
      const enabled = detectEnabledProvidersSync({ openai: 'sk-test' });
      expect(enabled.has('openai')).toBe(true);
    });

    it('should detect Google when key present', () => {
      const enabled = detectEnabledProvidersSync({ google: 'test-key' });
      expect(enabled.has('google')).toBe(true);
    });

    it('should detect Nous Portal when key present', () => {
      const enabled = detectEnabledProvidersSync({ nous: 'nous-key' });
      expect(enabled.has('nous')).toBe(true);
    });

    it('should detect multiple providers', () => {
      const enabled = detectEnabledProvidersSync({
        openai: 'sk-test',
        google: 'test-key',
      });

      expect(enabled.size).toBe(3); // anthropic + 2 others
      expect(enabled.has('anthropic')).toBe(true);
      expect(enabled.has('openai')).toBe(true);
      expect(enabled.has('google')).toBe(true);
    });

    it('should ignore empty strings', () => {
      const enabled = detectEnabledProvidersSync({
        openai: '',
        google: '  ',
      });

      expect(enabled.size).toBe(1); // Only anthropic
      expect(enabled.has('anthropic')).toBe(true);
      expect(enabled.has('openai')).toBe(false);
      expect(enabled.has('google')).toBe(false);
    });

    it('should handle undefined values', () => {
      const enabled = detectEnabledProvidersSync({
        openai: undefined,
        google: undefined,
      });

      expect(enabled.size).toBe(1); // Only anthropic
      expect(enabled.has('anthropic')).toBe(true);
    });
  });

  describe('filterAvailableModels', () => {
    it('should include Anthropic models when only Anthropic enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const models: ModelId[] = [
        'claude-opus-4-6',
        'gpt-5.3-codex',
        'gemini-3-pro-preview',
      ];

      const filtered = filterAvailableModelsSync(models, enabled);
      expect(filtered).toContain('claude-opus-4-6');
      expect(filtered).not.toContain('gpt-5.3-codex');
      expect(filtered).not.toContain('gemini-3-pro-preview');
    });

    it('should include all models when all providers enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai', 'google']);
      const models: ModelId[] = [
        'claude-opus-4-6',
        'gpt-5.3-codex',
        'gemini-3-pro-preview',
      ];

      const filtered = filterAvailableModelsSync(models, enabled);
      expect(filtered).toEqual(models);
    });

    it('should filter based on enabled providers', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models: ModelId[] = [
        'claude-opus-4-6',
        'gpt-5.3-codex',
        'gemini-3-pro-preview',
      ];

      const filtered = filterAvailableModelsSync(models, enabled);
      expect(filtered).toContain('claude-opus-4-6');
      expect(filtered).toContain('gpt-5.3-codex');
      expect(filtered).not.toContain('gemini-3-pro-preview');
    });
  });

  describe('getAvailableModels', () => {
    it('should return only Anthropic models when only Anthropic enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const models = getAvailableModelsSync(enabled);

      expect(models).toContain('claude-fable-5');
      expect(models).toContain('claude-opus-4-8');
      expect(models).toContain('claude-opus-4-7');
      expect(models).toContain('claude-opus-4-6');
      expect(models).toContain('claude-sonnet-5');
      expect(models).toContain('claude-sonnet-4-6');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(8);
    });

    it('should return all models when all providers enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai', 'google', 'kimi']);
      const models = getAvailableModelsSync(enabled);

      expect(models.length).toBe(32); // 8 Anthropic + 13 OpenAI + 6 Google + 5 Kimi
    });

    it('should include OpenAI models when OpenAI enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models = getAvailableModelsSync(enabled);

      expect(models).toContain('gpt-5.5');
      expect(models).toContain('gpt-5.4');
      expect(models).toContain('o3');
      expect(models).toContain('gpt-5.3-codex');
      expect(models).toContain('gpt-4o');
      expect(models.length).toBe(21); // 8 Anthropic + 13 OpenAI
    });

    it('should include Google models when Google enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'google']);
      const models = getAvailableModelsSync(enabled);

      expect(models).toContain('gemini-3.1-pro-preview');
      expect(models).toContain('gemini-3-flash-preview');
      expect(models).toContain('gemini-3.1-flash-lite-preview');
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gemini-2.5-flash');
      expect(models.length).toBe(14); // 8 Anthropic + 6 Google
    });
  });

  describe('fallback strategy validation', () => {
    it('should map premium models to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gpt-5.3-codex', enabled)).toBe('claude-sonnet-5');
      expect(applyFallbackSync('o3-deep-research', enabled)).toBe('claude-sonnet-5');
      expect(applyFallbackSync('gemini-3-pro-preview', enabled)).toBe('claude-sonnet-5');
    });

    it('should map economy models to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('gpt-4o-mini', enabled)).toBe('claude-haiku-4-5');
      expect(applyFallbackSync('gemini-3-flash-preview', enabled)).toBe('claude-haiku-4-5');
    });

    it('should never fallback to Opus by default', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const allModels: ModelId[] = [
        'gpt-5.3-codex',
        'o3-deep-research',
        'gpt-4o',
        'gpt-4o-mini',
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
      ];

      allModels.forEach((model) => {
        const fallback = applyFallbackSync(model, enabled);
        expect(fallback).not.toBe('claude-opus-4-6');
      });
    });
  });

  describe('newly introduced model catalog regression (PAN-540)', () => {
    it('glm-4.7 is recognized as zai provider', () => {
      expect(getModelProviderSync('glm-4.7' as ModelId)).toBe('zai');
      expect(getModelProviderSync('glm-4.7-flash' as ModelId)).toBe('zai');
    });

    it('glm-4.7 requires external key', () => {
      expect(requiresExternalKeySync('glm-4.7' as ModelId)).toBe(true);
      expect(requiresExternalKeySync('glm-4.7-flash' as ModelId)).toBe(true);
    });

    it('glm-4.7 appears in getModelsByProvider for zai', () => {
      const zaiModels = getModelsByProviderSync('zai');
      expect(zaiModels).toContain('glm-5.2');
      expect(zaiModels).toContain('glm-4.7');
      expect(zaiModels).toContain('glm-4.7-flash');
      expect(zaiModels).toContain('glm-5.1');
    });

    it('glm-4.7 falls back to Sonnet and glm-4.7-flash falls back to Haiku when zai is disabled', () => {
      // glm-4.7 is strong-tier (like Sonnet), glm-4.7-flash is economy-tier (like Haiku).
      // Explicit FALLBACK_MAP entries ensure tier-correct results regardless of the
      // MODEL_DEPRECATIONS chain (which previously mapped both through glm-5.1 → Sonnet).
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('glm-4.7' as ModelId, anthropicOnly)).toBe('claude-sonnet-5');
      expect(applyFallbackSync('glm-4.7-flash' as ModelId, anthropicOnly)).toBe('claude-haiku-4-5');
    });

    it('glm-4.7 stays when zai is enabled', () => {
      const zaiEnabled = new Set<ModelProvider>(['zai']);
      expect(applyFallbackSync('glm-4.7' as ModelId, zaiEnabled)).toBe('glm-4.7');
    });

    it('kimi-k2 is recognized as kimi provider', () => {
      expect(getModelProviderSync('kimi-k2' as ModelId)).toBe('kimi');
    });

    it('kimi-k2 falls back to Sonnet when kimi is disabled', () => {
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('kimi-k2' as ModelId, anthropicOnly)).toBe('claude-sonnet-5');
    });

    it('kimi-k2.7-code is recognized as kimi provider', () => {
      expect(getModelProviderSync('kimi-k2.7-code' as ModelId)).toBe('kimi');
    });

    it('kimi-k2.7-code falls back to Sonnet when kimi is disabled', () => {
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('kimi-k2.7-code' as ModelId, anthropicOnly)).toBe('claude-sonnet-5');
    });

    it('kimi-k2.7-code is a known model capability', () => {
      expect(hasModelCapabilitySync('kimi-k2.7-code')).toBe(true);
    });

    it('glm-5.2 is recognized as zai provider', () => {
      expect(getModelProviderSync('glm-5.2' as ModelId)).toBe('zai');
      expect(requiresExternalKeySync('glm-5.2' as ModelId)).toBe(true);
    });

    it('glm-5.2 falls back to Sonnet when zai is disabled', () => {
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('glm-5.2' as ModelId, anthropicOnly)).toBe('claude-sonnet-5');
    });

    it('glm-5.2 stays when zai is enabled', () => {
      const zaiEnabled = new Set<ModelProvider>(['zai']);
      expect(applyFallbackSync('glm-5.2' as ModelId, zaiEnabled)).toBe('glm-5.2');
    });

    it('glm-5.2 is a known model capability', () => {
      expect(hasModelCapabilitySync('glm-5.2')).toBe(true);
    });

    it('glm-5.2 exposes only high and max effort levels', () => {
      expect(getModelEffortLevelsSync('glm-5.2')).toEqual(['high', 'max']);
      expect(modelSupportsEffortSync('glm-5.2', 'high')).toBe(true);
      expect(modelSupportsEffortSync('glm-5.2', 'max')).toBe(true);
      expect(modelSupportsEffortSync('glm-5.2', 'low')).toBe(false);
      expect(modelSupportsEffortSync('glm-5.2', 'medium')).toBe(false);
      expect(modelSupportsEffortSync('glm-5.2', 'xhigh')).toBe(false);
    });

    // PAN-1956: contextWindow must reflect the 1M *input* context, not the 128K
    // max *output* token limit. 128000 was the output cap misread as input.
    it('glm-5.2 contextWindow is 1M input context (PAN-1956)', () => {
      expect(MODEL_CAPABILITIES['glm-5.2'].contextWindow).toBe(1000000);
      expect(MODEL_CAPABILITIES['glm-5.2'].contextWindow).not.toBe(128000);
    });

    // PAN-1956 / PAN-1685: GLM-5.2 is text-only per Z.AI's spec table
    // (Input Modalities: Text); vision is a separate model line (GLM-5V-Turbo).
    it('glm-5.2 is text-only (supportsImages false)', () => {
      expect(MODEL_CAPABILITIES['glm-5.2'].supportsImages).toBe(false);
      expect(modelSupportsImagesSync('glm-5.2')).toBe(false);
    });

    // PAN-1956 (GLM-5.1, same bug pattern as GLM-5.2): contextWindow must reflect
    // the 200K *input* context, not the 128K max *output* token limit.
    it('glm-5.1 contextWindow is 200K input context (PAN-1956)', () => {
      expect(MODEL_CAPABILITIES['glm-5.1'].contextWindow).toBe(200000);
      expect(MODEL_CAPABILITIES['glm-5.1'].contextWindow).not.toBe(128000);
    });

    // PAN-1956 / PAN-1685: GLM-5.1 is text-only per Z.AI's spec table and its
    // own research artifact (docs/research/glm-5.1-work-type-fit.md).
    it('glm-5.1 is text-only (supportsImages false)', () => {
      expect(MODEL_CAPABILITIES['glm-5.1'].supportsImages).toBe(false);
      expect(modelSupportsImagesSync('glm-5.1')).toBe(false);
    });

    // PAN-1956: costPer1MTokens is the documented avg of input/output
    // ($1.4 in / $4.4 out → $2.9 per docs.z.ai/guides/overview/pricing).
    it('glm-5.2 costPer1MTokens reflects verified Z.AI pricing (PAN-1956)', () => {
      expect(MODEL_CAPABILITIES['glm-5.2'].costPer1MTokens).toBe(2.9);
      expect(MODEL_CAPABILITIES['glm-5.2'].costPer1MTokens).not.toBe(2);
    });

    it('glm-5.1 costPer1MTokens reflects verified Z.AI pricing (PAN-1956)', () => {
      expect(MODEL_CAPABILITIES['glm-5.1'].costPer1MTokens).toBe(2.9);
      expect(MODEL_CAPABILITIES['glm-5.1'].costPer1MTokens).not.toBe(2);
    });

    it('claude-opus-4-7 is recognized as anthropic provider', () => {
      expect(getModelProviderSync('claude-opus-4-7')).toBe('anthropic');
      expect(requiresExternalKeySync('claude-opus-4-7')).toBe(false);
    });

    it('glm-4.7 and glm-4.7-flash appear in getAvailableModels when zai is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'zai']);
      const models = getAvailableModelsSync(enabled);
      expect(models).toContain('glm-5.2');
      expect(models).toContain('glm-4.7');
      expect(models).toContain('glm-4.7-flash');
      expect(models).toContain('glm-5.1');
    });

    it('grok-build-0.1 is recognized as xai provider', () => {
      expect(getModelProviderSync('grok-build-0.1' as ModelId)).toBe('xai');
    });

    it('grok-build-0.1 falls back to Sonnet when xai is disabled', () => {
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallbackSync('grok-build-0.1' as ModelId, anthropicOnly)).toBe('claude-sonnet-5');
    });

    it('grok-build-0.1 is a known model capability', () => {
      expect(hasModelCapabilitySync('grok-build-0.1')).toBe(true);
    });
  });
});
