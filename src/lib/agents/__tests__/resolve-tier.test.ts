import { describe, expect, it } from 'vitest';
import type { VBriefItem } from '../../vbrief/types.js';
import { validateTieredExecutionConfig, type TieredExecutionConfig } from '../tier-table.js';
import { resolveTier, TierResolutionError, type TierResolutionConfig } from '../resolve-tier.js';

function validTierTable(overrides: Partial<TieredExecutionConfig> = {}) {
  return validateTieredExecutionConfig({
    enabled: true,
    tiers: {
      cheap: {
        model: 'claude-haiku-4-5',
        harness: 'claude-code',
        difficulties: ['trivial', 'simple'],
      },
      standard: {
        model: 'claude-sonnet-5',
        harness: 'claude-code',
        difficulties: ['medium', 'complex'],
      },
      frontier: {
        model: 'claude-opus-4-8',
        harness: 'claude-code',
        difficulties: ['expert'],
      },
    },
    supervisor: {
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'flagged',
    },
    replay_threshold: 0.5,
    ...overrides,
  });
}

function item(metadata: VBriefItem['metadata']): VBriefItem {
  return { id: 'item-1', title: 'Test item', status: 'pending', metadata };
}

describe('tier resolution chain', () => {
  it('returns the metadata.model override regardless of kind and difficulty', () => {
    const config: TierResolutionConfig = {
      tierTable: validTierTable(),
      byKind: { docs: 'cheap' },
    };

    const resolved = resolveTier(item({ model: 'claude-opus-4-8', kind: 'docs', difficulty: 'trivial' }), config);

    expect(resolved.model).toBe('claude-opus-4-8');
    expect(resolved.tierName).toBe('override');
    expect(resolved.harness).toBe('claude-code');
  });

  it('routes byKind ahead of byDifficulty when no override is set', () => {
    const config: TierResolutionConfig = {
      tierTable: validTierTable(),
      byKind: { docs: 'frontier' },
    };

    const resolved = resolveTier(item({ kind: 'docs', difficulty: 'trivial' }), config);

    expect(resolved).toEqual({ tierName: 'frontier', model: 'claude-opus-4-8', harness: 'claude-code' });
  });

  it('routes byDifficulty to the tier whose difficulties contain it', () => {
    const config: TierResolutionConfig = { tierTable: validTierTable() };

    const resolved = resolveTier(item({ difficulty: 'expert' }), config);

    expect(resolved).toEqual({ tierName: 'frontier', model: 'claude-opus-4-8', harness: 'claude-code' });
  });

  it('falls back to the role default when neither byKind nor byDifficulty resolves', () => {
    const config: TierResolutionConfig = {
      tierTable: validateTieredExecutionConfig(undefined),
      roleDefault: { model: 'claude-sonnet-5', harness: 'claude-code' },
    };

    const resolved = resolveTier(item({}), config);

    expect(resolved).toEqual({ tierName: 'role-default', model: 'claude-sonnet-5', harness: 'claude-code' });
  });

  it('throws a named error when nothing resolves and no default is configured', () => {
    const config: TierResolutionConfig = { tierTable: validateTieredExecutionConfig(undefined) };

    expect(() => resolveTier(item({}), config)).toThrow(TierResolutionError);
    expect(() => resolveTier(item({}), config)).toThrow(/no tier\/model configured/);
  });

  it('throws a named error when byKind routes to a tier that is not defined', () => {
    const config: TierResolutionConfig = {
      tierTable: validTierTable(),
      byKind: { docs: 'nonexistent' },
    };

    expect(() => resolveTier(item({ kind: 'docs' }), config)).toThrow(TierResolutionError);
    expect(() => resolveTier(item({ kind: 'docs' }), config)).toThrow(/not defined in tiered_execution.tiers/);
  });

  it('throws when an override is set but nothing resolves a harness for it', () => {
    const config: TierResolutionConfig = { tierTable: validateTieredExecutionConfig(undefined) };

    expect(() => resolveTier(item({ model: 'claude-opus-4-8' }), config)).toThrow(TierResolutionError);
  });
});
