/**
 * Integration tests for configuration precedence
 *
 * Tests the priority order of configuration within the WorkTypeRouter:
 * 1. Per-work-type overrides have highest priority
 * 2. Preset defaults are used when no overrides exist
 * 3. Fallback is applied when providers are disabled
 * 4. Router correctly uses normalized config
 */

import { describe, it, expect } from 'vitest';
import { WorkTypeRouter } from '../../src/lib/work-type-router.js';
import type { NormalizedConfig } from '../../src/lib/config-yaml.js';
import type { WorkTypeId } from '../../src/lib/work-types.js';
import type { PresetName } from '../../src/lib/model-presets.js';

/**
 * Helper to create a test config
 */
function createTestConfig(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return {
    preset: 'balanced',
    enabledProviders: new Set(['anthropic']),
    apiKeys: {},
    overrides: {},
    geminiThinkingLevel: 3,
    ...overrides,
  };
}

describe('configuration precedence in router', () => {
  describe('override vs preset precedence', () => {
    it('should use override instead of preset default', () => {
      const config = createTestConfig({
        preset: 'budget', // Budget preset would use cheaper models
        overrides: {
          'issue-agent:planning': 'claude-opus-4-5', // But we override planning to use Opus
        },
      });

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:planning' as WorkTypeId);

      expect(result.model).toBe('claude-opus-4-5');
      expect(result.source).toBe('override');
      expect(result.preset).toBe('budget');
    });

    it('should fall back to preset default when no override', () => {
      const config = createTestConfig({
        preset: 'premium', // Premium uses best models
        overrides: {}, // No overrides
      });

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:planning' as WorkTypeId);

      expect(result.source).toBe('preset');
      expect(result.preset).toBe('premium');
      // Premium should use Opus for planning
      expect(result.model).toMatch(/opus|o1/i);
    });
  });

  describe('preset differences', () => {
    it('should use different models for different presets', () => {
      const workType = 'issue-agent:planning' as WorkTypeId;

      // Budget: should use cheaper models
      const budgetRouter = new WorkTypeRouter(createTestConfig({ preset: 'budget' }));
      const budgetModel = budgetRouter.getModelId(workType);

      // Balanced: should use mid-tier models
      const balancedRouter = new WorkTypeRouter(createTestConfig({ preset: 'balanced' }));
      const balancedModel = balancedRouter.getModelId(workType);

      // Premium: should use top-tier models
      const premiumRouter = new WorkTypeRouter(createTestConfig({ preset: 'premium' }));
      const premiumModel = premiumRouter.getModelId(workType);

      // All should be different
      expect(new Set([budgetModel, balancedModel, premiumModel]).size).toBe(3);
    });

    it('should return correct preset name', () => {
      const presets: PresetName[] = ['budget', 'balanced', 'premium'];

      for (const preset of presets) {
        const router = new WorkTypeRouter(createTestConfig({ preset }));
        expect(router.getPreset()).toBe(preset);
      }
    });
  });

  describe('provider filtering', () => {
    it('should apply fallback when provider is disabled', () => {
      const config = createTestConfig({
        preset: 'premium',
        enabledProviders: new Set(['anthropic']), // Only Anthropic enabled
        overrides: {
          'issue-agent:implementation': 'gpt-5.2-codex', // OpenAI model
        },
      });

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:implementation' as WorkTypeId);

      // Should fall back to an Anthropic model
      expect(result.usedFallback).toBe(true);
      expect(result.model).toMatch(/claude/i);
      expect(result.originalModel).toBe('gpt-5.2-codex');
    });

    it('should not apply fallback when provider is enabled', () => {
      const config = createTestConfig({
        preset: 'premium',
        enabledProviders: new Set(['anthropic', 'openai']),
        overrides: {
          'issue-agent:implementation': 'gpt-5.2-codex',
        },
      });

      const router = new WorkTypeRouter(config);
      const result = router.getModel('issue-agent:implementation' as WorkTypeId);

      // Should use the requested model
      expect(result.usedFallback).toBe(false);
      expect(result.model).toBe('gpt-5.2-codex');
    });
  });

  describe('multiple overrides', () => {
    it('should handle multiple overrides independently', () => {
      const config = createTestConfig({
        preset: 'balanced',
        enabledProviders: new Set(['anthropic', 'openai']), // Enable providers so no fallback
        overrides: {
          'issue-agent:exploration': 'claude-haiku-4-5',
          'issue-agent:planning': 'claude-opus-4-5',
          'issue-agent:implementation': 'gpt-5.2-codex',
        },
      });

      const router = new WorkTypeRouter(config);

      expect(router.getModelId('issue-agent:exploration' as WorkTypeId)).toBe('claude-haiku-4-5');
      expect(router.getModelId('issue-agent:planning' as WorkTypeId)).toBe('claude-opus-4-5');
      expect(router.getModelId('issue-agent:implementation' as WorkTypeId)).toBe('gpt-5.2-codex');
    });

    it('should use preset for non-overridden work types', () => {
      const config = createTestConfig({
        preset: 'premium',
        enabledProviders: new Set(['anthropic', 'openai', 'google']), // Enable all providers
        overrides: {
          'issue-agent:planning': 'claude-haiku-4-5', // Only planning overridden
        },
      });

      const router = new WorkTypeRouter(config);

      const planningResult = router.getModel('issue-agent:planning' as WorkTypeId);
      expect(planningResult.source).toBe('override');
      expect(planningResult.model).toBe('claude-haiku-4-5');

      const explorationResult = router.getModel('issue-agent:exploration' as WorkTypeId);
      expect(explorationResult.source).toBe('preset');
      expect(explorationResult.preset).toBe('premium');
    });
  });

  describe('override checking', () => {
    it('should correctly report if work type has override', () => {
      const config = createTestConfig({
        overrides: {
          'issue-agent:planning': 'claude-opus-4-5',
        },
      });

      const router = new WorkTypeRouter(config);

      expect(router.hasOverride('issue-agent:planning' as WorkTypeId)).toBe(true);
      expect(router.hasOverride('issue-agent:exploration' as WorkTypeId)).toBe(false);
    });
  });

  describe('API keys and provider config', () => {
    it('should expose API keys configuration', () => {
      const config = createTestConfig({
        apiKeys: {
          openai: 'test-openai-key',
          google: 'test-google-key',
        },
      });

      const router = new WorkTypeRouter(config);
      const apiKeys = router.getApiKeys();

      expect(apiKeys.openai).toBe('test-openai-key');
      expect(apiKeys.google).toBe('test-google-key');
    });

    it('should expose enabled providers', () => {
      const config = createTestConfig({
        enabledProviders: new Set(['anthropic', 'openai', 'google']),
      });

      const router = new WorkTypeRouter(config);
      const providers = router.getEnabledProviders();

      expect(providers.has('anthropic')).toBe(true);
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('google')).toBe(true);
      expect(providers.has('zai')).toBe(false);
    });
  });

  describe('Gemini thinking level', () => {
    it('should expose Gemini thinking level configuration', () => {
      const levels: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

      for (const level of levels) {
        const config = createTestConfig({
          geminiThinkingLevel: level,
        });

        const router = new WorkTypeRouter(config);
        expect(router.getGeminiThinkingLevel()).toBe(level);
      }
    });
  });

  describe('router reload', () => {
    it('should allow reloading configuration', () => {
      const config1 = createTestConfig({ preset: 'budget' });
      const router = new WorkTypeRouter(config1);

      expect(router.getPreset()).toBe('budget');

      // Simulate config change by creating new config and reloading
      // Note: In real usage, reload() would re-read from disk
      const config2 = createTestConfig({ preset: 'premium' });
      const newRouter = new WorkTypeRouter(config2);

      expect(newRouter.getPreset()).toBe('premium');
    });
  });

  describe('all work types resolved', () => {
    it('should resolve all issue agent phases', () => {
      const router = new WorkTypeRouter(createTestConfig());

      const phases = [
        'exploration',
        'planning',
        'implementation',
        'testing',
        'documentation',
        'review-response',
      ];

      for (const phase of phases) {
        const result = router.getModel(`issue-agent:${phase}` as WorkTypeId);
        expect(result.model).toBeDefined();
        expect(result.model.length).toBeGreaterThan(0);
      }
    });

    it('should resolve all specialist agents', () => {
      const router = new WorkTypeRouter(createTestConfig());

      const specialists = ['review-agent', 'test-agent', 'merge-agent'];

      for (const specialist of specialists) {
        const result = router.getModel(`specialist-${specialist}` as WorkTypeId);
        expect(result.model).toBeDefined();
        expect(result.model.length).toBeGreaterThan(0);
      }
    });
  });
});
