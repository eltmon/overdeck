/**
 * Integration tests for role-based configuration precedence.
 *
 * PAN-1048 removed the legacy work-type routing layer. Model selection now resolves from:
 * 1. role sub-config (`roles.<role>.sub.<subRole>.model`)
 * 2. role config (`roles.<role>.model`)
 * 3. built-in role defaults
 * 4. workhorse indirection (`workhorse:<slot>`)
 */

import { describe, it, expect } from 'vitest';
import { mergeConfigs, resolveModel } from '../../src/lib/config-yaml.js';

describe('configuration precedence for role model routing', () => {
  it('uses project role config over lower-precedence global config', () => {
    const { config } = mergeConfigs(
      {
        roles: {
          work: { model: 'claude-opus-4-7' },
        },
      },
      {
        roles: {
          work: { model: 'claude-haiku-4-5' },
        },
      },
    );

    expect(resolveModel('work', undefined, config)).toBe('claude-opus-4-7');
  });

  it('uses sub-role model config over parent role config', () => {
    const { config } = mergeConfigs({
      roles: {
        review: {
          model: 'claude-opus-4-7',
          sub: {
            security: { model: 'claude-sonnet-4-6' },
          },
        },
      },
    });

    expect(resolveModel('review', 'security', config)).toBe('claude-sonnet-4-6');
    expect(resolveModel('review', 'unconfigured-sub-role', config)).toBe('claude-opus-4-7');
  });

  it('resolves role defaults through default workhorse slots', () => {
    const { config } = mergeConfigs(null);

    expect(resolveModel('plan', undefined, config)).toBe('claude-opus-4-7');
    // PAN-1048 R4: default workhorse:mid is claude-sonnet-4-7.
    expect(resolveModel('work', undefined, config)).toBe('claude-sonnet-4-7');
    expect(resolveModel('work', 'inspect', config)).toBe('claude-haiku-4-5');
    expect(resolveModel('review', 'requirements', config)).toBe('claude-sonnet-4-7');
  });

  it('uses configured workhorse slots for roles and sub-roles', () => {
    const { config } = mergeConfigs({
      workhorses: {
        expensive: 'gpt-5.5',
        mid: 'glm-5.1',
        cheap: 'minimax-m2.7-highspeed',
      },
      roles: {
        plan: { model: 'workhorse:expensive' },
        work: {
          model: 'workhorse:mid',
          sub: {
            inspect: { model: 'workhorse:cheap' },
          },
        },
      },
    });

    expect(resolveModel('plan', undefined, config)).toBe('gpt-5.5');
    expect(resolveModel('work', undefined, config)).toBe('glm-5.1');
    expect(resolveModel('work', 'inspect', config)).toBe('minimax-m2.7-highspeed');
  });

  it('rejects nested workhorse references', () => {
    expect(() => mergeConfigs({
      workhorses: {
        expensive: 'workhorse:mid',
      },
    })).toThrow(/cannot reference another workhorse/);
  });
});
