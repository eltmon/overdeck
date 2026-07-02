import { describe, expect, it } from 'vitest';

import {
  validateTieredExecutionConfig,
  type TieredExecutionConfig,
} from '../agents/tier-table.js';

function validTieredExecutionConfig(): TieredExecutionConfig {
  return {
    enabled: true,
    replay_threshold: 0.5,
    tiers: {
      cheap: {
        model: 'claude-haiku-4-5',
        harness: 'claude-code',
        difficulties: ['trivial', 'simple'],
      },
      standard: {
        model: 'claude-sonnet-4-6',
        harness: 'claude-code',
        difficulties: ['medium', 'complex'],
      },
      premium: {
        model: 'claude-opus-4-7',
        harness: 'claude-code',
        difficulties: ['expert'],
      },
    },
    supervisor: {
      model: 'claude-opus-4-7',
      harness: 'claude-code',
      subscribe: 'flagged',
    },
  };
}

describe('tiered execution tier table validation', () => {
  it('returns a complete difficulty-to-tier map plus supervisor policy', () => {
    const validated = validateTieredExecutionConfig(validTieredExecutionConfig());

    expect(validated.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'standard',
      complex: 'standard',
      expert: 'premium',
    });
    expect(validated.supervisor).toEqual({
      model: 'claude-opus-4-7',
      harness: 'claude-code',
      subscribe: 'flagged',
    });
  });

  it('rejects a difficulty that maps to zero tiers', () => {
    const config = validTieredExecutionConfig();
    delete config.tiers.premium;

    expect(() => validateTieredExecutionConfig(config)).toThrow(
      'tiered_execution difficulty expert maps to zero tiers',
    );
  });

  it('rejects a difficulty that maps to multiple tiers', () => {
    const config = validTieredExecutionConfig();
    config.tiers.premium.difficulties = ['complex', 'expert'];

    expect(() => validateTieredExecutionConfig(config)).toThrow(
      'tiered_execution difficulty complex maps to multiple tiers: standard, premium',
    );
  });

  it('rejects unknown models and harnesses', () => {
    const badModel = validTieredExecutionConfig();
    badModel.tiers.cheap.model = 'not-a-model';

    expect(() => validateTieredExecutionConfig(badModel)).toThrow(
      'tiered_execution.tiers.cheap.model unknown model: not-a-model',
    );

    const badHarness = validTieredExecutionConfig();
    badHarness.tiers.cheap.harness = 'bad' as never;

    expect(() => validateTieredExecutionConfig(badHarness)).toThrow(
      'tiered_execution.tiers.cheap.harness must be claude-code, ohmypi, codex',
    );
  });

  it('applies the harness policy gate to tiers and supervisor definitions', () => {
    const badTier = validTieredExecutionConfig();
    badTier.tiers.standard = {
      model: 'claude-sonnet-4-6',
      harness: 'ohmypi',
      difficulties: ['medium', 'complex'],
    };

    expect(() => validateTieredExecutionConfig(badTier, {
      providerAuth: { anthropic: 'subscription' },
    })).toThrow('ohmypi cannot run Anthropic models when authenticated via Claude Code subscription');

    const badSupervisor = validTieredExecutionConfig();
    badSupervisor.supervisor = {
      model: 'claude-opus-4-7',
      harness: 'ohmypi',
      subscribe: 'all',
    };

    expect(() => validateTieredExecutionConfig(badSupervisor, {
      providerAuth: { anthropic: 'subscription' },
    })).toThrow('ohmypi cannot run Anthropic models when authenticated via Claude Code subscription');
  });
});
