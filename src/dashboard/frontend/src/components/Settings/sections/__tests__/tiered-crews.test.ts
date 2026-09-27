import { describe, expect, it } from 'vitest';
import type { SettingsConfig, TieredExecutionConfig } from '../../types';
import {
  blendedCost,
  crewLabel,
  deriveTierName,
  importCrews,
  providerDefaultHarness,
  renderYamlPreview,
  tierFitnessWarnings,
  serializeCrews,
  type Crew,
} from '../tiered-crews';

const mix = [
  { model: 'claude-haiku-4-5', harness: 'claude-code' as const, weight: 10 },
  { model: 'claude-sonnet-5', harness: 'claude-code' as const, weight: 40 },
  { model: 'gpt-5.6-terra', harness: 'codex' as const, weight: 30 },
  { model: 'gemini-3.1-pro-preview', harness: 'ohmypi' as const, weight: 20 },
];

const liveConfig: TieredExecutionConfig = {
  enabled: true,
  tiers: {
    'tier-1': { model: 'kimi-k2.7-code', harness: 'ohmypi', difficulties: ['trivial', 'simple'] },
    'tier-2': { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium'], distribution: mix },
    'tier-3': { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['complex', 'expert'], distribution: [...mix].reverse() },
  },
  by_kind: { docs: 'tier-1', frontend: 'tier-3' },
  compaction_reroute: 'on',
  replay_threshold: 0.5,
};

describe('tiered crews mapping', () => {
  it('merges tiers with identical staffing and unions their assignments', () => {
    const imported = importCrews(liveConfig);
    expect(imported.crews).toHaveLength(2);
    expect(imported.assign).toEqual({
      trivial: 'tier-1', simple: 'tier-1', medium: 'tier-2', complex: 'tier-2', expert: 'tier-2',
    });
    expect(imported.rest.by_kind).toEqual({ docs: 'tier-1', frontend: 'tier-2' });
  });

  it('derives ordered names and rewrites representatives and kind overrides on save', () => {
    expect(deriveTierName(['medium'])).toBe('medium');
    expect(deriveTierName(['simple', 'trivial'])).toBe('trivial-simple');
    expect(deriveTierName(['expert', 'trivial'])).toBe('trivial-expert');

    const imported = importCrews(liveConfig);
    const serialized = serializeCrews(imported.crews, imported.assign, imported.rest);
    expect(Object.keys(serialized.tiers)).toEqual(['trivial-simple', 'medium-complex-expert']);
    expect(serialized.tiers['medium-complex-expert']).toMatchObject({
      model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'],
    });
    expect(serialized.by_kind).toEqual({ docs: 'trivial-simple', frontend: 'medium-complex-expert' });
    expect(serialized.byKind).toBeUndefined();
  });

  it('labels crews and blends only catalogued costs', () => {
    const imported = importCrews(liveConfig);
    expect(crewLabel(imported.crews[0])).toBe('Kimi K2.7 Code (256K context)');
    expect(crewLabel(imported.crews[1])).toBe('4-model mix');
    // Catalog weights: (3×10 + 6×40 + 7×30 + 7×20) / 100 = 6.2.
    expect(blendedCost(imported.crews[1])).toBeCloseTo(6.2);
    expect(blendedCost({ id: 'unknown', model: 'missing', harness: 'ohmypi' })).toBeNull();
  });

  it('resolves configured and built-in provider harness defaults', () => {
    const settings = { models: { provider_harnesses: { openai: 'ohmypi' } } } as Pick<SettingsConfig, 'models'>;
    expect(providerDefaultHarness('gpt-5.6-sol', settings)).toBe('ohmypi');
    expect(providerDefaultHarness('claude-sonnet-5', settings)).toBe('claude-code');
    expect(providerDefaultHarness('kimi-k2.7-code', settings)).toBe('ohmypi');
    expect(providerDefaultHarness('gpt-5.6-sol', { models: {} } as Pick<SettingsConfig, 'models'>)).toBe('codex');
  });

  it('renders the exact outgoing tiered_execution YAML without a YAML dependency', () => {
    const config: TieredExecutionConfig = {
      enabled: true,
      tiers: { medium: { model: 'kimi-k2.7-code', harness: 'ohmypi', difficulties: ['medium'] } },
      by_kind: {},
      replay_threshold: 0.5,
    };
    expect(renderYamlPreview(config)).toBe([
      'tiered_execution:',
      '  enabled: true',
      '  tiers:',
      '    medium:',
      '      model: kimi-k2.7-code',
      '      harness: ohmypi',
      '      difficulties:',
      '        - medium',
      '  by_kind:',
      '    {}',
      '  replay_threshold: 0.5',
    ].join('\n'));
  });

  it('uses the maximum-weight distribution entry as representative', () => {
    const crew: Crew = { id: 'mix', model: 'missing', harness: 'ohmypi', distribution: mix };
    const config = serializeCrews([crew], { expert: 'mix' }, { enabled: true, by_kind: {}, replay_threshold: 0.5 });
    expect(config.tiers.expert.model).toBe('claude-sonnet-5');
    expect(config.tiers.expert.harness).toBe('claude-code');
  });

  it('rejects unassigning the final difficulty from a kind-routed crew', () => {
    const imported = importCrews({
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial'] },
        standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['simple', 'medium', 'complex', 'expert'] },
      },
      by_kind: { docs: 'cheap' },
      replay_threshold: 0.5,
    });

    expect(() => serializeCrews(
      imported.crews,
      { ...imported.assign, trivial: 'standard' },
      imported.rest,
    )).toThrow("Move or remove docs kind overrides before unassigning this crew's final difficulty.");
  });
});


