import { describe, expect, it } from 'vitest';

import {
  validateTieredExecutionConfig,
  type TieredExecutionConfig,
  type TieredExecutionTierConfig,
} from '../tier-table.js';

const supervisor = {
  model: 'claude-sonnet-4-6',
  harness: 'claude-code' as const,
  subscribe: 'flagged' as const,
};

function tier(overrides: Partial<TieredExecutionTierConfig>): TieredExecutionTierConfig {
  return {
    model: 'claude-sonnet-4-6',
    harness: 'claude-code',
    difficulties: [],
    ...overrides,
  };
}

describe('tiered execution tier table', () => {
  it('defaults to disabled with replay threshold 0.5 when no block is present', () => {
    const config = validateTieredExecutionConfig(undefined);

    expect(config.enabled).toBe(false);
    expect(config.replay_threshold).toBe(0.5);
    expect(config.tiers).toEqual({});
  });

  it('rejects an unmapped difficulty with a named validation error', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      supervisor,
      replay_threshold: 0.5,
      tiers: {
        cheap: tier({ difficulties: ['trivial', 'simple'] }),
        standard: tier({ difficulties: ['medium', 'complex'] }),
      },
    })).toThrow('difficulty expert is not mapped to any tier');
  });

  it('rejects an overlapping difficulty with a named validation error', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      supervisor,
      replay_threshold: 0.5,
      tiers: {
        cheap: tier({ difficulties: ['trivial', 'simple'] }),
        standard: tier({ difficulties: ['simple', 'medium', 'complex', 'expert'] }),
      },
    })).toThrow('difficulty simple maps to both cheap and standard');
  });

  it('rejects unknown model and harness values', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      supervisor,
      replay_threshold: 0.5,
      tiers: {
        bad: tier({ model: 'not-a-real-model', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] }),
      },
    })).toThrow('unknown model not-a-real-model');

    expect(() => validateTieredExecutionConfig({
      enabled: true,
      supervisor,
      replay_threshold: 0.5,
      tiers: {
        bad: { ...tier({ difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] }), harness: 'unknown' },
      },
    } as unknown as TieredExecutionConfig)).toThrow('unknown harness');
  });

  it('applies the harness policy gate to tier and supervisor definitions', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      supervisor,
      replay_threshold: 0.5,
      tiers: {
        blocked: {
          model: 'claude-sonnet-4-6',
          harness: 'pi',
          difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
        },
      },
    } as unknown as TieredExecutionConfig, {
      providerAuth: { anthropic: 'subscription' },
    })).toThrow('ohmypi cannot run Anthropic models');

    expect(() => validateTieredExecutionConfig({
      enabled: true,
      supervisor: {
        model: 'claude-sonnet-4-6',
        harness: 'pi',
        subscribe: 'all',
      },
      replay_threshold: 0.5,
      tiers: {
        standard: tier({ difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] }),
      },
    } as unknown as TieredExecutionConfig, {
      providerAuth: { anthropic: 'subscription' },
    })).toThrow('ohmypi cannot run Anthropic models');
  });

  it('returns a difficulty-to-tier map and supervisor policy for valid config', () => {
    const config = validateTieredExecutionConfig({
      enabled: true,
      supervisor: {
        model: 'claude-opus-4-7',
        harness: 'claude-code',
        subscribe: 'all',
      },
      replay_threshold: 0.75,
      tiers: {
        cheap: tier({ model: 'claude-haiku-4-5', difficulties: ['trivial', 'simple'] }),
        standard: tier({ model: 'claude-sonnet-4-6', difficulties: ['medium', 'complex'] }),
        expert: tier({ model: 'claude-opus-4-7', difficulties: ['expert'] }),
      },
    });

    expect(config.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'standard',
      complex: 'standard',
      expert: 'expert',
    });
    expect(config.supervisor).toEqual({
      model: 'claude-opus-4-7',
      harness: 'claude-code',
      subscribe: 'all',
    });
  });
});
