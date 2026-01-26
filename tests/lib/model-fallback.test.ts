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
      expect(getModelProvider('claude-opus-4-5')).toBe('anthropic');
      expect(getModelProvider('claude-sonnet-4-5')).toBe('anthropic');
      expect(getModelProvider('claude-haiku-4-5')).toBe('anthropic');
    });

    it('should return openai for OpenAI models', () => {
      expect(getModelProvider('gpt-5.2-codex')).toBe('openai');
      expect(getModelProvider('o3-deep-research')).toBe('openai');
      expect(getModelProvider('gpt-4o')).toBe('openai');
      expect(getModelProvider('gpt-4o-mini')).toBe('openai');
    });

    it('should return google for Gemini models', () => {
      expect(getModelProvider('gemini-3-pro-preview')).toBe('google');
      expect(getModelProvider('gemini-3-flash-preview')).toBe('google');
    });

    it('should return zai for GLM models', () => {
      expect(getModelProvider('glm-4.7')).toBe('zai');
      expect(getModelProvider('glm-4.7-flash')).toBe('zai');
    });
  });

  describe('requiresExternalKey', () => {
    it('should return false for Anthropic models', () => {
      expect(requiresExternalKey('claude-opus-4-5')).toBe(false);
      expect(requiresExternalKey('claude-sonnet-4-5')).toBe(false);
      expect(requiresExternalKey('claude-haiku-4-5')).toBe(false);
    });

    it('should return true for OpenAI models', () => {
      expect(requiresExternalKey('gpt-5.2-codex')).toBe(true);
      expect(requiresExternalKey('gpt-4o')).toBe(true);
    });

    it('should return true for Google models', () => {
      expect(requiresExternalKey('gemini-3-pro-preview')).toBe(true);
      expect(requiresExternalKey('gemini-3-flash-preview')).toBe(true);
    });

    it('should return true for Z.AI models', () => {
      expect(requiresExternalKey('glm-4.7')).toBe(true);
      expect(requiresExternalKey('glm-4.7-flash')).toBe(true);
    });
  });

  describe('getModelsByProvider', () => {
    it('should return all Anthropic models', () => {
      const models = getModelsByProvider('anthropic');
      expect(models).toContain('claude-opus-4-5');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(3);
    });

    it('should return all OpenAI models', () => {
      const models = getModelsByProvider('openai');
      expect(models).toContain('gpt-5.2-codex');
      expect(models).toContain('o3-deep-research');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models).toHaveLength(4);
    });

    it('should return all Google models', () => {
      const models = getModelsByProvider('google');
      expect(models).toContain('gemini-3-pro-preview');
      expect(models).toContain('gemini-3-flash-preview');
      expect(models).toHaveLength(2);
    });

    it('should return all Z.AI models', () => {
      const models = getModelsByProvider('zai');
      expect(models).toContain('glm-4.7');
      expect(models).toContain('glm-4.7-flash');
      expect(models).toHaveLength(2);
    });
  });

  describe('isProviderEnabled', () => {
    it('should always return true for Anthropic', () => {
      expect(isProviderEnabled('anthropic', new Set())).toBe(true);
      expect(isProviderEnabled('anthropic', new Set(['openai']))).toBe(true);
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

  describe('applyFallback', () => {
    it('should return original model if provider is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      expect(applyFallback('gpt-5.2-codex', enabled)).toBe('gpt-5.2-codex');
      expect(applyFallback('claude-opus-4-5', enabled)).toBe('claude-opus-4-5');
    });

    it('should fallback GPT-5.2 Codex to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.2-codex', enabled)).toBe('claude-sonnet-4-5');
    });

    it('should fallback O3 Deep Research to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('o3-deep-research', enabled)).toBe('claude-sonnet-4-5');
    });

    it('should fallback GPT-4o to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-4o', enabled)).toBe('claude-sonnet-4-5');
    });

    it('should fallback GPT-4o-mini to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-4o-mini', enabled)).toBe('claude-haiku-4-5');
    });

    it('should fallback Gemini Pro to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gemini-3-pro-preview', enabled)).toBe('claude-sonnet-4-5');
    });

    it('should fallback Gemini Flash to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gemini-3-flash-preview', enabled)).toBe('claude-haiku-4-5');
    });

    it('should fallback GLM-4.7 to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('glm-4.7', enabled)).toBe('claude-haiku-4-5');
    });

    it('should fallback GLM-4.7-flash to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('glm-4.7-flash', enabled)).toBe('claude-haiku-4-5');
    });

    it('should log warning when applying fallback', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      applyFallback('gpt-5.2-codex', enabled);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Model gpt-5.2-codex requires openai API key')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to claude-sonnet-4-5')
      );
    });

    it('should not log warning when provider is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      applyFallback('gpt-5.2-codex', enabled);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should always return Anthropic models unchanged', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('claude-opus-4-5', enabled)).toBe('claude-opus-4-5');
      expect(applyFallback('claude-sonnet-4-5', enabled)).toBe('claude-sonnet-4-5');
      expect(applyFallback('claude-haiku-4-5', enabled)).toBe('claude-haiku-4-5');
    });
  });

  describe('getFallbackModel', () => {
    it('should return Anthropic models unchanged', () => {
      expect(getFallbackModel('claude-opus-4-5')).toBe('claude-opus-4-5');
      expect(getFallbackModel('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
      expect(getFallbackModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for OpenAI models', () => {
      expect(getFallbackModel('gpt-5.2-codex')).toBe('claude-sonnet-4-5');
      expect(getFallbackModel('o3-deep-research')).toBe('claude-sonnet-4-5');
      expect(getFallbackModel('gpt-4o')).toBe('claude-sonnet-4-5');
      expect(getFallbackModel('gpt-4o-mini')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for Google models', () => {
      expect(getFallbackModel('gemini-3-pro-preview')).toBe('claude-sonnet-4-5');
      expect(getFallbackModel('gemini-3-flash-preview')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for Z.AI models', () => {
      expect(getFallbackModel('glm-4.7')).toBe('claude-haiku-4-5');
      expect(getFallbackModel('glm-4.7-flash')).toBe('claude-haiku-4-5');
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

    it('should detect Z.AI when key present', () => {
      const enabled = detectEnabledProviders({ zai: 'test-key' });
      expect(enabled.has('zai')).toBe(true);
    });

    it('should detect multiple providers', () => {
      const enabled = detectEnabledProviders({
        openai: 'sk-test',
        google: 'test-key',
        zai: 'test-key',
      });

      expect(enabled.size).toBe(4); // anthropic + 3 others
      expect(enabled.has('anthropic')).toBe(true);
      expect(enabled.has('openai')).toBe(true);
      expect(enabled.has('google')).toBe(true);
      expect(enabled.has('zai')).toBe(true);
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
        'claude-opus-4-5',
        'gpt-5.2-codex',
        'gemini-3-pro-preview',
      ];

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toContain('claude-opus-4-5');
      expect(filtered).not.toContain('gpt-5.2-codex');
      expect(filtered).not.toContain('gemini-3-pro-preview');
    });

    it('should include all models when all providers enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai', 'google', 'zai']);
      const models: ModelId[] = [
        'claude-opus-4-5',
        'gpt-5.2-codex',
        'gemini-3-pro-preview',
        'glm-4.7',
      ];

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toEqual(models);
    });

    it('should filter based on enabled providers', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models: ModelId[] = [
        'claude-opus-4-5',
        'gpt-5.2-codex',
        'gemini-3-pro-preview',
      ];

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toContain('claude-opus-4-5');
      expect(filtered).toContain('gpt-5.2-codex');
      expect(filtered).not.toContain('gemini-3-pro-preview');
    });
  });

  describe('getAvailableModels', () => {
    it('should return only Anthropic models when only Anthropic enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('claude-opus-4-5');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(3);
    });

    it('should return all models when all providers enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai', 'google', 'zai']);
      const models = getAvailableModels(enabled);

      expect(models.length).toBe(11); // 3 Anthropic + 4 OpenAI + 2 Google + 2 Z.AI
    });

    it('should include OpenAI models when OpenAI enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('gpt-5.2-codex');
      expect(models).toContain('gpt-4o');
      expect(models.length).toBe(7); // 3 Anthropic + 4 OpenAI
    });

    it('should include Google models when Google enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'google']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('gemini-3-pro-preview');
      expect(models).toContain('gemini-3-flash-preview');
      expect(models.length).toBe(5); // 3 Anthropic + 2 Google
    });
  });

  describe('fallback strategy validation', () => {
    it('should map premium models to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.2-codex', enabled)).toBe('claude-sonnet-4-5');
      expect(applyFallback('o3-deep-research', enabled)).toBe('claude-sonnet-4-5');
      expect(applyFallback('gemini-3-pro-preview', enabled)).toBe('claude-sonnet-4-5');
    });

    it('should map economy models to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-4o-mini', enabled)).toBe('claude-haiku-4-5');
      expect(applyFallback('gemini-3-flash-preview', enabled)).toBe('claude-haiku-4-5');
      expect(applyFallback('glm-4.7-flash', enabled)).toBe('claude-haiku-4-5');
    });

    it('should never fallback to Opus by default', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const allModels: ModelId[] = [
        'gpt-5.2-codex',
        'o3-deep-research',
        'gpt-4o',
        'gpt-4o-mini',
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'glm-4.7',
        'glm-4.7-flash',
      ];

      allModels.forEach((model) => {
        const fallback = applyFallback(model, enabled);
        expect(fallback).not.toBe('claude-opus-4-5');
      });
    });
  });
});
