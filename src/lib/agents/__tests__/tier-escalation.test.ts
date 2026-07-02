import { describe, expect, it } from 'vitest';
import type { VBriefDifficulty, VBriefItem } from '../../vbrief/types.js';
import { resolveTier, type ResolveTierConfig } from '../resolve-tier.js';
import { applyEffectiveDifficulty, type TierOverridesMap } from '../tier-escalation.js';

const CONFIG: ResolveTierConfig = {
  tiers: {
    cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
    standard: { model: 'claude-sonnet-4-6', harness: 'claude-code', difficulties: ['medium'] },
    frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['complex', 'expert'] },
  },
  difficultyToTier: {
    trivial: 'cheap',
    simple: 'cheap',
    medium: 'standard',
    complex: 'frontier',
    expert: 'frontier',
  },
};

function item(id: string, difficulty: VBriefDifficulty): VBriefItem {
  return { id, title: id, status: 'pending', metadata: { difficulty } };
}

describe('applyEffectiveDifficulty', () => {
  it('overlays promoted difficulty before resolveTier while untouched items resolve unchanged', () => {
    const overrides: TierOverridesMap = {
      'item-1': {
        effectiveDifficulty: 'complex',
        promotions: 1,
        history: [{ at: '2026-07-02T00:00:00.000Z', from: 'medium', to: 'complex', reason: 'floundering' }],
      },
    };

    const promoted = applyEffectiveDifficulty(item('item-1', 'medium'), overrides);
    const unchanged = applyEffectiveDifficulty(item('item-2', 'medium'), overrides);

    expect(resolveTier(promoted, CONFIG).tierName).toBe('frontier');
    expect(resolveTier(unchanged, CONFIG).tierName).toBe('standard');
    expect(unchanged.metadata?.difficulty).toBe('medium');
  });
});
