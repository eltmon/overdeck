import { describe, expect, it } from 'vitest';
import type { SettingsConfig, TieredExecutionConfig } from '../../types';
import {
  blendedCost,
  crewLabel,
  deriveTierName,
  importCrews,
  providerDefaultHarness,
  renderYamlPreview,
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
    expect(crewLabel(imported.crews[0])).toBe('Kimi K2.7 Code');
    expect(crewLabel(imported.crews[1])).toBe('4-model mix');
    expect(blendedCost(imported.crews[1])).toBeCloseTo(6.525);
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

  it('retains a kind-routed crew after its final difficulty is reassigned', () => {
    const imported = importCrews({
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial'] },
        standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['simple', 'medium', 'complex', 'expert'] },
      },
      by_kind: { docs: 'cheap' },
      replay_threshold: 0.5,
    });

    const serialized = serializeCrews(
      imported.crews,
      { ...imported.assign, trivial: 'standard' },
      imported.rest,
    );

    expect(serialized.tiers['kind-docs']).toMatchObject({
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      difficulties: [],
    });
    expect(serialized.by_kind).toEqual({ docs: 'kind-docs' });
  });
});
