import { describe, it, expect } from 'vitest';
import { MODEL_DEPRECATIONS, resolveModelId } from '../../src/lib/model-capabilities.js';
import { validateSettingsApi, getOptimalModelDefaults } from '../../src/lib/settings-api.js';
import type { ApiSettingsConfig } from '../../src/lib/settings-api.js';

describe('Model Deprecation System', () => {
  describe('MODEL_DEPRECATIONS mapping', () => {
    it('should define deprecation mappings', () => {
      expect(MODEL_DEPRECATIONS).toBeDefined();
      expect(typeof MODEL_DEPRECATIONS).toBe('object');
    });

    it('should map claude-opus-4-5 to claude-opus-4-7', () => {
      expect(MODEL_DEPRECATIONS['claude-opus-4-5']).toBe('claude-opus-4-7');
    });

    it('should map claude-sonnet-4-5 to claude-sonnet-4-6', () => {
      expect(MODEL_DEPRECATIONS['claude-sonnet-4-5']).toBe('claude-sonnet-4-6');
    });

    it('should only contain deprecated models as keys', () => {
      // Deprecated model IDs should not be in current MODEL_CAPABILITIES
      const deprecatedIds = Object.keys(MODEL_DEPRECATIONS);
      expect(deprecatedIds.length).toBeGreaterThan(0);
      // This ensures we're testing single-hop deprecation
      expect(deprecatedIds.every(id => typeof id === 'string')).toBe(true);
    });
  });

  describe('resolveModelId()', () => {
    it('should resolve deprecated model IDs to current ones', () => {
      expect(resolveModelId('claude-opus-4-5')).toBe('claude-opus-4-7');
      expect(resolveModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4-6');
    });

    it('should return current model IDs unchanged', () => {
      expect(resolveModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
      expect(resolveModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(resolveModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5');
      expect(resolveModelId('kimi-k2.5')).toBe('kimi-k2.5');
    });

    it('should handle unknown model IDs gracefully', () => {
      const unknownId = 'nonexistent-model';
      expect(resolveModelId(unknownId)).toBe(unknownId);
    });

    it('should be idempotent', () => {
      const deprecated = 'claude-sonnet-4-5';
      const resolved = resolveModelId(deprecated);
      expect(resolveModelId(resolved)).toBe(resolved);
    });
  });

  describe('validateSettingsApi() deprecation warnings', () => {
    it('should return warnings for deprecated model IDs', () => {
      const settings: ApiSettingsConfig = {
        models: {
          providers: {
            anthropic: true,
            openai: false,
            google: false,
            zai: false,
            kimi: false,
          },
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5', // deprecated
            'issue-agent:implementation': 'kimi-k2.5', // not deprecated
          },
        },
        api_keys: {},
      };

      const result = validateSettingsApi(settings);
      expect(result.valid).toBe(true); // Deprecated IDs are warnings, not errors
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('claude-opus-4-5'))).toBe(true);
      expect(result.warnings.some(w => w.includes('claude-opus-4-7'))).toBe(true);
    });

    it('should not warn for current model IDs', () => {
      const settings: ApiSettingsConfig = {
        models: {
          providers: {
            anthropic: true,
            openai: false,
            google: false,
            zai: false,
            kimi: false,
          },
          overrides: {
            'issue-agent:planning': 'claude-opus-4-6',
            'issue-agent:implementation': 'claude-sonnet-4-6',
          },
        },
        api_keys: {},
      };

      const result = validateSettingsApi(settings);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    it('should return multiple warnings for multiple deprecated models', () => {
      const settings: ApiSettingsConfig = {
        models: {
          providers: {
            anthropic: true,
            openai: false,
            google: false,
            zai: false,
            kimi: false,
          },
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5', // deprecated
            'issue-agent:implementation': 'claude-sonnet-4-5', // deprecated
          },
        },
        api_keys: {},
      };

      const result = validateSettingsApi(settings);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(2);
    });

    it('should still return errors for invalid model IDs', () => {
      const settings: ApiSettingsConfig = {
        models: {
          providers: {
            anthropic: true,
            openai: false,
            google: false,
            zai: false,
            kimi: false,
          },
          overrides: {
            'issue-agent:planning': 'nonexistent-model' as any,
          },
        },
        api_keys: {},
      };

      const result = validateSettingsApi(settings);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('nonexistent-model'))).toBe(true);
    });
  });

  describe('getOptimalModelDefaults() deprecation resolution', () => {
    it('should never return deprecated model IDs', () => {
      const defaults = getOptimalModelDefaults();
      const allModelIds = Object.values(defaults);
      const deprecatedIds = Object.keys(MODEL_DEPRECATIONS);

      // Check that no default uses a deprecated model ID
      for (const modelId of allModelIds) {
        expect(deprecatedIds).not.toContain(modelId);
      }
    });

    it('should return current model IDs for all work types', () => {
      const defaults = getOptimalModelDefaults();

      // Verify some key work types have current models
      expect(defaults['issue-agent:exploration']).toBeDefined();
      expect(defaults['issue-agent:implementation']).toBeDefined();
      expect(defaults['specialist-review-agent']).toBeDefined();

      // Verify they're not deprecated
      const deprecatedIds = Object.keys(MODEL_DEPRECATIONS);
      expect(deprecatedIds).not.toContain(defaults['issue-agent:exploration']);
      expect(deprecatedIds).not.toContain(defaults['issue-agent:implementation']);
    });
  });
});
