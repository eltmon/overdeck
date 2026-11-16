import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../../config-yaml.js';
import { DEFAULT_CONFIG } from '../defaults.js';

describe('config-yaml security.semgrep block (PAN-4585)', () => {
  it('defaults to disabled', () => {
    const { config } = mergeConfigs(null);
    expect(config.security.semgrep).toEqual({
      enabled: false,
      mcp: false,
      edit_hook: false,
      gate: 'advisory',
      severity: 'ERROR',
      configs: ['p/default'],
      timeout_seconds: 300,
    });
  });

  it('enables via a global layer', () => {
    const { config } = mergeConfigs({ security: { semgrep: { enabled: true } } });
    expect(config.security.semgrep.enabled).toBe(true);
  });

  it('enables mcp and edit_hook via a global layer', () => {
    const { config } = mergeConfigs({ security: { semgrep: { mcp: true, edit_hook: true } } });
    expect(config.security.semgrep.mcp).toBe(true);
    expect(config.security.semgrep.edit_hook).toBe(true);
  });

  it('throws on a non-boolean enabled value', () => {
    expect(() =>
      // @ts-expect-error — exercising runtime validation of bad input
      mergeConfigs({ security: { semgrep: { enabled: 'yes' } } }),
    ).toThrow(/security\.semgrep\.enabled must be true or false/);
  });

  it('throws on a non-boolean mcp value', () => {
    expect(() =>
      // @ts-expect-error — exercising runtime validation of bad input
      mergeConfigs({ security: { semgrep: { mcp: 'yes' } } }),
    ).toThrow(/security\.semgrep\.mcp must be true or false/);
  });

  it('throws on a non-boolean edit_hook value', () => {
    expect(() =>
      // @ts-expect-error — exercising runtime validation of bad input
      mergeConfigs({ security: { semgrep: { edit_hook: 1 } } }),
    ).toThrow(/security\.semgrep\.edit_hook must be true or false/);
  });

  it('throws when security is not a mapping', () => {
    // @ts-expect-error — exercising runtime validation of bad input
    expect(() => mergeConfigs({ security: [] })).toThrow(/security must be a mapping/);
  });

  it('ignores unknown keys under security.semgrep', () => {
    const { config } = mergeConfigs({
      // @ts-expect-error — exercising runtime validation of unknown keys
      security: { semgrep: { enabled: true, tier: 'platform' } },
    });
    expect(config.security.semgrep.enabled).toBe(true);
    expect(config.security.semgrep).not.toHaveProperty('tier');
  });

  it('reads the sast gate keys (PAN-4590)', () => {
    const { config } = mergeConfigs({
      security: { semgrep: { gate: 'blocking', severity: 'WARNING', configs: ['p/python', ' rules/ '], timeout_seconds: 60 } },
    });
    expect(config.security.semgrep).toMatchObject({
      gate: 'blocking',
      severity: 'WARNING',
      configs: ['p/python', 'rules/'],
      timeout_seconds: 60,
    });
  });

  it('a higher-priority layer overrides the gate mode without touching the rest', () => {
    const { config } = mergeConfigs(
      { security: { semgrep: { gate: 'off' } } },
      { security: { semgrep: { gate: 'blocking', configs: ['p/python'] } } },
    );
    expect(config.security.semgrep.gate).toBe('off');
    expect(config.security.semgrep.configs).toEqual(['p/python']);
  });

  it.each([
    [{ gate: 'strict' }, /security\.semgrep\.gate must be one of off, advisory, blocking/],
    [{ severity: 'HIGH' }, /security\.semgrep\.severity must be one of INFO, WARNING, ERROR/],
    [{ configs: [] }, /security\.semgrep\.configs must be a non-empty list/],
    [{ configs: ['--dangerous'] }, /security\.semgrep\.configs must be a non-empty list/],
    // PAN-4594: a leading-space entry must not pass the dash check on the raw value and then
    // trim into a leading dash the CLI would read as a flag.
    [{ configs: [' -bad'] }, /security\.semgrep\.configs must be a non-empty list/],
    [{ configs: 'p/default' }, /security\.semgrep\.configs must be a non-empty list/],
    [{ timeout_seconds: 0 }, /security\.semgrep\.timeout_seconds must be a positive whole number/],
    [{ timeout_seconds: '60' }, /security\.semgrep\.timeout_seconds must be a positive whole number/],
  ])('throws on a bad gate key %j', (semgrep, message) => {
    // @ts-expect-error — exercising runtime validation of bad input
    expect(() => mergeConfigs({ security: { semgrep } })).toThrow(message);
  });

  it('does not mutate DEFAULT_CONFIG across merges', () => {
    mergeConfigs({ security: { semgrep: { enabled: true } } });
    expect(DEFAULT_CONFIG.security.semgrep.enabled).toBe(false);

    const { config } = mergeConfigs(null);
    expect(config.security.semgrep.enabled).toBe(false);
  });
});
