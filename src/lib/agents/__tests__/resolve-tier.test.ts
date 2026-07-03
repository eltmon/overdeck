import { describe, expect, it } from 'vitest';
import {
  OVERRIDE_TIER_NAME,
  ROLE_DEFAULT_TIER_NAME,
  ResolveTierError,
  resolveTier,
  type ResolveTierConfig,
} from '../resolve-tier.js';
import { assignDispatchTier } from '../dispatch-tier.js';
import { validateTieredExecutionConfig, type TieredExecutionConfig } from '../tier-table.js';

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
  byKind: { docs: 'cheap' },
  roleDefault: { model: 'gpt-5.5', harness: 'codex' },
};

describe('resolveTier', () => {
  it('returns the metadata.model override regardless of kind and difficulty', () => {
    const resolved = resolveTier(
      { id: 'item-1', title: 't', metadata: { model: 'kimi-k2.7-code', kind: 'docs', difficulty: 'expert' } },
      CONFIG,
    );
    expect(resolved.model).toBe('kimi-k2.7-code');
    expect(resolved.tierName).toBe(OVERRIDE_TIER_NAME);
  });

  it('routes by kind ahead of difficulty when no override is set', () => {
    const resolved = resolveTier(
      { id: 'item-2', title: 't', metadata: { kind: 'docs', difficulty: 'expert' } },
      CONFIG,
    );
    expect(resolved).toEqual({ tierName: 'cheap', model: 'claude-haiku-4-5', harness: 'claude-code' });
  });

  it('routes by difficulty to the tier whose difficulties contain it', () => {
    const resolved = resolveTier(
      { id: 'item-3', title: 't', metadata: { difficulty: 'medium' } },
      CONFIG,
    );
    expect(resolved).toEqual({ tierName: 'standard', model: 'claude-sonnet-4-6', harness: 'claude-code' });
  });

  it('falls back to the role default when neither kind nor difficulty routes', () => {
    const resolved = resolveTier({ id: 'item-4', title: 't', metadata: {} }, CONFIG);
    expect(resolved).toEqual({ tierName: ROLE_DEFAULT_TIER_NAME, model: 'gpt-5.5', harness: 'codex' });
  });

  it('throws a named error when nothing resolves and no default is configured', () => {
    const config: ResolveTierConfig = { tiers: {}, difficultyToTier: {} };
    let caught: unknown;
    try {
      resolveTier({ id: 'item-5', title: 't', metadata: {} }, config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ResolveTierError);
    expect((caught as Error).name).toBe('ResolveTierError');
    expect((caught as Error).message).toContain('no tier/model configured');
    // Fail-loud contract: the error must not smuggle in a fallback model literal.
    expect((caught as Error).message).not.toMatch(/claude-|gpt-|kimi-|haiku|sonnet|opus/);
  });

  it('throws when an override has no harness source anywhere in the chain', () => {
    const config: ResolveTierConfig = { tiers: {}, difficultyToTier: {} };
    expect(() =>
      resolveTier({ id: 'item-6', title: 't', metadata: { model: 'gpt-5.5' } }, config),
    ).toThrow(ResolveTierError);
  });

  it('throws when byKind routes to a tier name that is not configured', () => {
    const config: ResolveTierConfig = { ...CONFIG, byKind: { docs: 'nonexistent' } };
    expect(() =>
      resolveTier({ id: 'item-7', title: 't', metadata: { kind: 'docs' } }, config),
    ).toThrow(/no such tier is configured/);
  });

  it('accepts a validated tier-table config spread into the chain config', () => {
    const resolved = resolveTier(
      { id: 'item-8', title: 't', metadata: { difficulty: 'trivial' } },
      { tiers: CONFIG.tiers, difficultyToTier: CONFIG.difficultyToTier },
    );
    expect(resolved.tierName).toBe('cheap');
  });

  it('routes config-sourced by_kind ahead of difficulty through assignDispatchTier', () => {
    const rawConfig: TieredExecutionConfig = {
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
        standard: { model: 'claude-sonnet-4-6', harness: 'claude-code', difficulties: ['medium', 'complex'] },
        senior: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
      },
      by_kind: { design: 'senior' },
      supervisor: { model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
    };
    const validated = validateTieredExecutionConfig(rawConfig);
    const item = {
      id: 'item-9',
      title: 'design work',
      metadata: { kind: 'design' as const, difficulty: 'simple' as const },
    };

    expect(resolveTier(item, validated).tierName).toBe('senior');
    expect(assignDispatchTier(item, validated).tierName).toBe('senior');

    const withoutByKind = validateTieredExecutionConfig({ ...rawConfig, by_kind: undefined });
    expect(assignDispatchTier(item, withoutByKind).tierName).toBe('cheap');
  });
});
