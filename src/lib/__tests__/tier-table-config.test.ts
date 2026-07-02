import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../config-yaml.js';
import { TieredExecutionConfigError, validateTieredExecutionConfig } from '../agents/tier-table.js';

const validTieredExecution = {
  enabled: true,
  tiers: {
    cheap: {
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      difficulties: ['trivial', 'simple'],
    },
    balanced: {
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

describe('tiered_execution config', () => {
  it('defaults off without requiring a tier table', () => {
    const { config } = mergeConfigs({});

    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecution.replay_threshold).toBe(0.5);
    expect(config.tieredExecution.tiers).toEqual({});
    expect(config.tieredExecution.difficultyToTier).toEqual({});
  });

  it('returns a difficulty-to-tier map and supervisor policy for valid config', () => {
    const { config } = mergeConfigs({
      tiered_execution: validTieredExecution,
    });

    expect(config.tieredExecution.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'balanced',
      complex: 'balanced',
      expert: 'expensive',
    });
    expect(config.tieredExecution.supervisor).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'flagged',
    });
  });

  it('rejects a difficulty mapped to zero tiers with a named validation error', () => {
    expect(() =>
      mergeConfigs({
        tiered_execution: {
          ...validTieredExecution,
          tiers: {
            cheap: {
              model: 'claude-haiku-4-5',
              harness: 'claude-code',
              difficulties: ['trivial', 'simple'],
            },
            balanced: {
              model: 'claude-sonnet-5',
              harness: 'claude-code',
              difficulties: ['medium', 'complex'],
            },
          },
        },
      }),
    ).toThrow(TieredExecutionConfigError);

    try {
      mergeConfigs({
        tiered_execution: {
          ...validTieredExecution,
          tiers: {
            cheap: {
              model: 'claude-haiku-4-5',
              harness: 'claude-code',
              difficulties: ['trivial', 'simple'],
            },
            balanced: {
              model: 'claude-sonnet-5',
              harness: 'claude-code',
              difficulties: ['medium', 'complex'],
            },
          },
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(TieredExecutionConfigError);
      expect((error as TieredExecutionConfigError).code).toBe('missing_difficulty');
      expect((error as Error).message).toContain('expert');
    }
  });

  it('rejects a difficulty mapped to two tiers with a named validation error', () => {
    expect(() =>
      mergeConfigs({
        tiered_execution: {
          ...validTieredExecution,
          tiers: {
            ...validTieredExecution.tiers,
            extra: {
              model: 'claude-haiku-4-5',
              harness: 'claude-code',
              difficulties: ['expert'],
            },
          },
        },
      }),
    ).toThrow(/Difficulty "expert" maps to multiple tiers/);
  });

  it('rejects unknown models and harnesses', () => {
    expect(() =>
      mergeConfigs({
        tiered_execution: {
          ...validTieredExecution,
          tiers: {
            ...validTieredExecution.tiers,
            cheap: {
              model: 'not-a-real-model',
              harness: 'claude-code',
              difficulties: ['trivial', 'simple'],
            },
          },
        },
      }),
    ).toThrow(/unknown model "not-a-real-model"/);

    expect(() =>
      validateTieredExecutionConfig({
        ...validTieredExecution,
        tiers: {
          ...validTieredExecution.tiers,
          cheap: {
            model: 'claude-haiku-4-5',
            harness: 'bad-harness' as 'claude-code',
            difficulties: ['trivial', 'simple'],
          },
        },
      }),
    ).toThrow(/unknown harness "bad-harness"/);
  });

  it('rejects ohmypi plus Anthropic subscription auth through the existing harness policy', () => {
    expect(() =>
      mergeConfigs({
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
            cheap: {
              model: 'claude-haiku-4-5',
              harness: 'ohmypi',
              difficulties: ['trivial', 'simple'],
            },
          },
        },
      }),
    ).toThrow(/ohmypi cannot run Anthropic models/);
  });
});
