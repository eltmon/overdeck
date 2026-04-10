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
      expect(getModelProvider('gpt-5.4')).toBe('openai');
      expect(getModelProvider('o3')).toBe('openai');
      expect(getModelProvider('gpt-5.4-mini')).toBe('openai');
      expect(getModelProvider('gpt-5.4-nano')).toBe('openai');
    });

    it('should return google for Gemini models', () => {
      expect(getModelProvider('gemini-3.1-pro-preview')).toBe('google');
      expect(getModelProvider('gemini-3-flash')).toBe('google');
    });
  });

  describe('requiresExternalKey', () => {
    it('should return false for Anthropic models', () => {
      expect(requiresExternalKey('claude-opus-4-6')).toBe(false);
      expect(requiresExternalKey('claude-sonnet-4-5')).toBe(false);
      expect(requiresExternalKey('claude-haiku-4-5')).toBe(false);
    });

    it('should return true for OpenAI models', () => {
      expect(requiresExternalKey('gpt-5.4')).toBe(true);
      expect(requiresExternalKey('gpt-5.4-mini')).toBe(true);
    });

    it('should return true for Google models', () => {
      expect(requiresExternalKey('gemini-3.1-pro-preview')).toBe(true);
      expect(requiresExternalKey('gemini-3-flash')).toBe(true);
    });
  });

  describe('getModelsByProvider', () => {
    it('should return all Anthropic models', () => {
      const models = getModelsByProvider('anthropic');
      expect(models).toContain('claude-opus-4-6');
      expect(models).toContain('claude-sonnet-4-6');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(4);
    });

    it('should return all OpenAI models', () => {
      const models = getModelsByProvider('openai');
      expect(models).toContain('gpt-5.4');
      expect(models).toContain('gpt-5.4-mini');
      expect(models).toContain('gpt-5.4-nano');
      expect(models).toContain('o3');
      expect(models).toHaveLength(4);
    });

    it('should return all Google models', () => {
      const models = getModelsByProvider('google');
      expect(models).toContain('gemini-3.1-pro-preview');
      expect(models).toContain('gemini-3-flash');
      expect(models).toContain('gemini-3.1-flash-lite-preview');
      expect(models).toHaveLength(3);
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
      expect(applyFallback('gpt-5.4', enabled)).toBe('gpt-5.4');
      expect(applyFallback('claude-opus-4-6', enabled)).toBe('claude-opus-4-6');
    });

    it('should fallback GPT-5.4 to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.4', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback O3 to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('o3', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback GPT-5.4 to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.4', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback GPT-5.4-mini to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.4-mini', enabled)).toBe('claude-haiku-4-5');
    });

    it('should fallback Gemini Pro to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gemini-3.1-pro-preview', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should fallback Gemini Flash to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gemini-3-flash', enabled)).toBe('claude-haiku-4-5');
    });

    it('should log warning when applying fallback', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      applyFallback('gpt-5.4', enabled);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Model gpt-5.4 requires openai API key')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to claude-sonnet-4-6')
      );
    });

    it('should not log warning when provider is enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      applyFallback('gpt-5.4', enabled);

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
      expect(getFallbackModel('gpt-5.4')).toBe('claude-sonnet-4-6');
      expect(getFallbackModel('o3')).toBe('claude-sonnet-4-6');
      expect(getFallbackModel('gpt-5.4-mini')).toBe('claude-haiku-4-5');
      expect(getFallbackModel('gpt-5.4-nano')).toBe('claude-haiku-4-5');
    });

    it('should return fallback for Google models', () => {
      expect(getFallbackModel('gemini-3.1-pro-preview')).toBe('claude-sonnet-4-6');
      expect(getFallbackModel('gemini-3-flash')).toBe('claude-haiku-4-5');
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
        'gpt-5.4',
        'gemini-3.1-pro-preview',
      ];

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toContain('claude-opus-4-6');
      expect(filtered).not.toContain('gpt-5.4');
      expect(filtered).not.toContain('gemini-3.1-pro-preview');
    });

    it('should include all models when all providers enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai', 'google']);
      const models: ModelId[] = [
        'claude-opus-4-6',
        'gpt-5.4',
        'gemini-3.1-pro-preview',
      ];

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toEqual(models);
    });

    it('should filter based on enabled providers', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models: ModelId[] = [
        'claude-opus-4-6',
        'gpt-5.4',
        'gemini-3.1-pro-preview',
      ];

      const filtered = filterAvailableModels(models, enabled);
      expect(filtered).toContain('claude-opus-4-6');
      expect(filtered).toContain('gpt-5.4');
      expect(filtered).not.toContain('gemini-3.1-pro-preview');
    });
  });

  describe('getAvailableModels', () => {
    it('should return only Anthropic models when only Anthropic enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('claude-opus-4-6');
      expect(models).toContain('claude-sonnet-4-6');
      expect(models).toContain('claude-sonnet-4-5');
      expect(models).toContain('claude-haiku-4-5');
      expect(models).toHaveLength(4);
    });

    it('should return all models when all providers enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai', 'google', 'kimi', 'minimax']);
      const models = getAvailableModels(enabled);

      // 4 Anthropic + 4 OpenAI + 3 Google + 1 Kimi + 2 MiniMax = 14
      expect(models.length).toBe(14);
    });

    it('should include OpenAI models when OpenAI enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'openai']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('gpt-5.4');
      expect(models).toContain('gpt-5.4-mini');
      expect(models.length).toBe(8); // 4 Anthropic + 4 OpenAI
    });

    it('should include Google models when Google enabled', () => {
      const enabled = new Set<ModelProvider>(['anthropic', 'google']);
      const models = getAvailableModels(enabled);

      expect(models).toContain('gemini-3.1-pro-preview');
      expect(models).toContain('gemini-3-flash');
      expect(models).toContain('gemini-3.1-flash-lite-preview');
      expect(models.length).toBe(7); // 4 Anthropic + 3 Google
    });
  });

  describe('fallback strategy validation', () => {
    it('should map premium models to Sonnet', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.4', enabled)).toBe('claude-sonnet-4-6');
      expect(applyFallback('o3', enabled)).toBe('claude-sonnet-4-6');
      expect(applyFallback('gemini-3.1-pro-preview', enabled)).toBe('claude-sonnet-4-6');
    });

    it('should map economy models to Haiku', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      expect(applyFallback('gpt-5.4-mini', enabled)).toBe('claude-haiku-4-5');
      expect(applyFallback('gemini-3-flash', enabled)).toBe('claude-haiku-4-5');
    });

    it('should never fallback to Opus by default', () => {
      const enabled = new Set<ModelProvider>(['anthropic']);
      const allModels: ModelId[] = [
        'gpt-5.4',
        'o3',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gemini-3.1-pro-preview',
        'gemini-3-flash',
      ];

      allModels.forEach((model) => {
        const fallback = applyFallback(model, enabled);
        expect(fallback).not.toBe('claude-opus-4-6');
      });
    });
  });
});
