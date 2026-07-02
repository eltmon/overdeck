import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../router.js';
import { complexityToModel, type ComplexityLevel } from '../complexity.js';
import type { CloisterConfig } from '../config.js';

const LEVELS: ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

describe('ModelRouter default routing', () => {
  it('resolves through the tier chain with legacy parity when no model_selection config exists', () => {
    // No model_selection -> the router's default path, now routed through
    // resolveTier over legacyComplexityTierConfig(). Output must equal the
    // pre-change complexityToModel mapping for every difficulty.
    const router = new ModelRouter({} as CloisterConfig);

    for (const level of LEVELS) {
      const result = router.routeTask({ id: `task-${level}`, title: level, complexity: level });
      expect(result.model).toBe(complexityToModel(level));
      expect(result.complexity).toBe(level);
    }
  });
});
