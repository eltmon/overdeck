import { describe, expect, it } from 'vitest';
import { chooseDispatchTier, chooseTierAssignment, type TierAssignmentConfig } from '../dispatch-tier.js';
import { applyTierAssignment } from '../spawn-prep.js';
import type { VBriefItem } from '../../vbrief/types.js';

const TIERING: TierAssignmentConfig = {
  enabled: true,
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

function item(metadata: VBriefItem['metadata']): Pick<VBriefItem, 'id' | 'title' | 'metadata'> {
  return { id: 'item-1', title: 't', metadata };
}

describe('chooseTierAssignment', () => {
  it('returns the expert tier model+harness when tiered execution is enabled', () => {
    const assignment = chooseTierAssignment(item({ difficulty: 'expert' }), TIERING);
    expect(assignment).toEqual({
      dispatch: 'registered-slot',
      tierName: 'frontier',
      model: 'claude-opus-4-8',
      harness: 'claude-code',
    });
  });

  it('returns exactly chooseDispatchTier with no model override when tiering is disabled', () => {
    const items = [
      item({ difficulty: 'expert' }),
      item({ difficulty: 'trivial', files_scope: ['a.ts'], files_scope_confidence: 'high' }),
      item({ readiness: 'ready', files_scope: ['a.ts'], files_scope_confidence: 'high' }),
      item({}),
    ];
    for (const testItem of items) {
      for (const tiering of [undefined, { ...TIERING, enabled: false }]) {
        const assignment = chooseTierAssignment(testItem, tiering);
        expect(assignment).toEqual({ dispatch: chooseDispatchTier(testItem) });
        expect(assignment.model).toBeUndefined();
        expect(assignment.harness).toBeUndefined();
      }
    }
  });
});

describe('applyTierAssignment', () => {
  it('carries the resolved model and harness into spawn params over the parent default', () => {
    const assignment = chooseTierAssignment(item({ difficulty: 'expert' }), TIERING);
    const options = applyTierAssignment({ model: 'gpt-5.5', harness: 'codex' as const }, assignment);
    expect(options.model).toBe('claude-opus-4-8');
    expect(options.harness).toBe('claude-code');
  });

  it('passes spawn params through unchanged when no assignment resolved a tier', () => {
    const parent = { model: 'gpt-5.5', harness: 'codex' as const };
    expect(applyTierAssignment(parent, undefined)).toBe(parent);
    expect(applyTierAssignment(parent, { dispatch: 'in-context' })).toBe(parent);
  });
});
