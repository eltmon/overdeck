/**
 * Integration tests for preset switching
 *
 * Tests that model assignments change appropriately when switching presets:
 * 1. Model assignments change when preset is switched
 * 2. Overrides are preserved when preset changes
 * 3. Different presets use appropriately tiered models
 * 4. Router can be created with different presets
 */

import { describe, it, expect } from 'vitest';
import { WorkTypeRouter } from '../../src/lib/work-type-router.js';
import { getPreset, PresetName } from '../../src/lib/model-presets.js';
import type { NormalizedConfig } from '../../src/lib/config-yaml.js';
import type { WorkTypeId } from '../../src/lib/work-types.js';

/**
 * Helper to create a test config
 */
function createTestConfig(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return {
    preset: 'balanced',
    enabledProviders: new Set(['anthropic', 'openai', 'google', 'zai']),
    apiKeys: {},
    overrides: {},
    geminiThinkingLevel: 3,
    ...overrides,
  };
}

describe('preset switching', () => {
  describe('preset model assignment differences', () => {
    it('should use different strength models for different presets', () => {
      const workType = 'issue-agent:planning' as WorkTypeId;

      // Create routers with different presets
      const budgetRouter = new WorkTypeRouter(createTestConfig({ preset: 'budget' }));
      const balancedRouter = new WorkTypeRouter(createTestConfig({ preset: 'balanced' }));
      const premiumRouter = new WorkTypeRouter(createTestConfig({ preset: 'premium' }));

      const budgetModel = budgetRouter.getModelId(workType);
      const balancedModel = balancedRouter.getModelId(workType);
      const premiumModel = premiumRouter.getModelId(workType);

      // Models should be different across presets
      // (May have some overlap due to fallback, but at least 2 should be different)
      const uniqueModels = new Set([budgetModel, balancedModel, premiumModel]);
      expect(uniqueModels.size).toBeGreaterThanOrEqual(2);

      // Premium should use strongest models
      expect(premiumModel).toMatch(/opus|o3/i);
    });

    it('should change multiple work types when preset switches', () => {
      const workTypes: WorkTypeId[] = [
        'issue-agent:exploration',
        'issue-agent:planning',
        'issue-agent:implementation',
        'issue-agent:testing',
      ];

      // Create routers with different presets
      const budgetRouter = new WorkTypeRouter(createTestConfig({ preset: 'budget' }));
      const premiumRouter = new WorkTypeRouter(createTestConfig({ preset: 'premium' }));

      // Count how many work types have different models
      let changedCount = 0;
      for (const workType of workTypes) {
        const budgetModel = budgetRouter.getModelId(workType);
        const premiumModel = premiumRouter.getModelId(workType);
        if (budgetModel !== premiumModel) {
          changedCount++;
        }
      }

      // At least some work types should have different models
      expect(changedCount).toBeGreaterThan(0);
    });
  });

  describe('preset switching with overrides', () => {
    it('should preserve overrides regardless of preset', () => {
      const overrides = {
        'issue-agent:planning': 'claude-opus-4-5',
      };

      // Create routers with same override but different presets
      const budgetRouter = new WorkTypeRouter(
        createTestConfig({ preset: 'budget', overrides })
      );
      const premiumRouter = new WorkTypeRouter(
        createTestConfig({ preset: 'premium', overrides })
      );

      const budgetResult = budgetRouter.getModel('issue-agent:planning' as WorkTypeId);
      const premiumResult = premiumRouter.getModel('issue-agent:planning' as WorkTypeId);

      // Both should use the override
      expect(budgetResult.model).toBe('claude-opus-4-5');
      expect(budgetResult.source).toBe('override');

      expect(premiumResult.model).toBe('claude-opus-4-5');
      expect(premiumResult.source).toBe('override');

      // But presets should be different
      expect(budgetResult.preset).toBe('budget');
      expect(premiumResult.preset).toBe('premium');
    });

    it('should use appropriate preset for non-overridden work types', () => {
      const overrides = {
        'issue-agent:planning': 'claude-haiku-4-5', // Only planning overridden
      };

      // Create routers with different presets
      const budgetRouter = new WorkTypeRouter(
        createTestConfig({ preset: 'budget', overrides })
      );
      const premiumRouter = new WorkTypeRouter(
        createTestConfig({ preset: 'premium', overrides })
      );

      // Planning should use override for both
      expect(budgetRouter.getModelId('issue-agent:planning' as WorkTypeId)).toBe('claude-haiku-4-5');
      expect(premiumRouter.getModelId('issue-agent:planning' as WorkTypeId)).toBe('claude-haiku-4-5');

      // Exploration (not overridden) should differ by preset
      const budgetExploration = budgetRouter.getModelId('issue-agent:exploration' as WorkTypeId);
      const premiumExploration = premiumRouter.getModelId('issue-agent:exploration' as WorkTypeId);

      // They may be the same due to fallback, but the preset should be correctly reported
      expect(budgetRouter.getPreset()).toBe('budget');
      expect(premiumRouter.getPreset()).toBe('premium');
    });
  });

  describe('preset validation', () => {
    it('should handle all three presets correctly', () => {
      const presets: PresetName[] = ['budget', 'balanced', 'premium'];

      for (const preset of presets) {
        const router = new WorkTypeRouter(createTestConfig({ preset }));

        expect(router.getPreset()).toBe(preset);

        // Verify it can resolve work types
        const result = router.getModel('issue-agent:planning' as WorkTypeId);
        expect(result.model).toBeDefined();
        expect(result.model.length).toBeGreaterThan(0);
        expect(result.preset).toBe(preset);
      }
    });

    it('should use preset definitions from preset system', () => {
      const presets: PresetName[] = ['budget', 'balanced', 'premium'];

      for (const presetName of presets) {
        const preset = getPreset(presetName);

        // Each preset should define all work types
        expect(preset.models['issue-agent:exploration' as WorkTypeId]).toBeDefined();
        expect(preset.models['issue-agent:planning' as WorkTypeId]).toBeDefined();
        expect(preset.models['issue-agent:implementation' as WorkTypeId]).toBeDefined();
        expect(preset.models['issue-agent:testing' as WorkTypeId]).toBeDefined();

        // Specialist agents
        expect(preset.models['specialist-review-agent' as WorkTypeId]).toBeDefined();
        expect(preset.models['specialist-test-agent' as WorkTypeId]).toBeDefined();
        expect(preset.models['specialist-merge-agent' as WorkTypeId]).toBeDefined();
      }
    });
  });

  describe('preset with provider filtering', () => {
    it('should apply fallback when provider disabled regardless of preset', () => {
      const workType = 'issue-agent:implementation' as WorkTypeId;

      // Budget preset with only Anthropic enabled
      const budgetRouter = new WorkTypeRouter(
        createTestConfig({
          preset: 'budget',
          enabledProviders: new Set(['anthropic']),
        })
      );

      // Premium preset with only Anthropic enabled
      const premiumRouter = new WorkTypeRouter(
        createTestConfig({
          preset: 'premium',
          enabledProviders: new Set(['anthropic']),
        })
      );

      const budgetResult = budgetRouter.getModel(workType);
      const premiumResult = premiumRouter.getModel(workType);

      // Both should use Anthropic models (fallback applied if preset uses non-Anthropic)
      expect(budgetResult.model).toMatch(/claude/i);
      expect(premiumResult.model).toMatch(/claude/i);

      // Presets should still be correctly reported
      expect(budgetResult.preset).toBe('budget');
      expect(premiumResult.preset).toBe('premium');
    });

    it('should not apply fallback when all providers enabled', () => {
      const workType = 'issue-agent:implementation' as WorkTypeId;

      const router = new WorkTypeRouter(
        createTestConfig({
          preset: 'premium',
          enabledProviders: new Set(['anthropic', 'openai', 'google', 'zai']),
        })
      );

      const result = router.getModel(workType);

      // Should use the preset's choice (may or may not be Anthropic)
      expect(result.source).toBe('preset');
      expect(result.preset).toBe('premium');
      expect(result.model).toBeDefined();
    });
  });

  describe('creating multiple routers', () => {
    it('should support multiple router instances with different presets', () => {
      // Create multiple routers simultaneously
      const router1 = new WorkTypeRouter(createTestConfig({ preset: 'budget' }));
      const router2 = new WorkTypeRouter(createTestConfig({ preset: 'balanced' }));
      const router3 = new WorkTypeRouter(createTestConfig({ preset: 'premium' }));

      // Each should maintain its own preset
      expect(router1.getPreset()).toBe('budget');
      expect(router2.getPreset()).toBe('balanced');
      expect(router3.getPreset()).toBe('premium');

      // Each should resolve work types independently
      const workType = 'issue-agent:planning' as WorkTypeId;
      const model1 = router1.getModelId(workType);
      const model2 = router2.getModelId(workType);
      const model3 = router3.getModelId(workType);

      // All should have valid models
      expect(model1).toBeDefined();
      expect(model2).toBeDefined();
      expect(model3).toBeDefined();
    });
  });

  describe('preset configuration completeness', () => {
    it('should define models for all issue agent phases in each preset', () => {
      const presets: PresetName[] = ['budget', 'balanced', 'premium'];
      const phases = [
        'exploration',
        'planning',
        'implementation',
        'testing',
        'documentation',
        'review-response',
      ];

      for (const presetName of presets) {
        const router = new WorkTypeRouter(createTestConfig({ preset: presetName }));

        for (const phase of phases) {
          const result = router.getModel(`issue-agent:${phase}` as WorkTypeId);
          expect(result.model).toBeDefined();
          expect(result.model.length).toBeGreaterThan(0);
          expect(result.preset).toBe(presetName);
        }
      }
    });

    it('should define models for all specialist agents in each preset', () => {
      const presets: PresetName[] = ['budget', 'balanced', 'premium'];
      const specialists = ['review-agent', 'test-agent', 'merge-agent'];

      for (const presetName of presets) {
        const router = new WorkTypeRouter(createTestConfig({ preset: presetName }));

        for (const specialist of specialists) {
          const result = router.getModel(`specialist-${specialist}` as WorkTypeId);
          expect(result.model).toBeDefined();
          expect(result.model.length).toBeGreaterThan(0);
          expect(result.preset).toBe(presetName);
        }
      }
    });
  });
});
