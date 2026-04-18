import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WorkTypeRouter,
  getGlobalRouter,
  resetGlobalRouter,
  reloadGlobalRouter,
  getModel,
  getModelId,
  hasOverride,
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
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        expect(router.getEnabledProviders()).toContain('anthropic');
      });

      it('should load default config when not provided', () => {
        const router = new WorkTypeRouter();
        expect(router.getEnabledProviders()).toContain('anthropic');
      });
    });

    describe('getModel', () => {
      it('should resolve model using smart selection', () => {
        const config: NormalizedConfig = {
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
          apiKeys: { openai: 'test' },
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:exploration');

        expect(result.model).toBeTruthy();
        expect(result.workType).toBe('issue-agent:exploration');
        expect(result.source).toBe('smart');
        expect(result.usedFallback).toBe(false);
      });

      it('should use override when configured', () => {
        const config: NormalizedConfig = {
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:exploration': 'claude-opus-4-6',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:exploration');

        expect(result.model).toBe('claude-opus-4-6');
        expect(result.source).toBe('override');
        expect(result.usedFallback).toBe(false);
      });

      it('should apply fallback when provider disabled', () => {
        const config: NormalizedConfig = {
          enabledProviders: new Set<ModelProvider>(['anthropic']), // OpenAI disabled
          apiKeys: {},
          overrides: {
            'issue-agent:implementation': 'gpt-4o', // Override with disabled provider
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:implementation');

        // Should fallback to an enabled provider
        expect(result.model).toMatch(/^claude-/);
        expect(result.source).toBe('override');
        expect(result.usedFallback).toBe(true);
        expect(result.originalModel).toBe('gpt-4o');
      });

      it('should apply fallback to overrides', () => {
        const config: NormalizedConfig = {
          enabledProviders: new Set<ModelProvider>(['anthropic']), // OpenAI disabled
          apiKeys: {},
          overrides: {
            'issue-agent:testing': 'gpt-4o', // Override with disabled provider
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const result = router.getModel('issue-agent:testing');

        expect(result.model).toMatch(/^claude-/); // Fallback to enabled provider
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
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const workTypes: WorkTypeId[] = [
          'issue-agent:exploration',
          'issue-agent:exploration',
          'specialist-review-agent',
          'specialist-inspect-agent',
          'specialist-uat-agent',
          'subagent:explore',
          'review:security',
          'planning-agent',
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
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
          apiKeys: { openai: 'test' },
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const modelId = router.getModelId('issue-agent:exploration');

        expect(typeof modelId).toBe('string');
        expect(modelId).toBeTruthy();
      });
    });

    describe('hasOverride', () => {
      it('should return true when override exists', () => {
        const config: NormalizedConfig = {
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:exploration': 'claude-opus-4-6',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        expect(router.hasOverride('issue-agent:exploration')).toBe(true);
      });

      it('should return false when no override exists', () => {
        const config: NormalizedConfig = {
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {},
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        expect(router.hasOverride('issue-agent:exploration')).toBe(false);
      });
    });

    describe('getEnabledProviders', () => {
      it('should return set of enabled providers', () => {
        const config: NormalizedConfig = {
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
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:exploration': 'claude-opus-4-6',
            'review:security': 'claude-opus-4-6',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const overrides = router.getOverrides();

        expect(overrides['issue-agent:exploration']).toBe('claude-opus-4-6');
        expect(overrides['review:security']).toBe('claude-opus-4-6');
      });

      it('should return copy (not reference)', () => {
        const config: NormalizedConfig = {
          enabledProviders: new Set<ModelProvider>(['anthropic']),
          apiKeys: {},
          overrides: {
            'issue-agent:exploration': 'claude-opus-4-6',
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
          enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
          apiKeys: { openai: 'sk-test' },
          overrides: {
            'issue-agent:exploration': 'claude-opus-4-6',
          },
          geminiThinkingLevel: 3,
        };

        const router = new WorkTypeRouter(config);
        const debug = router.getDebugInfo();

        expect(debug.enabledProviders).toContain('anthropic');
        expect(debug.enabledProviders).toContain('openai');
        expect(debug.overrideCount).toBe(1);
        expect(debug.hasApiKeys.openai).toBe(true);
        expect(debug.hasApiKeys.google).toBe(false);
        expect(debug.availableModelCount).toBeGreaterThan(0);
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
        const modelId = getModelId('issue-agent:exploration');
        expect(typeof modelId).toBe('string');
        expect(modelId).toBeTruthy();
      });
    });

    describe('hasOverride (global)', () => {
      it('should use global router', () => {
        // Default config has no overrides
        const hasIt = hasOverride('issue-agent:exploration');
        expect(typeof hasIt).toBe('boolean');
      });
    });

    describe('getDebugInfo (global)', () => {
      it('should use global router', () => {
        const debug = getDebugInfo();
        expect(debug.enabledProviders).toBeDefined();
        expect(debug.availableModelCount).toBeGreaterThan(0);
      });
    });
  });

  describe('resolution precedence', () => {
    it('should prefer override over smart selection', () => {
      const config: NormalizedConfig = {
        enabledProviders: new Set<ModelProvider>(['anthropic']),
        apiKeys: {},
        overrides: {
          'issue-agent:exploration': 'claude-opus-4-6',
        },
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:exploration');

      expect(result.model).toBe('claude-opus-4-6');
      expect(result.source).toBe('override');
    });

    it('should use smart selection when no override', () => {
      const config: NormalizedConfig = {
        enabledProviders: new Set<ModelProvider>(['anthropic', 'openai']),
        apiKeys: { openai: 'test' },
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:implementation');

      expect(result.model).toBeTruthy();
      expect(result.source).toBe('smart');
    });

    it('should apply fallback after override resolution', () => {
      const config: NormalizedConfig = {
        enabledProviders: new Set<ModelProvider>(['anthropic']), // No OpenAI
        apiKeys: {},
        overrides: {
          'issue-agent:testing': 'gpt-4o', // Override requires OpenAI
        },
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:testing');

      // Override takes precedence, but then fallback is applied
      expect(result.source).toBe('override');
      expect(result.model).toMatch(/^claude-/); // Fallback
      expect(result.usedFallback).toBe(true);
      expect(result.originalModel).toBe('gpt-4o');
    });
  });

  describe('multi-provider scenarios', () => {
    it('should work with all providers enabled', () => {
      const config: NormalizedConfig = {
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

      // Should select models from available providers
      const impl = router.getModel('issue-agent:implementation');
      expect(impl.model).toBeTruthy();
      expect(impl.source).toBe('smart');

      const explore = router.getModel('issue-agent:exploration');
      expect(explore.model).toBeTruthy();
      expect(explore.source).toBe('smart');
    });

    it('should work with only Anthropic', () => {
      const config: NormalizedConfig = {
        enabledProviders: new Set<ModelProvider>(['anthropic']),
        apiKeys: {},
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);

      // All should use Anthropic models (smart selector picks best from enabled providers)
      const impl = router.getModel('issue-agent:implementation');
      expect(impl.model).toMatch(/^claude-/);
      expect(impl.source).toBe('smart');

      const explore = router.getModel('issue-agent:exploration');
      expect(explore.model).toMatch(/^claude-/);
      // Smart selector finds Claude models for exploration, no fallback needed
      expect(explore.usedFallback).toBe(false);
    });

    it('should work with selective providers', () => {
      const config: NormalizedConfig = {
        enabledProviders: new Set<ModelProvider>(['anthropic', 'google']),
        apiKeys: { google: 'test' },
        overrides: {},
        geminiThinkingLevel: 3,
      };

      const router = new WorkTypeRouter(config);

      // Smart selector picks best model from enabled providers
      const explore = router.getModel('issue-agent:exploration');
      expect(explore.model).toBe('gemini-3-flash');
      expect(explore.usedFallback).toBe(false);

      // Smart selector picks best implementation model from anthropic+google
      const impl = router.getModel('issue-agent:implementation');
      expect(impl.model).toBe('claude-opus-4-7'); // Opus 4.7 scores highest for implementation
      expect(impl.usedFallback).toBe(false);
    });
  });
});
