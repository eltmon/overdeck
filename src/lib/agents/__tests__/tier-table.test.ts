import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../../config-yaml.js';
import {
  TieredExecutionConfigError,
  validateTieredExecutionConfig,
  type TieredExecutionConfig,
} from '../tier-table.js';

function validConfig(overrides: Partial<TieredExecutionConfig> = {}): TieredExecutionConfig {
  return {
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
  };
}

describe('tiered execution tier table', () => {
  it('rejects a difficulty that maps to zero tiers', () => {
    expect(() => validateTieredExecutionConfig(validConfig({
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple'],
        },
      },
    }))).toThrow(TieredExecutionConfigError);

    expect(() => validateTieredExecutionConfig(validConfig({
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple'],
        },
      },
    }))).toThrow("difficulty 'medium' is not mapped");
  });

  it('rejects a difficulty that maps to multiple tiers', () => {
    expect(() => validateTieredExecutionConfig(validConfig({
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple', 'medium'],
        },
        standard: {
          model: 'claude-sonnet-5',
          harness: 'claude-code',
          difficulties: ['medium', 'complex', 'expert'],
        },
      },
    }))).toThrow("difficulty 'medium' is mapped to multiple tiers");
  });

  it('rejects unknown model and harness entries', () => {
    expect(() => validateTieredExecutionConfig(validConfig({
      tiers: {
        cheap: {
          model: 'not-a-model',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
        },
      },
    }))).toThrow("tiered_execution.tiers.cheap.model 'not-a-model' is unknown");

    expect(() => validateTieredExecutionConfig(validConfig({
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'bad-harness' as never,
          difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
        },
      },
    }))).toThrow("tiered_execution.tiers.cheap.harness 'bad-harness' is unknown");
  });

  it('rejects Anthropic subscription auth on ohmypi through the harness policy gate', () => {
    expect(() => validateTieredExecutionConfig(validConfig({
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'ohmypi',
          difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
        },
      },
    }), {
      providerAuth: { anthropic: 'subscription' },
    })).toThrow('ohmypi cannot run Anthropic models');
  });

  it('rejects Anthropic subscription auth on ohmypi when loaded from config yaml', () => {
    expect(() => mergeConfigs({
      models: {
        providers: {
          anthropic: { enabled: true, auth: 'subscription' },
        },
      },
      tiered_execution: validConfig({
        tiers: {
          cheap: {
            model: 'claude-haiku-4-5',
            harness: 'ohmypi',
            difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
          },
        },
      }),
    })).toThrow('ohmypi cannot run Anthropic models');
  });

  it('defaults to disabled with replay threshold 0.5 when no tiered_execution block exists', () => {
    const { config } = mergeConfigs({});

    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecution.replay_threshold).toBe(0.5);
    expect(config.tieredExecution.difficultyToTier).toEqual({});
    expect(config.tieredExecution.feed).toEqual({
      callouts: 'off',
      exclude: [],
      exclude_subjects: [],
      max_diff_bytes: null,
    });
    expect(config.tieredExecution.escalation).toEqual({
      enabled: false,
      retries_at_tier: 0,
      max_promotions: 0,
      flounder_budget_minutes: {},
    });
  });

  it('returns difficulty-to-tier map and supervisor policy for a valid config', () => {
    const result = validateTieredExecutionConfig(validConfig());

    expect(result.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'standard',
      complex: 'standard',
      expert: 'frontier',
    });
    expect(result.supervisor).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'flagged',
      owns_inspection: false,
    });
    expect(result.byKind).toEqual({});
  });

  it('preserves supervisor ownership of inspection when configured', () => {
    const result = validateTieredExecutionConfig(validConfig({
      supervisor: {
        model: 'claude-opus-4-8',
        harness: 'claude-code',
        subscribe: 'all',
        owns_inspection: true,
      },
    }));

    expect(result.supervisor?.owns_inspection).toBe(true);
  });

  it('validates by_kind item kinds and tier references', () => {
    const result = validateTieredExecutionConfig(validConfig({
      by_kind: { design: 'frontier' },
    }));

    expect(result.by_kind).toEqual({ design: 'frontier' });
    expect(result.byKind).toEqual({ design: 'frontier' });

    expect(() => validateTieredExecutionConfig(validConfig({
      by_kind: { unknown: 'frontier' } as never,
    }))).toThrow("tiered_execution.by_kind contains unknown item kind 'unknown'");

    expect(() => validateTieredExecutionConfig(validConfig({
      by_kind: { design: 'missing' },
    }))).toThrow("tiered_execution.by_kind.design references unknown tier 'missing'");
  });

  it('validates fully populated feed and escalation blocks', () => {
    const result = validateTieredExecutionConfig(validConfig({
      feed: {
        callouts: 'corroborate',
        exclude: ['bun.lock'],
        exclude_subjects: ['chore(beads):'],
        max_diff_bytes: 128_000,
      },
      escalation: {
        enabled: true,
        retries_at_tier: 2,
        max_promotions: 3,
        flounder_budget_minutes: { simple: 30, complex: 90 },
      },
    }));

    expect(result.feed).toEqual({
      callouts: 'corroborate',
      exclude: ['bun.lock'],
      exclude_subjects: ['chore(beads):'],
      max_diff_bytes: 128_000,
    });
    expect(result.escalation).toEqual({
      enabled: true,
      retries_at_tier: 2,
      max_promotions: 3,
      flounder_budget_minutes: { simple: 30, complex: 90 },
    });
  });

  it('rejects invalid feed and escalation fields with named config errors', () => {
    expect(() => validateTieredExecutionConfig(validConfig({
      feed: { callouts: 'loud' as never },
    }))).toThrow('tiered_execution.feed.callouts');

    expect(() => validateTieredExecutionConfig(validConfig({
      feed: { max_diff_bytes: 0 },
    }))).toThrow('tiered_execution.feed.max_diff_bytes');

    expect(() => validateTieredExecutionConfig(validConfig({
      escalation: { flounder_budget_minutes: { unknown: 10 } as never },
    }))).toThrow("tiered_execution.escalation.flounder_budget_minutes contains unknown difficulty 'unknown'");

    expect(() => validateTieredExecutionConfig(validConfig({
      escalation: { retries_at_tier: -1 },
    }))).toThrow('tiered_execution.escalation.retries_at_tier');
  });
});
