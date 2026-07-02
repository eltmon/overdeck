import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../config-yaml.js';

const VALID_TIERS = {
  cheap: {
    model: 'claude-haiku-4-5',
    harness: 'claude-code' as const,
    difficulties: ['trivial', 'simple'] as const,
  },
  mid: {
    model: 'claude-sonnet-5',
    harness: 'claude-code' as const,
    difficulties: ['medium', 'complex'] as const,
  },
  expensive: {
    model: 'claude-opus-4-8',
    harness: 'claude-code' as const,
    difficulties: ['expert'] as const,
  },
};

const VALID_SUPERVISOR = {
  model: 'claude-opus-4-8',
  harness: 'claude-code' as const,
  subscribe: 'flagged' as const,
};

describe('tiered_execution config', () => {
  it('defaults off with replay threshold when omitted', () => {
    const { config } = mergeConfigs({});

    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecution.replay_threshold).toBe(0.5);
    expect(config.tieredExecution.tiers).toEqual({});
  });

  it('rejects difficulties mapped to zero or multiple tiers with the offending difficulty', () => {
    expect(() => mergeConfigs({
      tiered_execution: {
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
        },
        supervisor: VALID_SUPERVISOR,
      },
    })).toThrow('config.yaml: tiered_execution difficulty "expert" maps to zero tiers');

    expect(() => mergeConfigs({
      tiered_execution: {
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
            difficulties: ['simple', 'medium', 'complex', 'expert'],
          },
        },
        supervisor: VALID_SUPERVISOR,
      },
    })).toThrow('config.yaml: tiered_execution difficulty "simple" maps to multiple tiers');
  });

  it('rejects unknown model, unknown harness, and subscription-gated Anthropic ohmypi combinations', () => {
    expect(() => mergeConfigs({
      tiered_execution: {
        enabled: true,
        tiers: {
          ...VALID_TIERS,
          cheap: { ...VALID_TIERS.cheap, model: 'not-a-real-model' },
        },
        supervisor: VALID_SUPERVISOR,
      },
    })).toThrow('config.yaml: tiered_execution.tiers.cheap.model unknown model "not-a-real-model"');

    expect(() => mergeConfigs({
      tiered_execution: {
        enabled: true,
        tiers: {
          ...VALID_TIERS,
          cheap: { ...VALID_TIERS.cheap, harness: 'bogus' as never },
        },
        supervisor: VALID_SUPERVISOR,
      },
    })).toThrow('config.yaml: tiered_execution.tiers.cheap.harness must be claude-code, ohmypi, or codex');

    expect(() => mergeConfigs({
      models: {
        providers: {
          anthropic: { enabled: true, auth: 'subscription' },
        },
      },
      tiered_execution: {
        enabled: true,
        tiers: {
          ...VALID_TIERS,
          mid: { ...VALID_TIERS.mid, harness: 'ohmypi' },
        },
        supervisor: VALID_SUPERVISOR,
      },
    })).toThrow('config.yaml: tiered_execution.tiers.mid violates harness policy: ohmypi cannot run Anthropic models');
  });

  it('returns difficulty-to-tier map and supervisor policy for a valid config', () => {
    const { config } = mergeConfigs({
      tiered_execution: {
        enabled: true,
        replay_threshold: 0.75,
        tiers: VALID_TIERS,
        supervisor: {
          model: 'claude-opus-4-8',
          harness: 'claude-code',
          subscribe: 'all',
        },
      },
    });

    expect(config.tieredExecution.enabled).toBe(true);
    expect(config.tieredExecution.replay_threshold).toBe(0.75);
    expect(config.tieredExecution.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'mid',
      complex: 'mid',
      expert: 'expensive',
    });
    expect(config.tieredExecution.supervisor).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'all',
    });
  });
});