// PAN-3842 (adjudicated F-4): Settings built knownModelIds from
// MODELS_BY_PROVIDER alone, which has no groq/cerebras/mistral groups, so it
// called models the server knows "not in the model catalog".
describe('tierFitnessWarnings model catalog agreement', () => {
  const settings = {
    models: { providers: { anthropic: true, openai: true, zai: true } },
  } as unknown as Pick<SettingsConfig, 'models'>;

  const tierWith = (model: string): TieredExecutionConfig => ({
    enabled: true,
    tiers: { standard: { model, harness: 'claude-code', difficulties: ['medium'] } },
    by_kind: {},
    replay_threshold: 0.5,
  } as unknown as TieredExecutionConfig);

  it.each(['mistral-large-latest', 'llama-3.3-70b-versatile'])(
    'does not call %s unknown — the server catalog has it',
    (model) => {
      const codes = tierFitnessWarnings(tierWith(model), settings).map((warning) => warning.code);
      expect(codes).not.toContain('unknown-model');
    },
  );

  it('still reports a genuinely absent id as unknown', () => {
    const codes = tierFitnessWarnings(tierWith('not-a-real-model'), settings).map((warning) => warning.code);
    expect(codes).toEqual(['unknown-model']);
  });

  it('classifies a shared-table model the frontend catalog omits', () => {
    // Being known is not enough — the band check must reach it too.
    // mistral-large-latest is frontier; a trivial-only tier caps at workhorse.
    const trivialTier = {
      enabled: true,
      tiers: { cheap: { model: 'mistral-large-latest', harness: 'claude-code', difficulties: ['trivial'] } },
      by_kind: {},
      replay_threshold: 0.5,
    } as unknown as TieredExecutionConfig;
    const codes = tierFitnessWarnings(trivialTier, settings).map((warning) => warning.code);
    expect(codes).toContain('overpowered');
  });

  it('runs the band check on a groq model the frontend catalog omits', () => {
    // llama-3.3-70b-versatile is workhorse; an expert tier needs frontier.
    const expertTier = {
      enabled: true,
      tiers: { top: { model: 'llama-3.3-70b-versatile', harness: 'claude-code', difficulties: ['expert'] } },
      by_kind: {},
      replay_threshold: 0.5,
    } as unknown as TieredExecutionConfig;
    const codes = tierFitnessWarnings(expertTier, settings).map((warning) => warning.code);
    expect(codes).toContain('underpowered');
  });
});

// PAN-3842 (adjudicated F-1): the frontend builder must scope the
// provider-not-enabled warning the same way the server does.
describe('tierFitnessWarnings provider scoping', () => {
  const settings = {
    models: { providers: { anthropic: true } },
  } as unknown as Pick<SettingsConfig, 'models'>;

  const tierWith = (model: string): TieredExecutionConfig => ({
    enabled: true,
    tiers: { standard: { model, harness: 'claude-code', difficulties: ['medium'] } },
    by_kind: {},
    replay_threshold: 0.5,
  } as unknown as TieredExecutionConfig);

  it('warns when a configurable provider is switched off', () => {
    const codes = tierFitnessWarnings(tierWith('glm-5.1'), settings).map((warning) => warning.code);
    expect(codes).toContain('provider-not-enabled');
  });

  it('stays silent for a provider with no Settings control', () => {
    const codes = tierFitnessWarnings(tierWith('mistral-large-latest'), settings).map((warning) => warning.code);
    expect(codes).not.toContain('provider-not-enabled');
  });
});

// PAN-4191: cost, harness, labels and fitness read the model a workhorse ref resolves to.
describe('workhorse refs in crews (PAN-4191)', () => {
  const workhorses = { expensive: 'claude-opus-5-5', mid: 'claude-sonnet-5', cheap: 'gpt-5.6-luna' };
  const refCrew: Crew = { id: 'mid', model: 'workhorse:mid', harness: 'claude-code' };

  it('resolves the ref for label, cost and provider-default harness', () => {
    expect(crewLabel(refCrew, undefined, workhorses)).toMatch(/^workhorse:mid → Claude Sonnet 5/);
    expect(blendedCost(refCrew, undefined, workhorses)).toBe(blendedCost({ ...refCrew, model: 'claude-sonnet-5' }));
    expect(providerDefaultHarness('workhorse:cheap', { models: { providers: {} } as SettingsConfig['models'], workhorses })).toBe('codex');
  });

  it('judges tier fitness on the resolved model, not the ref', () => {
    const config: TieredExecutionConfig = {
      enabled: true,
      tiers: { all: { model: 'workhorse:expensive', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
      supervisor: { model: 'workhorse:expensive', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
    };
    const warnings = tierFitnessWarnings(config, { models: { providers: { anthropic: true } } as SettingsConfig['models'], workhorses });
    expect(warnings.map((warning) => warning.model)).not.toContain('workhorse:expensive');
    expect(warnings.filter((warning) => warning.code === 'unknown-model')).toEqual([]);
  });
});
