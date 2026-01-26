import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  PresetName,
  DEFAULT_PRESET,
  getPreset,
  getPresetModel,
  isValidPreset,
  getAllPresets,
  getPresetsMetadata,
} from '../../src/lib/model-presets.js';
import { getAllWorkTypes } from '../../src/lib/work-types.js';

describe('model-presets', () => {
  describe('PRESETS constant', () => {
    it('should have exactly 3 presets', () => {
      expect(Object.keys(PRESETS)).toHaveLength(3);
    });

    it('should have premium, balanced, and budget presets', () => {
      expect(PRESETS).toHaveProperty('premium');
      expect(PRESETS).toHaveProperty('balanced');
      expect(PRESETS).toHaveProperty('budget');
    });

    it('should have all required fields for each preset', () => {
      Object.values(PRESETS).forEach((preset) => {
        expect(preset.name).toBeTruthy();
        expect(preset.displayName).toBeTruthy();
        expect(preset.description).toBeTruthy();
        expect(preset.models).toBeDefined();
        expect(preset.costLevel).toBeGreaterThanOrEqual(1);
        expect(preset.costLevel).toBeLessThanOrEqual(5);
      });
    });

    it('should have model assignments for all 23 work types', () => {
      const allWorkTypes = getAllWorkTypes();

      Object.values(PRESETS).forEach((preset) => {
        const modelKeys = Object.keys(preset.models);
        expect(modelKeys).toHaveLength(23);

        allWorkTypes.forEach((workType) => {
          expect(preset.models).toHaveProperty(workType);
          expect(preset.models[workType]).toBeTruthy();
        });
      });
    });

    it('should have correct cost levels', () => {
      expect(PRESETS.premium.costLevel).toBe(5); // Most expensive
      expect(PRESETS.balanced.costLevel).toBe(3); // Mid-range
      expect(PRESETS.budget.costLevel).toBe(1); // Cheapest
    });
  });

  describe('Premium preset', () => {
    const premium = PRESETS.premium;

    it('should use Opus for critical work', () => {
      expect(premium.models['issue-agent:planning']).toBe('claude-opus-4-5');
      expect(premium.models['convoy:security-reviewer']).toBe('claude-opus-4-5');
      expect(premium.models['prd-agent']).toBe('claude-opus-4-5');
      expect(premium.models['planning-agent']).toBe('claude-opus-4-5');
    });

    it('should use GPT-5.2 Codex for implementation', () => {
      expect(premium.models['issue-agent:implementation']).toBe('gpt-5.2-codex');
    });

    it('should use Gemini Flash for exploration', () => {
      expect(premium.models['issue-agent:exploration']).toBe('gemini-3-flash-preview');
      expect(premium.models['subagent:explore']).toBe('gemini-3-flash-preview');
    });

    it('should use Sonnet for standard quality work', () => {
      expect(premium.models['issue-agent:testing']).toBe('claude-sonnet-4-5');
      expect(premium.models['issue-agent:documentation']).toBe('claude-sonnet-4-5');
      expect(premium.models['specialist-test-agent']).toBe('claude-sonnet-4-5');
    });
  });

  describe('Balanced preset', () => {
    const balanced = PRESETS.balanced;

    it('should use Sonnet for most work', () => {
      expect(balanced.models['issue-agent:planning']).toBe('claude-sonnet-4-5');
      expect(balanced.models['issue-agent:testing']).toBe('claude-sonnet-4-5');
      expect(balanced.models['issue-agent:documentation']).toBe('claude-sonnet-4-5');
      expect(balanced.models['specialist-review-agent']).toBe('claude-sonnet-4-5');
    });

    it('should use Gemini Pro for implementation', () => {
      expect(balanced.models['issue-agent:implementation']).toBe('gemini-3-pro-preview');
    });

    it('should use Haiku for quick tasks', () => {
      expect(balanced.models['cli:interactive']).toBe('claude-haiku-4-5');
      expect(balanced.models['cli:quick-command']).toBe('claude-haiku-4-5');
      expect(balanced.models['subagent:bash']).toBe('claude-haiku-4-5');
    });

    it('should still use Opus for security', () => {
      expect(balanced.models['convoy:security-reviewer']).toBe('claude-opus-4-5');
    });

    it('should use Gemini Flash for exploration', () => {
      expect(balanced.models['issue-agent:exploration']).toBe('gemini-3-flash-preview');
      expect(balanced.models['subagent:explore']).toBe('gemini-3-flash-preview');
    });
  });

  describe('Budget preset', () => {
    const budget = PRESETS.budget;

    it('should use Haiku for most work', () => {
      expect(budget.models['issue-agent:planning']).toBe('claude-haiku-4-5');
      expect(budget.models['issue-agent:testing']).toBe('claude-haiku-4-5');
      expect(budget.models['issue-agent:documentation']).toBe('claude-haiku-4-5');
      expect(budget.models['cli:interactive']).toBe('claude-haiku-4-5');
    });

    it('should use Gemini Flash for exploration and implementation', () => {
      expect(budget.models['issue-agent:exploration']).toBe('gemini-3-flash-preview');
      expect(budget.models['issue-agent:implementation']).toBe('gemini-3-flash-preview');
      expect(budget.models['subagent:explore']).toBe('gemini-3-flash-preview');
    });

    it('should NEVER compromise on security - use Sonnet', () => {
      expect(budget.models['convoy:security-reviewer']).toBe('claude-sonnet-4-5');
    });

    it('should use economy models for all other convoy members', () => {
      expect(budget.models['convoy:performance-reviewer']).toBe('claude-haiku-4-5');
      expect(budget.models['convoy:correctness-reviewer']).toBe('claude-haiku-4-5');
      expect(budget.models['convoy:synthesis-agent']).toBe('claude-haiku-4-5');
    });
  });

  describe('DEFAULT_PRESET', () => {
    it('should be balanced', () => {
      expect(DEFAULT_PRESET).toBe('balanced');
    });
  });

  describe('getPreset', () => {
    it('should return correct preset for each name', () => {
      expect(getPreset('premium')).toBe(PRESETS.premium);
      expect(getPreset('balanced')).toBe(PRESETS.balanced);
      expect(getPreset('budget')).toBe(PRESETS.budget);
    });

    it('should return preset with all fields', () => {
      const preset = getPreset('balanced');
      expect(preset.name).toBe('balanced');
      expect(preset.displayName).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.models).toBeDefined();
      expect(preset.costLevel).toBe(3);
    });
  });

  describe('getPresetModel', () => {
    it('should return correct model for work type in preset', () => {
      const model = getPresetModel('premium', 'issue-agent:planning');
      expect(model).toBe('claude-opus-4-5');
    });

    it('should work for all presets and work types', () => {
      const presets: PresetName[] = ['premium', 'balanced', 'budget'];
      const workTypes = getAllWorkTypes();

      presets.forEach((preset) => {
        workTypes.forEach((workType) => {
          const model = getPresetModel(preset, workType);
          expect(model).toBeTruthy();
          expect(typeof model).toBe('string');
        });
      });
    });

    it('should return different models for different presets', () => {
      const workType = 'issue-agent:planning';
      const premiumModel = getPresetModel('premium', workType);
      const budgetModel = getPresetModel('budget', workType);

      expect(premiumModel).not.toBe(budgetModel);
      expect(premiumModel).toBe('claude-opus-4-5');
      expect(budgetModel).toBe('claude-haiku-4-5');
    });
  });

  describe('isValidPreset', () => {
    it('should return true for valid presets', () => {
      expect(isValidPreset('premium')).toBe(true);
      expect(isValidPreset('balanced')).toBe(true);
      expect(isValidPreset('budget')).toBe(true);
    });

    it('should return false for invalid presets', () => {
      expect(isValidPreset('invalid')).toBe(false);
      expect(isValidPreset('Premium')).toBe(false); // Case sensitive
      expect(isValidPreset('')).toBe(false);
      expect(isValidPreset('enterprise')).toBe(false);
    });
  });

  describe('getAllPresets', () => {
    it('should return all 3 preset names', () => {
      const presets = getAllPresets();
      expect(presets).toHaveLength(3);
    });

    it('should return preset names as strings', () => {
      const presets = getAllPresets();
      presets.forEach((name) => {
        expect(typeof name).toBe('string');
        expect(isValidPreset(name)).toBe(true);
      });
    });

    it('should include premium, balanced, and budget', () => {
      const presets = getAllPresets();
      expect(presets).toContain('premium');
      expect(presets).toContain('balanced');
      expect(presets).toContain('budget');
    });
  });

  describe('getPresetsMetadata', () => {
    it('should return metadata for all 3 presets', () => {
      const metadata = getPresetsMetadata();
      expect(metadata).toHaveLength(3);
    });

    it('should have all required metadata fields', () => {
      const metadata = getPresetsMetadata();

      metadata.forEach((preset) => {
        expect(preset.name).toBeTruthy();
        expect(preset.displayName).toBeTruthy();
        expect(preset.description).toBeTruthy();
        expect(preset.costLevel).toBeGreaterThanOrEqual(1);
        expect(preset.costLevel).toBeLessThanOrEqual(5);
      });
    });

    it('should not include full model mappings', () => {
      const metadata = getPresetsMetadata();

      metadata.forEach((preset) => {
        expect(preset).not.toHaveProperty('models');
      });
    });

    it('should have increasing cost levels from budget to premium', () => {
      const metadata = getPresetsMetadata();
      const budget = metadata.find((p) => p.name === 'budget')!;
      const balanced = metadata.find((p) => p.name === 'balanced')!;
      const premium = metadata.find((p) => p.name === 'premium')!;

      expect(budget.costLevel).toBeLessThan(balanced.costLevel);
      expect(balanced.costLevel).toBeLessThan(premium.costLevel);
    });
  });

  describe('preset consistency', () => {
    it('should have security reviewer use Sonnet or Opus in all presets', () => {
      // Security should never use Haiku-level models except in budget
      expect(PRESETS.premium.models['convoy:security-reviewer']).toBe('claude-opus-4-5');
      expect(PRESETS.balanced.models['convoy:security-reviewer']).toBe('claude-opus-4-5');
      expect(PRESETS.budget.models['convoy:security-reviewer']).toBe('claude-sonnet-4-5');
    });

    it('should have exploration use fast models in all presets', () => {
      // Exploration should always use Gemini Flash for speed
      expect(PRESETS.premium.models['issue-agent:exploration']).toBe('gemini-3-flash-preview');
      expect(PRESETS.balanced.models['issue-agent:exploration']).toBe('gemini-3-flash-preview');
      expect(PRESETS.budget.models['issue-agent:exploration']).toBe('gemini-3-flash-preview');
    });

    it('should have consistent CLI quick command models', () => {
      // Quick commands should always be fast
      expect(PRESETS.premium.models['cli:quick-command']).toBe('claude-haiku-4-5');
      expect(PRESETS.balanced.models['cli:quick-command']).toBe('claude-haiku-4-5');
      expect(PRESETS.budget.models['cli:quick-command']).toBe('claude-haiku-4-5');
    });

    it('should use only valid model IDs', () => {
      const validModels = [
        'claude-opus-4-5',
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
        'gpt-5.2-codex',
        'o3-deep-research',
        'gpt-4o',
        'gpt-4o-mini',
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'glm-4.7',
        'glm-4.7-flash',
      ];

      Object.values(PRESETS).forEach((preset) => {
        Object.values(preset.models).forEach((modelId) => {
          expect(validModels).toContain(modelId);
        });
      });
    });
  });
});
