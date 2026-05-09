import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_REFS,
  derefWorkhorse,
  mergeConfigs,
  resolveModel,
  type NormalizedConfig,
} from '../config-yaml.js';
import type { Role } from '../agents.js';

const WORKHORSES = {
  expensive: 'claude-opus-4-7',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5',
};

function roleConfig(): Pick<NormalizedConfig, 'workhorses' | 'roles'> {
  return {
    workhorses: WORKHORSES,
    roles: {
      plan: { model: 'workhorse:expensive' },
      work: { model: 'workhorse:mid' },
      review: {
        model: 'workhorse:expensive',
        sub: {
          security: { model: 'workhorse:cheap' },
          requirements: { model: 'glm-5.1' },
        },
      },
      test: { model: 'gemini-3.1-pro-preview' },
      ship: { model: 'workhorse:mid', harness: 'pi' },
    },
  };
}

describe('role model configuration', () => {
  it('exports default model refs for exactly the five roles', () => {
    expect(Object.keys(DEFAULT_MODEL_REFS).sort()).toEqual(['plan', 'review', 'ship', 'test', 'work']);
  });

  it('dereferences workhorse refs and passes literal model ids through', () => {
    const config = roleConfig();

    expect(derefWorkhorse('workhorse:expensive', config, 'roles.plan.model')).toBe('claude-opus-4-7');
    expect(derefWorkhorse('kimi-k2.6-flash', config, 'roles.work.model')).toBe('kimi-k2.6-flash');
  });

  it('resolves all five role models through workhorse or literal refs', () => {
    const config = roleConfig();
    const expected: Record<Role, string> = {
      plan: 'claude-opus-4-7',
      work: 'claude-sonnet-4-6',
      review: 'claude-opus-4-7',
      test: 'gemini-3.1-pro-preview',
      ship: 'claude-sonnet-4-6',
    };

    for (const role of Object.keys(expected) as Role[]) {
      expect(resolveModel(role, undefined, config)).toBe(expected[role]);
    }
  });

  it('uses sub-role overrides before role-level model refs', () => {
    const config = roleConfig();

    expect(resolveModel('review', 'security', config)).toBe('claude-haiku-4-5');
    expect(resolveModel('review', 'requirements', config)).toBe('glm-5.1');
  });

  it('rejects missing workhorse slots with the offending field path', () => {
    expect(() => mergeConfigs({
      workhorses: { mid: 'claude-sonnet-4-6' },
      roles: { review: { model: 'workhorse:expensive' } },
    })).toThrow('config.yaml: roles.review.model references workhorse:expensive but workhorses.expensive is not defined');
  });

  it('rejects chained workhorse refs at config parse time', () => {
    expect(() => mergeConfigs({
      workhorses: { cheap: 'workhorse:mid', mid: 'claude-sonnet-4-6' },
    })).toThrow('config.yaml: workhorses.cheap cannot reference another workhorse');
  });

  it('round-trips workhorses, role models, harness, and sub-role overrides through merged config', () => {
    const { config } = mergeConfigs({
      workhorses: WORKHORSES,
      roles: {
        review: {
          model: 'workhorse:expensive',
          harness: 'claude-code',
          sub: {
            performance: { model: 'workhorse:mid' },
          },
        },
      },
    });

    expect(config.workhorses).toEqual(WORKHORSES);
    expect(config.roles?.review?.model).toBe('workhorse:expensive');
    expect(config.roles?.review?.harness).toBe('claude-code');
    expect(config.roles?.review?.sub?.performance?.model).toBe('workhorse:mid');
    expect(resolveModel('review', 'performance', config)).toBe('claude-sonnet-4-6');
  });
});
