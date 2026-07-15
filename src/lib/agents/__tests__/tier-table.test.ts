import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../../config-yaml.js';
import {
  TieredExecutionConfigError,
  resolveTieredExecutionBlock,
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
  describe('resolveTieredExecutionBlock', () => {
    it.each([
      ['on', true],
      ['off', false],
    ] as const)('uses the issue override %s before every other source', (override, effective) => {
      expect(resolveTieredExecutionBlock(
        { enabled: !effective },
        { tiered_execution: effective ? 'off' : 'on' },
        override,
      )).toEqual({ effective, source: 'issue-override', override });
    });

    it.each([
      ['on', true],
      ['off', false],
    ] as const)('uses the plan metadata value %s when there is no issue override', (value, effective) => {
      expect(resolveTieredExecutionBlock(
        { enabled: !effective },
        { tiered_execution: value },
        null,
      )).toEqual({ effective, source: 'plan-metadata', override: null });
    });

    it('falls through to the global setting when no override is present', () => {
      expect(resolveTieredExecutionBlock({ enabled: true }, undefined, undefined)).toEqual({
        effective: true,
        source: 'global',
        override: null,
      });
    });

    it('falls through to the global setting for malformed plan metadata', () => {
      expect(resolveTieredExecutionBlock(
        { enabled: false },
        { tiered_execution: 'maybe' },
        null,
      )).toEqual({ effective: false, source: 'global', override: null });
    });
  });

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

  it('degrades Anthropic-subscription-on-ohmypi at load: staffing disabled, reason surfaced (PAN-2395)', () => {
    const merged = mergeConfigs({
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
    });
    expect(merged.config.tieredExecution.enabled).toBe(false);
    expect(merged.config.tieredExecutionInvalid?.reason).toContain('ohmypi cannot run Anthropic models');
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
    expect(config.tieredExecution.compaction_reroute).toBe('off');
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
      owns_inspection: true,
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
        exclude_subjects: ['chore(tasks):'],
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
      exclude_subjects: ['chore(tasks):'],
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

    expect(() => validateTieredExecutionConfig(validConfig({
      compaction_reroute: 'sometimes' as never,
    }))).toThrow('tiered_execution.compaction_reroute');
  });
});

// PAN-2391: distribution tiers — weighted model+harness entries per tier.
describe('validateTieredExecutionConfig distribution tiers (PAN-2391)', () => {
  const base = {
    enabled: true,
    supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
    tiers: {
      cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
      standard: {
        difficulties: ['medium', 'complex', 'expert'],
        distribution: [
          { model: 'gpt-5.5', harness: 'codex', weight: 40 },
          { model: 'kimi-k2.7-code', harness: 'claude-code', weight: 60 },
        ],
      },
    },
  };

  it('accepts a distribution tier and normalizes a max-weight representative', () => {
    const validated = validateTieredExecutionConfig(base as never);
    const standard = validated.tiers.standard!;
    expect(standard.distribution).toHaveLength(2);
    expect(standard.model).toBe('kimi-k2.7-code');
    expect(standard.harness).toBe('claude-code');
  });

  it('rejects declaring both model/harness and distribution', () => {
    const config = structuredClone(base) as never as typeof base;
    (config.tiers.standard as Record<string, unknown>).model = 'gpt-5.5';
    (config.tiers.standard as Record<string, unknown>).harness = 'codex';
    expect(() => validateTieredExecutionConfig(config as never)).toThrow(/not both/);
  });

  it('rejects weights that do not total 100', () => {
    const config = structuredClone(base) as never as { tiers: { standard: { distribution: Array<{ weight: number }> } } };
    config.tiers.standard.distribution[0]!.weight = 50;
    expect(() => validateTieredExecutionConfig(config as never)).toThrow(/total exactly 100/);
  });

  it('rejects non-positive-integer weights', () => {
    const config = structuredClone(base) as never as { tiers: { standard: { distribution: Array<{ weight: number }> } } };
    config.tiers.standard.distribution[0]!.weight = 0;
    expect(() => validateTieredExecutionConfig(config as never)).toThrow(/positive integer/);
  });

  it('validates each entry model/harness', () => {
    const config = structuredClone(base) as never as { tiers: { standard: { distribution: Array<{ harness: string }> } } };
    config.tiers.standard.distribution[0]!.harness = 'not-a-harness';
    expect(() => validateTieredExecutionConfig(config as never)).toThrow(/harness/);
  });
});

// Round-trip: save writes the validated (normalized) tiers — representative
// model/harness alongside distribution — and the next load re-validates that
// exact shape. Validation must be idempotent or tiered staffing silently
// degrades on the second load.
describe('distribution validation is idempotent across save/load round-trips (PAN-2391)', () => {
  it('re-validating a validated distribution config succeeds', () => {
    const first = validateTieredExecutionConfig({
      enabled: true,
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      tiers: {
        standard: {
          difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
          distribution: [
            { model: 'gpt-5.5', harness: 'codex', weight: 60 },
            { model: 'kimi-k2.7-code', harness: 'claude-code', weight: 40 },
          ],
        },
      },
    } as never);
    const second = validateTieredExecutionConfig(first as never);
    expect(second.tiers.standard!.model).toBe('gpt-5.5');
    expect(second.tiers.standard!.distribution).toHaveLength(2);
  });

  it('still rejects a genuinely conflicting model alongside a distribution', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      tiers: {
        standard: {
          model: 'claude-haiku-4-5',
          difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
          distribution: [
            { model: 'gpt-5.5', harness: 'codex', weight: 100 },
          ],
        },
      },
    } as never)).toThrow(/not both/);
  });
});
