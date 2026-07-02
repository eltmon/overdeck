import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../config-yaml.js';

const COMPLETE_TIERS = {
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
} as const;

const SUPERVISOR = {
  model: 'claude-opus-4-7',
  harness: 'claude-code',
  subscribe: 'flagged',
} as const;

describe('tiered_execution config', () => {
  it('rejects difficulty mappings that are missing or duplicated with named errors', () => {
    expect(() => mergeConfigs({
      tiered_execution: {
        enabled: true,
        tiers: {
          standard: {
            model: 'claude-sonnet-4-6',
            harness: 'claude-code',
            difficulties: ['simple', 'medium', 'complex', 'expert'],
          },
        },
        supervisor: SUPERVISOR,
      },
    })).toThrow('tiered_execution difficulty trivial maps to zero tiers');

    expect(() => mergeConfigs({
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: {
            model: 'claude-haiku-4-5',
            harness: 'claude-code',
            difficulties: ['trivial', 'simple'],
          },
          overlap: {
            model: 'claude-sonnet-4-6',
            harness: 'claude-code',
            difficulties: ['simple', 'medium', 'complex', 'expert'],
          },
        },
        supervisor: SUPERVISOR,
      },
    })).toThrow('tiered_execution difficulty simple maps to multiple tiers: cheap, overlap');
  });

  it('rejects unknown models, unknown harnesses, and policy-denied harness/model/auth cells', () => {
    expect(() => mergeConfigs({
      tiered_execution: {
        enabled: true,
        tiers: {
          ...COMPLETE_TIERS,
          cheap: {
            model: 'not-a-real-model',
            harness: 'claude-code',
            difficulties: ['trivial', 'simple'],
          },
        },
        supervisor: SUPERVISOR,
      },
    })).toThrow('tiered_execution.tiers.cheap.model unknown model not-a-real-model');

    expect(() => mergeConfigs({
      tiered_execution: {
        enabled: true,
        tiers: {
          ...COMPLETE_TIERS,
          cheap: {
            model: 'claude-haiku-4-5',
            harness: 'unknown-harness',
            difficulties: ['trivial', 'simple'],
          },
        },
        supervisor: SUPERVISOR,
      },
    })).toThrow('tiered_execution.tiers.cheap.harness unknown harness unknown-harness');

    expect(() => mergeConfigs({
      models: {
        providers: {
          anthropic: { enabled: true, auth: 'subscription' },
        },
      },
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: {
            model: 'claude-haiku-4-5',
            harness: 'pi',
            difficulties: ['trivial', 'simple'],
          },
          standard: COMPLETE_TIERS.standard,
          premium: COMPLETE_TIERS.premium,
        },
        supervisor: SUPERVISOR,
      },
    })).toThrow('tiered_execution.tiers.cheap denied by harness policy');
  });

  it('defaults to disabled with replay_threshold=0.5 when no block is present', () => {
    const { config } = mergeConfigs({});

    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecution.replay_threshold).toBe(0.5);
    expect(config.tieredExecution.tiers).toEqual({});
    expect(config.tieredExecution.difficultyToTier).toBeUndefined();
  });

  it('returns a difficulty-to-tier map and supervisor policy for valid config', () => {
    const { config } = mergeConfigs({
      tiered_execution: {
        enabled: true,
        replay_threshold: 0.75,
        tiers: COMPLETE_TIERS,
        supervisor: SUPERVISOR,
      },
    });

    expect(config.tieredExecution).toMatchObject({
      enabled: true,
      replay_threshold: 0.75,
      supervisor: SUPERVISOR,
      difficultyToTier: {
        trivial: 'cheap',
        simple: 'cheap',
        medium: 'standard',
        complex: 'standard',
        expert: 'premium',
      },
    });
  });
});
