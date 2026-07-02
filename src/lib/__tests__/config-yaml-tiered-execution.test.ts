import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../config-yaml.js';

describe('config-yaml tiered_execution', () => {
  it('defaults to disabled without requiring a tier table', () => {
    const { config } = mergeConfigs({});

    expect(config.tieredExecution.enabled).toBe(false);
    expect(config.tieredExecution.replay_threshold).toBe(0.5);
    expect(config.tieredExecution.tiers).toEqual({});
  });

  it('merges and validates a complete tier table', () => {
    const { config } = mergeConfigs({
      tiered_execution: {
        enabled: true,
        supervisor: {
          model: 'claude-opus-4-7',
          harness: 'claude-code',
          subscribe: 'sampled',
        },
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
          expert: {
            model: 'claude-opus-4-7',
            harness: 'claude-code',
            difficulties: ['expert'],
          },
        },
      },
    });

    expect(config.tieredExecution.enabled).toBe(true);
    expect(config.tieredExecution.supervisor.subscribe).toBe('sampled');
  });

  it('rejects tier tables that violate the existing harness policy gate', () => {
    expect(() => mergeConfigs({
      models: {
        providers: {
          anthropic: { enabled: true, auth: 'subscription' },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tiered_execution: {
        enabled: true,
        tiers: {
          blocked: {
            model: 'claude-sonnet-4-6',
            harness: 'pi',
            difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
          },
        },
      } as any,
    })).toThrow('ohmypi cannot run Anthropic models');
  });
});
