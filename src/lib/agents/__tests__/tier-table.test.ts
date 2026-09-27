import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../../config-yaml.js';
import { tieredExecutionConfigForSave } from '../../settings-api-tiered-execution.js';
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
        { tiered_execution: 'maybe' },
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

    it('rejects malformed plan metadata when no issue override supersedes it', () => {
      expect(() => resolveTieredExecutionBlock(
        { enabled: false },
        { tiered_execution: 'maybe' },
        null,
      )).toThrow(TieredExecutionConfigError);
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
    });
    expect(result.byKind).toEqual({});
  });

  it('drops the retired supervisor.owns_inspection key a config.yaml may still carry', () => {
    const result = validateTieredExecutionConfig(validConfig({
      supervisor: {
        model: 'claude-opus-4-8',
        harness: 'claude-code',
        subscribe: 'all',
        owns_inspection: false,
      } as TieredExecutionConfig['supervisor'],
    }));

    expect(result.supervisor).toEqual({ model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'all' });
    expect(tieredExecutionConfigForSave(result, {})?.supervisor).not.toHaveProperty('owns_inspection');
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
      escalation: { retries_at_tier: -1 },
    }))).toThrow('tiered_execution.escalation.retries_at_tier');

    expect(() => validateTieredExecutionConfig(validConfig({
      compaction_reroute: 'sometimes' as never,
    }))).toThrow('tiered_execution.compaction_reroute');
  });

  // PAN-3858 no-loss audit: the floundering trigger was deleted because no
  // patrol could supply per-item dispatch times without new infrastructure.
  // These two tests prove the state it guarded is unreachable: no config key
  // can feed a flounder budget, and no decider exists to consume one.
  it('drops the deleted flounder_budget_minutes key from the validated escalation config', () => {
    const result = validateTieredExecutionConfig(validConfig({
      escalation: { enabled: true, flounder_budget_minutes: { simple: 30 } } as never,
    }));
    expect(result.escalation).toEqual({ enabled: true, retries_at_tier: 0, max_promotions: 0 });
    expect('flounder_budget_minutes' in result.escalation).toBe(false);
  });

  it('exports no floundering escalation decider or budget check', async () => {
    const escalation = await import('../tier-escalation.js');
    expect('decideFlounderingEscalation' in escalation).toBe(false);
    expect('isFloundering' in escalation).toBe(false);
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
    expect(second.tiers.standard!.model).toBe('gpt-5.6-sol');
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

// PAN-4191: tier models accept the same `workhorse:<slot>` refs roles.* do,
// dereffed through derefWorkhorse, so re-pointing a slot re-points the tiers.
describe('workhorse refs in the tier table (PAN-4191)', () => {
  function workhorseTiered(): TieredExecutionConfig {
    return validConfig({
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial'] },
        mid: { model: 'workhorse:mid', harness: 'claude-code', difficulties: ['simple', 'medium'] },
        expensive: {
          difficulties: ['complex', 'expert'],
          distribution: [
            { model: 'workhorse:expensive', harness: 'claude-code', weight: 70 },
            { model: 'claude-sonnet-5', harness: 'claude-code', weight: 30 },
          ],
        } as never,
      },
      supervisor: { model: 'workhorse:expensive', harness: 'claude-code', subscribe: 'flagged' },
    });
  }

  it('resolves tier, distribution and supervisor refs through the workhorse slots', () => {
    const result = validateTieredExecutionConfig(workhorseTiered(), {
      workhorses: { mid: 'claude-sonnet-5', expensive: 'claude-opus-5-5' },
    });

    expect(result.tiers.mid).toMatchObject({ model: 'claude-sonnet-5', modelRef: 'workhorse:mid' });
    expect(result.tiers.expensive).toMatchObject({ model: 'claude-opus-5-5', modelRef: 'workhorse:expensive' });
    expect(result.tiers.expensive!.distribution![0]).toMatchObject({ model: 'claude-opus-5-5', modelRef: 'workhorse:expensive' });
    expect(result.tiers.expensive!.distribution![1]).not.toHaveProperty('modelRef');
    expect(result.tiers.cheap).not.toHaveProperty('modelRef');
    expect(result.supervisor).toMatchObject({ model: 'claude-opus-5-5', modelRef: 'workhorse:expensive' });
  });

  it('re-points a tier when its workhorse slot changes (config load end to end)', () => {
    const load = (mid: string) => mergeConfigs({
      workhorses: { mid, expensive: 'claude-opus-5-5' },
      tiered_execution: workhorseTiered(),
    }).config;

    expect(load('claude-sonnet-5').tieredExecution.tiers.mid!.model).toBe('claude-sonnet-5');
    expect(load('claude-opus-5-5').tieredExecution.tiers.mid!.model).toBe('claude-opus-5-5');
    expect(load('claude-opus-5-5').tieredExecutionInvalid).toBeUndefined();
  });

  it('rejects an unknown workhorse slot loudly', () => {
    const config = validConfig({
      tiers: {
        all: { model: 'workhorse:nope', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
      },
    });

    expect(() => validateTieredExecutionConfig(config, { workhorses: { mid: 'claude-sonnet-5' } }))
      .toThrow(TieredExecutionConfigError);
    expect(() => validateTieredExecutionConfig(config, { workhorses: { mid: 'claude-sonnet-5' } }))
      .toThrow(/tiered_execution\.tiers\.all\.model references workhorse:nope but workhorses\.nope is not defined/);
  });

  it('rejects the parent sentinel and unknown literal models', () => {
    const withModel = (model: string) => validConfig({
      tiers: { all: { model, harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
    });
    expect(() => validateTieredExecutionConfig(withModel('parent'), {})).toThrow(TieredExecutionConfigError);
    expect(() => validateTieredExecutionConfig(withModel('not-a-model'), {})).toThrow(/'not-a-model' is unknown/);
  });

  it('degrades on config load instead of throwing for an undefined slot ref', () => {
    const { config } = mergeConfigs({
      tiered_execution: validConfig({
        tiers: { all: { model: 'workhorse:nope', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
      }),
    });
    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecutionInvalid?.reason).toContain('workhorse:nope');
  });

  it('a settings save writes the workhorse ref back, never the slot\'s current model', () => {
    const context = { workhorses: { mid: 'claude-sonnet-5', expensive: 'claude-opus-5-5' } };
    const validated = validateTieredExecutionConfig(workhorseTiered(), context);
    const saved = tieredExecutionConfigForSave(validated, context)!;

    expect(saved.tiers!.mid).toEqual({ model: 'workhorse:mid', harness: 'claude-code', difficulties: ['simple', 'medium'] });
    expect(saved.tiers!.expensive!.model).toBe('workhorse:expensive');
    expect(saved.tiers!.expensive!.distribution![0]).toEqual({ model: 'workhorse:expensive', harness: 'claude-code', weight: 70 });
    expect(saved.supervisor).toMatchObject({ model: 'workhorse:expensive' });
    expect(saved.supervisor).not.toHaveProperty('modelRef');
  });

  it('a Settings edit that picks a literal model replaces the workhorse ref', () => {
    const context = { workhorses: { mid: 'claude-sonnet-5', expensive: 'claude-opus-5-5' } };
    const validated = validateTieredExecutionConfig(workhorseTiered(), context);
    const { modelRef: _dropped, ...midWithoutRef } = validated.tiers.mid!;
    const edited = { ...validated, tiers: { ...validated.tiers, mid: { ...midWithoutRef, model: 'claude-haiku-4-5' } } };

    const saved = tieredExecutionConfigForSave(edited, context)!;
    expect(saved.tiers!.mid!.model).toBe('claude-haiku-4-5');
  });
});
