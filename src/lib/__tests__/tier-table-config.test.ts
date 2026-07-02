import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../config-yaml.js';
import {
  validateTieredExecutionConfig,
  type TieredExecutionConfigInput,
} from '../agents/tier-table.js';

const validTieredExecution: TieredExecutionConfigInput = {
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
    premium: {
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      difficulties: ['expert'],
    },
  },
  supervisor: {
    model: 'claude-sonnet-5',
    harness: 'claude-code',
    subscribe: 'flagged',
  },
};

describe('tiered_execution config', () => {
  it('rejects difficulties that map to zero or two tiers with the offending difficulty', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple', 'medium'],
        },
        standard: {
          model: 'claude-sonnet-5',
          harness: 'claude-code',
          difficulties: ['medium', 'complex'],
        },
      },
    })).toThrow(/TierTableValidationError: difficulty "medium" must map to exactly one tier; found 2/);

    expect(() => validateTieredExecutionConfig({
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
      },
    })).toThrow(/TierTableValidationError: difficulty "expert" must map to exactly one tier; found 0/);
  });

  it('rejects unknown model and harness values', () => {
    expect(() => validateTieredExecutionConfig({
      ...validTieredExecution,
      tiers: {
        ...validTieredExecution.tiers,
        premium: {
          model: 'not-a-real-model',
          harness: 'claude-code',
          difficulties: ['expert'],
        },
      },
    })).toThrow(/TierTableValidationError: tiered_execution\.tiers\.premium\.model "not-a-real-model" is unknown/);

    expect(() => validateTieredExecutionConfig({
      ...validTieredExecution,
      tiers: {
        ...validTieredExecution.tiers,
        premium: {
          model: 'claude-opus-4-8',
          harness: 'pi' as never,
          difficulties: ['expert'],
        },
      },
    })).toThrow(/TierTableValidationError: tiered_execution\.tiers\.premium\.harness must be claude-code, ohmypi, or codex/);
  });

  it('rejects ohmypi plus Anthropic subscription tiers through the harness policy gate', () => {
    expect(() => mergeConfigs({
      models: {
        providers: {
          anthropic: {
            enabled: true,
            auth: 'subscription',
          },
        },
      },
      tiered_execution: {
        ...validTieredExecution,
        tiers: {
          ...validTieredExecution.tiers,
          premium: {
            model: 'claude-opus-4-8',
            harness: 'ohmypi',
            difficulties: ['expert'],
          },
        },
      },
    })).toThrow(/TierTableValidationError: tiered_execution\.tiers\.premium violates harness policy: ohmypi cannot run Anthropic models/);
  });

  it('defaults to disabled with replay threshold 0.5 when no block is present', () => {
    const { config } = mergeConfigs({});

    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecution.replay_threshold).toBe(0.5);
    expect(config.tieredExecution.tiers).toEqual({});
    expect(config.tieredExecution.difficultyToTier).toEqual({});
  });

  it('returns a difficulty-to-tier map and supervisor policy for a valid config', () => {
    const { config } = mergeConfigs({
      tiered_execution: validTieredExecution,
    });

    expect(config.tieredExecution.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'standard',
      complex: 'standard',
      expert: 'premium',
    });
    expect(config.tieredExecution.supervisor).toEqual({
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      subscribe: 'flagged',
    });
  });
});
