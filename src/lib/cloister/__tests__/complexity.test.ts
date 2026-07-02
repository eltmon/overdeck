import { describe, expect, it } from 'vitest';
import { resolveTier } from '../../agents/resolve-tier.js';
import { complexityToModel, legacyComplexityTierConfig, type ComplexityLevel } from '../complexity.js';

const LEVELS: ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

describe('legacyComplexityTierConfig', () => {
  it('locks disabled-mode parity: resolveTier returns exactly today\'s model per difficulty', () => {
    // The pre-PAN-1791 mapping. If this test breaks, the legacy routing
    // behavior changed — that is a regression, not a test to update.
    const expected: Record<ComplexityLevel, string> = {
      trivial: 'haiku',
      simple: 'haiku',
      medium: 'sonnet',
      complex: 'sonnet',
      expert: 'opus',
    };

    for (const level of LEVELS) {
      const resolved = resolveTier(
        { id: `task-${level}`, title: level, metadata: { difficulty: level } },
        legacyComplexityTierConfig(),
      );
      expect(resolved.model).toBe(expected[level]);
      expect(resolved.model).toBe(complexityToModel(level));
      expect(resolved.harness).toBe('claude-code');
    }
  });

  it('covers every difficulty in the derived tier table', () => {
    const config = legacyComplexityTierConfig();
    for (const level of LEVELS) {
      expect(config.difficultyToTier[level]).toBeDefined();
    }
  });
});
