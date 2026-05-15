import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ModelProvider,
  getModelProvider,
  requiresExternalKey,
  getModelsByProvider,
  isProviderEnabled,
  applyFallback,
  getFallbackModel,
  detectEnabledProviders,
  filterAvailableModels,
  getAvailableModels,
} from '../../src/lib/model-fallback.js';
import { ModelId } from '../../src/lib/settings.js';

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
      expect(getModelProvider('claude-opus-4-6')).toBe('anthropic');
      expect(getModelProvider('claude-sonnet-4-5')).toBe('anthropic');
      expect(getModelProvider('claude-haiku-4-5')).toBe('anthropic');
    });

    it('should return openai for OpenAI models', () => {
      expect(getModelProvider('gpt-5.3-codex')).toBe('openai');
      expect(getModelProvider('o3-deep-research')).toBe('openai');
      expect(getModelProvider('gpt-4o')).toBe('openai');
      expect(getModelProvider('gpt-4o-mini')).toBe('openai');
    });

    it('should return google for Gemini models', () => {
      expect(getModelProvider('gemini-3-pro-preview')).toBe('google');
      expect(getModelProvider('gemini-3-flash-preview')).toBe('google');
    });

    it('should return nous for Nous Portal models', () => {
      expect(getModelProvider('qwen/qwen3.6-plus')).toBe('nous');
    });
  });

  describe('requiresExternalKey', () => {
    it('should return false for Anthropic models', () => {
      expect(requiresExternalKey('claude-opus-4-6')).toBe(false);
      expect(requiresExternalKey('claude-sonnet-4-5')).toBe(false);
      expect(requiresExternalKey('claude-haiku-4-5')).toBe(false);
    });

    it('should return true for OpenAI models', () => {
      expect(requiresExternalKey('gpt-5.3-codex')).toBe(true);
      expect(requiresExternalKey('gpt-4o')).toBe(true);
    });

    it('should return true for Google models', () => {
      expect(requiresExternalKey('gemini-3-pro-preview')).toBe(true);
      expect(requiresExternalKey('gemini-3-flash-preview')).toBe(true);
    });

    it('should return true for Nous Portal models', () => {
      expect(requiresExternalKey('qwen/qwen3.6-plus')).toBe(true);
    });
  });

  describe('getModelsByProvider', () => {
    it('should return all Anthropic models', () => {
      const models = getModelsByProvider('anthropic');
      expect(models).toContain('claude-opus-4-7');
      expect(models).toContain('claude-opus-4-6');
      expect(models).toContain('claude-sonnet-4-6');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(5);
    });

    it('should return all OpenAI models', () => {
      const models = getModelsByProvider('openai');
      expect(models).toContain('gpt-5.5');
      expect(models).toContain('gpt-5.5-pro');
      expect(models).toContain('gpt-5.4');
      expect(models).toContain('gpt-5.4-mini');
      expect(models).toContain('gpt-5.4-pro');
      expect(models).toContain('gpt-5.3-codex');
      expect(models).toContain('gpt-5.2');
      expect(models).toContain('o3');
      expect(models).toContain('o4-mini');
      expect(models).toContain('o3-deep-research'); // legacy
      expect(models).toContain('gpt-4o'); // legacy
      expect(models).toContain('gpt-4o-mini'); // legacy
      expect(models).toHaveLength(12);
    });

    it('should return all Google models', () => {
      const models = getModelsByProvider('google');
      expect(models).toContain('gemini-3.1-pro-preview');
      expect(models).toContain('gemini-3-flash-preview');
      expect(models).toContain('gemini-3.1-flash-lite-preview');
      expect(models).toContain('gemini-3-pro-preview'); // legacy
      expect(models).toContain('gemini-2.5-pro'); // legacy
      expect(models).toContain('gemini-2.5-flash'); // legacy
      expect(models).toHaveLength(6);
    });

    it('should return all Nous Portal models', () => {
      const models = getModelsByProvider('nous');
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
      const filtered = filterAvailableModels(
        ['claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-5.4'] as ModelId[],
        noAnthropic
      );
      expect(filtered).not.toContain('claude-opus-4-6');
      expect(filtered).not.toContain('claude-sonnet-4-6');
      expect(filtered).toContain('gpt-5.4');
    });

    it('getAvailableModels excludes Claude models when Anthropic is disabled', () => {
      const noAnthropic = new Set<ModelProvider>(['openai']);
      const available = getAvailableModels(noAnthropic);
      for (const model of available) {
        expect(getModelProvider(model)).not.toBe('anthropic');
      }
    });

    it('applyFallback does not fall back to Anthropic when Anthropic is disabled (MiniMax-only)', () => {
      // Regression: with anthropic=false and minimax=true, a disabled-provider model must NOT
      // silently rewrite to claude-sonnet-4-6. The original model is returned with a warning.
      const minimaxOnly = new Set<ModelProvider>(['minimax']);
      // minimax-m2.7 is enabled — should pass through unchanged
      expect(applyFallback('minimax-m2.7' as ModelId, minimaxOnly)).toBe('minimax-m2.7');
      // gpt-5.4 is disabled (openai not in set) AND Anthropic is also disabled —
      // must NOT return claude-sonnet-4-6
      const result = applyFallback('gpt-5.4' as ModelId, minimaxOnly);
      expect(getModelProvider(result)).not.toBe('anthropic');
    });

    it('applyFallback falls back to Anthropic when Anthropic IS enabled and provider is disabled', () => {
      // Standard path: openai disabled, anthropic enabled → Anthropic fallback applied
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.4' as ModelId, anthropicOnly)).toBe('claude-sonnet-4-6');
    });
  });

  describe('applyFallback', () => {
    it('should return original model if provider is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      expect(applyFallback('gpt-5.3-codex', enabled)).toBe('gpt-5.3-codex');
      expect(applyFallback('claude-opus-4-6', enabled)).toBe('claude-opus-4-6');
    });

    it('should fallback GPT-5.2 Codex to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.3-codex', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback O3 Deep Research to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('o3-deep-research', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback GPT-4o to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-4o', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback GPT-4o-mini to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-4o-mini', enabled)).toBe('claude-haiku-4-5');
    });

    it('should fallback Gemini Pro to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gemini-3-pro-preview', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback Gemini Flash to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gemini-3-flash-preview', enabled)).toBe('claude-haiku-4-5');
    });

    it('should log warning when applying fallback', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      applyFallback('gpt-5.3-codex', enabled);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Model gpt-5.3-codex requires openai API key')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to claude-sonnet-4-6')
      );
    });

    it('should not log warning when provider is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      applyFallback('gpt-5.3-codex', enabled);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should always return Anthropic models unchanged', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('claude-opus-4-6', enabled)).toBe('claude-opus-4-6');
      expect(applyFallback('claude-sonnet-4-5', enabled)).toBe('claude-sonnet-4-5');
      expect(applyFallback('claude-haiku-4-5', enabled)).toBe('claude-haiku-4-5');
    });
  });

  describe('getFallbackModel', () => {
    it('should return Anthropic models unchanged', () => {
      expect(getFallbackModel('claude-opus-4-6')).toBe('claude-opus-4-6');
      expect(getFallbackModel('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
      expect(getFallbackModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for OpenAI models', () => {
      expect(getFallbackModel('gpt-5.3-codex')).toBe('claude-sonnet-4-6');
      expect(getFallbackModel('o3-deep-research')).toBe('claude-sonnet-4-6');
      expect(getFallbackModel('gpt-4o')).toBe('claude-sonnet-4-6');
      expect(getFallbackModel('gpt-4o-mini')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for Google models', () => {
      expect(getFallbackModel('gemini-3-pro-preview')).toBe('claude-sonnet-4-6');
      expect(getFallbackModel('gemini-3-flash-preview')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for Nous Portal models', () => {
      expect(getFallbackModel('qwen/qwen3.6-plus')).toBe('claude-sonnet-4-6');
    });
  });

  describe('detectEnabledProviders', () => {
    it('should always include Anthropic', () => {
      const enabled = detectEnabledProviders({});
      expect(enabled.has('anthropic')).toBe(true);
    });

    it('should detect OpenAI when key present', () => {
      const enabled = detectEnabledProviders({ openai: 'sk-test' });
      expect(enabled.has('openai')).toBe(true);
    });

    it('should detect Google when key present', () => {
      const enabled = detectEnabledProviders({ google: 'test-key' });
      expect(enabled.has('google')).toBe(true);
    });

    it('should detect Nous Portal when key present', () => {
      const enabled = detectEnabledProviders({ nous: 'nous-key' });
      expect(enabled.has('nous')).toBe(true);
    });

    it('should detect multiple providers', () => {
      const enabled = detectEnabledProviders({
        openai: 'sk-test',
        google: 'test-key',
      });

      expect(enabled.size).toBe(3); // anthropic + 2 others
      expect(enabled.has('anthropic')).toBe(true);
      expect(enabled.has('openai')).toBe(true);
      expect(enabled.has('google')).toBe(true);
    });

    it('should ignore empty strings', () => {
      const enabled = detectEnabledProviders({
        openai: '',
        google: '  ',
      });

      expect(enabled.size).toBe(1); // Only anthropic
      expect(enabled.has('anthropic')).toBe(true);
      expect(enabled.has('openai')).toBe(false);
      expect(enabled.has('google')).toBe(false);
    });

    it('should handle undefined values', () => {
      const enabled = detectEnabledProviders({
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

      const filtered = filterAvailableModels(models, enabled);
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

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toEqual(models);
    });

    it('should filter based on enabled providers', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models: ModelId[] = [
        'claude-opus-4-6',
        'gpt-5.3-codex',
        'gemini-3-pro-preview',
      ];

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toContain('claude-opus-4-6');
      expect(filtered).toContain('gpt-5.3-codex');
      expect(filtered).not.toContain('gemini-3-pro-preview');
    });
  });

  describe('getAvailableModels', () => {
    it('should return only Anthropic models when only Anthropic enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('claude-opus-4-7');
      expect(models).toContain('claude-opus-4-6');
      expect(models).toContain('claude-sonnet-4-6');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(5);
    });

    it('should return all models when all providers enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai', 'google', 'kimi']);
      const models = getAvailableModels(enabled);

      expect(models.length).toBe(27); // 5 Anthropic + 12 OpenAI + 6 Google + 4 Kimi
    });

    it('should include OpenAI models when OpenAI enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('gpt-5.5');
      expect(models).toContain('gpt-5.4');
      expect(models).toContain('o3');
      expect(models).toContain('gpt-5.3-codex');
      expect(models).toContain('gpt-4o');
      expect(models.length).toBe(17); // 5 Anthropic + 12 OpenAI
    });

    it('should include Google models when Google enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'google']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('gemini-3.1-pro-preview');
      expect(models).toContain('gemini-3-flash-preview');
      expect(models).toContain('gemini-3.1-flash-lite-preview');
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gemini-2.5-flash');
      expect(models.length).toBe(11); // 5 Anthropic + 6 Google
    });
  });

  describe('fallback strategy validation', () => {
    it('should map premium models to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.3-codex', enabled)).toBe('claude-sonnet-4-6');
      expect(applyFallback('o3-deep-research', enabled)).toBe('claude-sonnet-4-6');
      expect(applyFallback('gemini-3-pro-preview', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should map economy models to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-4o-mini', enabled)).toBe('claude-haiku-4-5');
      expect(applyFallback('gemini-3-flash-preview', enabled)).toBe('claude-haiku-4-5');
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
        const fallback = applyFallback(model, enabled);
        expect(fallback).not.toBe('claude-opus-4-6');
      });
    });
  });

  describe('newly introduced model catalog regression (PAN-540)', () => {
    it('glm-4.7 is recognized as zai provider', () => {
      expect(getModelProvider('glm-4.7' as ModelId)).toBe('zai');
      expect(getModelProvider('glm-4.7-flash' as ModelId)).toBe('zai');
    });

    it('glm-4.7 requires external key', () => {
      expect(requiresExternalKey('glm-4.7' as ModelId)).toBe(true);
      expect(requiresExternalKey('glm-4.7-flash' as ModelId)).toBe(true);
    });

    it('glm-4.7 appears in getModelsByProvider for zai', () => {
      const zaiModels = getModelsByProvider('zai');
      expect(zaiModels).toContain('glm-4.7');
      expect(zaiModels).toContain('glm-4.7-flash');
      expect(zaiModels).toContain('glm-5.1');
    });

    it('glm-4.7 falls back to Sonnet and glm-4.7-flash falls back to Haiku when zai is disabled', () => {
      // glm-4.7 is strong-tier (like Sonnet), glm-4.7-flash is economy-tier (like Haiku).
      // Explicit FALLBACK_MAP entries ensure tier-correct results regardless of the
      // MODEL_DEPRECATIONS chain (which previously mapped both through glm-5.1 → Sonnet).
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('glm-4.7' as ModelId, anthropicOnly)).toBe('claude-sonnet-4-6');
      expect(applyFallback('glm-4.7-flash' as ModelId, anthropicOnly)).toBe('claude-haiku-4-5');
    });

    it('glm-4.7 stays when zai is enabled', () => {
      const zaiEnabled = new Set<ModelProvider>(['zai']);
      expect(applyFallback('glm-4.7' as ModelId, zaiEnabled)).toBe('glm-4.7');
    });

    it('kimi-k2 is recognized as kimi provider', () => {
      expect(getModelProvider('kimi-k2' as ModelId)).toBe('kimi');
    });

    it('kimi-k2 falls back to Sonnet when kimi is disabled', () => {
      const anthropicOnly = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('kimi-k2' as ModelId, anthropicOnly)).toBe('claude-sonnet-4-6');
    });

    it('claude-opus-4-7 is recognized as anthropic provider', () => {
      expect(getModelProvider('claude-opus-4-7')).toBe('anthropic');
      expect(requiresExternalKey('claude-opus-4-7')).toBe(false);
    });

    it('glm-4.7 and glm-4.7-flash appear in getAvailableModels when zai is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'zai']);
      const models = getAvailableModels(enabled);
      expect(models).toContain('glm-4.7');
      expect(models).toContain('glm-4.7-flash');
      expect(models).toContain('glm-5.1');
    });
  });
});
