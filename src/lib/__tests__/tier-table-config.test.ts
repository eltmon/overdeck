import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../config-yaml.js';
import { validateTieredExecutionConfig } from '../agents/tier-table.js';

const VALID_TIERS = {
  cheap: {
    model: 'claude-haiku-4-5',
    harness: 'claude-code' as const,
    difficulties: ['trivial', 'simple'] as const,
  },
  standard: {
    model: 'claude-sonnet-5',
    harness: 'claude-code' as const,
    difficulties: ['medium', 'complex'] as const,
  },
  heavy: {
    model: 'claude-opus-4-8',
    harness: 'claude-code' as const,
    difficulties: ['expert'] as const,
  },
};

describe('tiered_execution config', () => {
  it('rejects difficulties mapped to zero or multiple tiers with the offending difficulty', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple'],
        },
      },
    })).toThrow('config.yaml: tiered_execution difficulty medium maps to zero tiers');

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
          difficulties: ['medium', 'complex', 'expert'],
        },
      },
    })).toThrow('config.yaml: tiered_execution difficulty medium maps to multiple tiers: cheap, standard');
  });

  it('rejects unknown models, unknown harnesses, and policy-denied tier definitions', () => {
    expect(() => validateTieredExecutionConfig({
      enabled: true,
      tiers: {
        ...VALID_TIERS,
        cheap: {
          model: 'not-a-real-model',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple'],
        },
      },
    })).toThrow('config.yaml: tiered_execution.tiers.cheap.model references unknown model not-a-real-model');

    expect(() => validateTieredExecutionConfig({
      enabled: true,
      tiers: {
        ...VALID_TIERS,
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'pi' as never,
          difficulties: ['trivial', 'simple'],
        },
      },
    })).toThrow('config.yaml: tiered_execution.tiers.cheap.harness must be claude-code, ohmypi, or codex');

    expect(() => validateTieredExecutionConfig({
      enabled: true,
      tiers: {
        ...VALID_TIERS,
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'ohmypi',
          difficulties: ['trivial', 'simple'],
        },
      },
    }, { anthropic: 'subscription' })).toThrow('config.yaml: tiered_execution.tiers.cheap is not allowed');
  });

  it('defaults to disabled with replay_threshold 0.5 when the block is absent', () => {
    const { config } = mergeConfigs({});

    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecution.replayThreshold).toBe(0.5);
    expect(config.tieredExecution.difficultyToTier).toEqual({});
  });

  it('normalizes a valid config to a difficulty map and supervisor policy', () => {
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

    expect(config.tieredExecution.difficultyToTier).toEqual({
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'standard',
      complex: 'standard',
      expert: 'heavy',
    });
    expect(config.tieredExecution.supervisor).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'all',
    });
    expect(config.tieredExecution.replayThreshold).toBe(0.75);
  });
});
