import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../../../../src/lib/config-yaml.js';
import {
  TieredExecutionValidationError,
  normalizeTieredExecutionConfig,
  validateTieredExecutionConfig,
} from '../../../../src/lib/agents/tier-table.js';

const validTieredExecutionConfig = {
  enabled: true,
  tiers: {
    cheap: {
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      difficulties: ['trivial', 'simple'],
    },
    mid: {
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      difficulties: ['medium', 'complex'],
    },
    expensive: {
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
  replay_threshold: 0.75,
} as const;

describe('tiered execution config', () => {
  it('rejects difficulty mappings that are missing or duplicated with named validation errors', () => {
    expect(() => normalizeTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
        ...validTieredExecutionConfig.tiers,
        mid: {
          ...validTieredExecutionConfig.tiers.mid,
          difficulties: ['simple', 'medium', 'complex'],
        },
      },
    })).toThrow(new TieredExecutionValidationError(
      "tiered_execution difficulty 'simple' maps to both 'cheap' and 'mid'",
    ));

    expect(() => normalizeTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
        cheap: {
          ...validTieredExecutionConfig.tiers.cheap,
          difficulties: ['trivial'],
        },
        mid: validTieredExecutionConfig.tiers.mid,
        expensive: validTieredExecutionConfig.tiers.expensive,
      },
    })).toThrow(new TieredExecutionValidationError(
      "tiered_execution difficulty 'simple' is not mapped to any tier",
    ));
  });

  it('rejects unknown model, unknown harness, and ohmypi Anthropic subscription policy violations at load', () => {
    expect(() => mergeConfigs({
      tiered_execution: {
        ...validTieredExecutionConfig,
        tiers: {
          ...validTieredExecutionConfig.tiers,
          cheap: {
            ...validTieredExecutionConfig.tiers.cheap,
            model: 'unknown-model',
          },
        },
      },
    })).toThrow(/tiered_execution\.tiers\.cheap\.model 'unknown-model' is unknown/);

    expect(() => mergeConfigs({
      tiered_execution: {
        ...validTieredExecutionConfig,
        tiers: {
          ...validTieredExecutionConfig.tiers,
          cheap: {
            ...validTieredExecutionConfig.tiers.cheap,
            harness: 'unknown-harness',
          },
        },
      },
    })).toThrow(/tiered_execution\.tiers\.cheap\.harness 'unknown-harness' is unknown/);

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
        ...validTieredExecutionConfig,
        tiers: {
          ...validTieredExecutionConfig.tiers,
          cheap: {
            ...validTieredExecutionConfig.tiers.cheap,
            harness: 'ohmypi',
          },
        },
      },
    })).toThrow(/violates harness policy/);
  });

  it('defaults to disabled tiered execution with replay threshold 0.5 when the block is absent', () => {
    const { config } = mergeConfigs(null);

    expect(config.tieredExecution).toEqual({
      enabled: false,
      tiers: {},
      replay_threshold: 0.5,
    });
  });

  it('returns a complete difficulty-to-tier map and supervisor policy for valid config', () => {
    const config = normalizeTieredExecutionConfig(validTieredExecutionConfig);
    const validated = validateTieredExecutionConfig(config);

    expect(validated.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'mid',
      complex: 'mid',
      expert: 'expensive',
    });
    expect(validated.supervisor).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'flagged',
    });
  });
});
