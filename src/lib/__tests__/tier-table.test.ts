import { describe, expect, it } from 'vitest';
import {
  normalizeTieredExecutionConfig,
  TieredExecutionConfigError,
  validateTieredExecutionConfig,
} from '../agents/tier-table.js';

const validTieredExecutionConfig = {
  enabled: true,
  tiers: {
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
      model: 'claude-opus-4-6',
      harness: 'claude-code',
      difficulties: ['expert'],
    },
  },
  supervisor: {
    model: 'claude-sonnet-4-6',
    harness: 'claude-code',
    subscribe: 'flagged',
  },
  replay_threshold: 0.75,
} as const;

describe('tiered execution tier table', () => {
  it('defaults to disabled with replay threshold 0.5 when omitted', () => {
    expect(normalizeTieredExecutionConfig(undefined)).toMatchObject({
      enabled: false,
      replay_threshold: 0.5,
      tiers: {},
      supervisor: {
        model: '',
        harness: 'claude-code',
        subscribe: 'flagged',
      },
    });
  });

  it('rejects a difficulty mapped to zero tiers with a named validation error', () => {
    expect(() => validateTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
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
      },
    })).toThrow(TieredExecutionConfigError);

    expect(() => validateTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
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
      },
    })).toThrow('difficulty expert maps to zero tiers');
  });

  it('rejects a difficulty mapped to multiple tiers with a named validation error', () => {
    expect(() => validateTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple'],
        },
        standard: {
          model: 'claude-sonnet-4-6',
          harness: 'claude-code',
          difficulties: ['simple', 'medium', 'complex'],
        },
        premium: {
          model: 'claude-opus-4-6',
          harness: 'claude-code',
          difficulties: ['expert'],
        },
      },
    })).toThrow('difficulty simple maps to multiple tiers: cheap, standard');
  });

  it('rejects unknown model and harness values', () => {
    expect(() => normalizeTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
        ...validTieredExecutionConfig.tiers,
        cheap: {
          model: 'not-a-model',
          harness: 'claude-code',
          difficulties: ['trivial', 'simple'],
        },
      },
    })).toThrow('tiered_execution.tiers.cheap.model is unknown: not-a-model');

    expect(() => normalizeTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
        ...validTieredExecutionConfig.tiers,
        cheap: {
          model: 'claude-haiku-4-5',
          harness: 'bad-harness' as never,
          difficulties: ['trivial', 'simple'],
        },
      },
    })).toThrow('tiered_execution.tiers.cheap.harness must be claude-code, ohmypi, or codex');
  });

  it('applies the harness policy gate to tier and supervisor definitions', () => {
    expect(() => validateTieredExecutionConfig({
      ...validTieredExecutionConfig,
      tiers: {
        ...validTieredExecutionConfig.tiers,
        standard: {
          model: 'claude-sonnet-4-6',
          harness: 'ohmypi',
          difficulties: ['medium', 'complex'],
        },
      },
    }, {
      providerAuth: { anthropic: 'subscription' },
    })).toThrow('ohmypi cannot run Anthropic models');

    expect(() => validateTieredExecutionConfig({
      ...validTieredExecutionConfig,
      supervisor: {
        model: 'claude-sonnet-4-6',
        harness: 'ohmypi',
        subscribe: 'all',
      },
    }, {
      providerAuth: { anthropic: 'subscription' },
    })).toThrow('ohmypi cannot run Anthropic models');
  });

  it('returns a complete difficulty map and supervisor policy for a valid config', () => {
    expect(validateTieredExecutionConfig(validTieredExecutionConfig)).toMatchObject({
      difficultyToTier: {
        trivial: 'cheap',
        simple: 'cheap',
        medium: 'standard',
        complex: 'standard',
        expert: 'premium',
      },
      supervisor: {
        model: 'claude-sonnet-4-6',
        harness: 'claude-code',
        subscribe: 'flagged',
      },
    });
  });
});
