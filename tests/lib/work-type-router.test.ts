import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WorkTypeRouter,
  getGlobalRouter,
  resetGlobalRouter,
  reloadGlobalRouter,
  getModel,
  getModelId,
  hasOverride,
  getPresetName,
  getDebugInfo,
} from '../../src/lib/work-type-router.js';
import { NormalizedConfig } from '../../src/lib/config-yaml.js';
import { ModelProvider } from '../../src/lib/model-fallback.js';
import { WorkTypeId } from '../../src/lib/work-types.js';

describe('work-type-router', () => {
  // Clean up global router after each test
  afterEach(() => {
    resetGlobalRouter();
  });

  describe('WorkTypeRouter class', () => {
    describe('constructor', () => {
      it('should accept custom config', () => {
        const config: NormalizedConfig = {
          preset: 'premium',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        expect(router.getPreset()).toBe('premium');
      });

      it('should load default config when not provided', () => {
        const router = new WorkTypeRouter();
        expect(router.getPreset()).toBeTruthy();
        expect(router.getEnabledProviders()).toContain('anthropic');
      });
    });

    describe('getModel', () => {
      it('should resolve model from preset', () => {
        const config: NormalizedConfig = {
          preset: 'premium',
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
          apiKeys: { openai: 'test' },
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:planning');

        expect(result.model).toBe('claude-opus-4-5');
        expect(result.workType).toBe('issue-agent:planning');
        expect(result.source).toBe('preset');
        expect(result.preset).toBe('premium');
        expect(result.usedFallback).toBe(false);
      });

      it('should use override when configured', () => {
        const config: NormalizedConfig = {
          preset: 'budget',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:planning');

        expect(result.model).toBe('claude-opus-4-5');
        expect(result.source).toBe('override');
        expect(result.usedFallback).toBe(false);
      });

      it('should apply fallback when provider disabled', () => {
        const config: NormalizedConfig = {
          preset: 'premium',
          enabledProviders: new Set<ModelProvider>(['anthropic']), // OpenAI disabled
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:implementation');

        // Premium preset uses gpt-5.2-codex, should fallback to Sonnet
        expect(result.model).toBe('claude-sonnet-4-5');
        expect(result.source).toBe('preset');
        expect(result.usedFallback).toBe(true);
        expect(result.originalModel).toBe('gpt-5.2-codex');
      });

      it('should apply fallback to overrides', () => {
        const config: NormalizedConfig = {
          preset: 'budget',
          enabledProviders: new Set<ModelProvider>(['anthropic']), // OpenAI disabled
          apiKeys: {},
          overrides: {
            'issue-agent:testing': 'gpt-4o', // Override with disabled provider
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:testing');

        expect(result.model).toBe('claude-sonnet-4-5'); // Fallback
        expect(result.source).toBe('override');
        expect(result.usedFallback).toBe(true);
        expect(result.originalModel).toBe('gpt-4o');
      });

      it('should throw on invalid work type', () => {
        const router = new WorkTypeRouter();
        expect(() => router.getModel('invalid-work-type' as WorkTypeId)).toThrow();
      });

      it('should work for all valid work types', () => {
        const config: NormalizedConfig = {
          preset: 'balanced',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const workTypes: WorkTypeId[] = [
          'issue-agent:exploration',
          'issue-agent:planning',
          'specialist-review-agent',
          'subagent:explore',
          'convoy:security-reviewer',
          'prd-agent',
          'cli:interactive',
        ];

        workTypes.forEach((workType) => {
          const result = router.getModel(workType);
          expect(result.model).toBeTruthy();
          expect(result.workType).toBe(workType);
        });
      });
    });

    describe('getModelId', () => {
      it('should return just the model ID', () => {
        const config: NormalizedConfig = {
          preset: 'premium',
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
          apiKeys: { openai: 'test' },
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const modelId = router.getModelId('issue-agent:planning');

        expect(modelId).toBe('claude-opus-4-5');
        expect(typeof modelId).toBe('string');
      });
    });

    describe('hasOverride', () => {
      it('should return true when override exists', () => {
        const config: NormalizedConfig = {
          preset: 'budget',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        expect(router.hasOverride('issue-agent:planning')).toBe(true);
      });

      it('should return false when no override exists', () => {
        const config: NormalizedConfig = {
          preset: 'budget',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        expect(router.hasOverride('issue-agent:planning')).toBe(false);
      });
    });

    describe('getPreset', () => {
      it('should return configured preset', () => {
        const config: NormalizedConfig = {
          preset: 'premium',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        expect(router.getPreset()).toBe('premium');
      });
    });

    describe('getEnabledProviders', () => {
      it('should return set of enabled providers', () => {
        const config: NormalizedConfig = {
          preset: 'balanced',
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai', 'google']),
          apiKeys: { openai: 'test', google: 'test' },
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const providers = router.getEnabledProviders();

        expect(providers.has('anthropic')).toBe(true);
        expect(providers.has('openai')).toBe(true);
        expect(providers.has('google')).toBe(true);
        expect(providers.has('zai')).toBe(false);
      });
    });

    describe('getOverrides', () => {
      it('should return all configured overrides', () => {
        const config: NormalizedConfig = {
          preset: 'budget',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5',
            'convoy:security-reviewer': 'claude-opus-4-5',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const overrides = router.getOverrides();

        expect(overrides['issue-agent:planning']).toBe('claude-opus-4-5');
        expect(overrides['convoy:security-reviewer']).toBe('claude-opus-4-5');
      });

      it('should return copy (not reference)', () => {
        const config: NormalizedConfig = {
          preset: 'budget',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const overrides1 = router.getOverrides();
        const overrides2 = router.getOverrides();

        expect(overrides1).not.toBe(overrides2);
        expect(overrides1).toEqual(overrides2);
      });
    });

    describe('getApiKeys', () => {
      it('should return configured API keys', () => {
        const config: NormalizedConfig = {
          preset: 'balanced',
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
          apiKeys: { openai: 'sk-test' },
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const apiKeys = router.getApiKeys();

        expect(apiKeys.openai).toBe('sk-test');
      });
    });

    describe('getGeminiThinkingLevel', () => {
      it('should return configured thinking level', () => {
        const config: NormalizedConfig = {
          preset: 'balanced',
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 4,
        };

        const router = new WorkTypeRouter(config);
        expect(router.getGeminiThinkingLevel()).toBe(4);
      });
    });

    describe('getDebugInfo', () => {
      it('should return complete debug information', () => {
        const config: NormalizedConfig = {
          preset: 'premium',
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
          apiKeys: { openai: 'sk-test' },
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const debug = router.getDebugInfo();

        expect(debug.preset).toBe('premium');
        expect(debug.enabledProviders).toContain('anthropic');
        expect(debug.enabledProviders).toContain('openai');
        expect(debug.overrideCount).toBe(1);
        expect(debug.hasApiKeys.openai).toBe(true);
        expect(debug.hasApiKeys.google).toBe(false);
      });
    });
  });

  describe('global router functions', () => {
    beforeEach(() => {
      resetGlobalRouter();
    });

    describe('getGlobalRouter', () => {
      it('should return singleton instance', () => {
        const router1 = getGlobalRouter();
        const router2 = getGlobalRouter();

        expect(router1).toBe(router2);
      });

      it('should initialize on first call', () => {
        const router = getGlobalRouter();
        expect(router).toBeInstanceOf(WorkTypeRouter);
      });
    });

    describe('resetGlobalRouter', () => {
      it('should reset singleton', () => {
        const router1 = getGlobalRouter();
        resetGlobalRouter();
        const router2 = getGlobalRouter();

        expect(router1).not.toBe(router2);
      });
    });

    describe('getModel (global)', () => {
      it('should use global router', () => {
        const result = getModel('issue-agent:exploration');
        expect(result.model).toBeTruthy();
        expect(result.workType).toBe('issue-agent:exploration');
      });
    });

    describe('getModelId (global)', () => {
      it('should use global router', () => {
        const modelId = getModelId('issue-agent:planning');
        expect(typeof modelId).toBe('string');
        expect(modelId).toBeTruthy();
      });
    });

    describe('hasOverride (global)', () => {
      it('should use global router', () => {
        // Default config has no overrides
        const hasIt = hasOverride('issue-agent:planning');
        expect(typeof hasIt).toBe('boolean');
      });
    });

    describe('getPresetName (global)', () => {
      it('should use global router', () => {
        const preset = getPresetName();
        expect(['premium', 'balanced', 'budget']).toContain(preset);
      });
    });

    describe('getDebugInfo (global)', () => {
      it('should use global router', () => {
        const debug = getDebugInfo();
        expect(debug.preset).toBeTruthy();
        expect(debug.enabledProviders).toBeDefined();
      });
    });
  });

  describe('resolution precedence', () => {
    it('should prefer override over preset', () => {
      const config: NormalizedConfig = {
        preset: 'budget', // Would use Haiku
        enabledProviders: new Set<ModelProvider>(['anthropic']),
        apiKeys: {},
        overrides: {
          'issue-agent:planning': 'claude-opus-4-5', // Override to Opus
        },
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:planning');

      expect(result.model).toBe('claude-opus-4-5');
      expect(result.source).toBe('override');
    });

    it('should use preset when no override', () => {
      const config: NormalizedConfig = {
        preset: 'premium',
        enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
        apiKeys: { openai: 'test' },
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:implementation');

      expect(result.model).toBe('gpt-5.2-codex'); // From premium preset
      expect(result.source).toBe('preset');
    });

    it('should apply fallback after override resolution', () => {
      const config: NormalizedConfig = {
        preset: 'budget',
        enabledProviders: new Set<ModelProvider>(['anthropic']), // No OpenAI
        apiKeys: {},
        overrides: {
          'issue-agent:testing': 'gpt-5.2-codex', // Override requires OpenAI
        },
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:testing');

      // Override takes precedence, but then fallback is applied
      expect(result.source).toBe('override');
      expect(result.model).toBe('claude-sonnet-4-5'); // Fallback
      expect(result.usedFallback).toBe(true);
      expect(result.originalModel).toBe('gpt-5.2-codex');
    });

    it('should apply fallback after preset resolution', () => {
      const config: NormalizedConfig = {
        preset: 'balanced', // Uses Gemini Pro for implementation
        enabledProviders: new Set<ModelProvider>(['anthropic']), // No Google
        apiKeys: {},
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:implementation');

      expect(result.source).toBe('preset');
      expect(result.model).toBe('claude-sonnet-4-5'); // Fallback
      expect(result.usedFallback).toBe(true);
      expect(result.originalModel).toBe('gemini-3-pro-preview');
    });
  });

  describe('multi-provider scenarios', () => {
    it('should work with all providers enabled', () => {
      const config: NormalizedConfig = {
        preset: 'premium',
        enabledProviders: new Set<ModelProvider>(['anthropic', 'openai', 'google', 'zai']),
        apiKeys: {
          openai: 'sk-test',
          google: 'test',
          zai: 'test',
        },
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);

      // Should use all providers without fallback
      const impl = router.getModel('issue-agent:implementation');
      expect(impl.model).toBe('gpt-5.2-codex');
      expect(impl.usedFallback).toBe(false);

      const explore = router.getModel('issue-agent:exploration');
      expect(explore.model).toBe('gemini-3-flash-preview');
      expect(explore.usedFallback).toBe(false);
    });

    it('should work with only Anthropic', () => {
      const config: NormalizedConfig = {
        preset: 'balanced',
        enabledProviders: new Set<ModelProvider>(['anthropic']),
        apiKeys: {},
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);

      // All should fallback to Anthropic models
      const impl = router.getModel('issue-agent:implementation');
      expect(impl.model).toBe('claude-sonnet-4-5'); // Fallback from Gemini Pro
      expect(impl.usedFallback).toBe(true);

      const explore = router.getModel('issue-agent:exploration');
      expect(explore.model).toBe('claude-haiku-4-5'); // Fallback from Gemini Flash
      expect(explore.usedFallback).toBe(true);
    });

    it('should work with selective providers', () => {
      const config: NormalizedConfig = {
        preset: 'balanced',
        enabledProviders: new Set<ModelProvider>(['anthropic', 'google']),
        apiKeys: { google: 'test' },
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);

      // Gemini models should work
      const explore = router.getModel('issue-agent:exploration');
      expect(explore.model).toBe('gemini-3-flash-preview');
      expect(explore.usedFallback).toBe(false);

      // Balanced preset uses Gemini Pro for implementation, which is available
      const impl = router.getModel('issue-agent:implementation');
      expect(impl.model).toBe('gemini-3-pro-preview'); // Gemini Pro is enabled
      expect(impl.usedFallback).toBe(false);
    });
  });
});
