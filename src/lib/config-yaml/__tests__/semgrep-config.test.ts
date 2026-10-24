import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../../config-yaml.js';
import { DEFAULT_CONFIG } from '../defaults.js';

describe('config-yaml security.semgrep block (PAN-4585)', () => {
  it('defaults to disabled', () => {
    const { config } = mergeConfigs(null);
    expect(config.security.semgrep.enabled).toBe(false);
  });

  it('enables via a global layer', () => {
    const { config } = mergeConfigs({ security: { semgrep: { enabled: true } } });
    expect(config.security.semgrep.enabled).toBe(true);
  });

  it('throws on a non-boolean enabled value', () => {
    expect(() =>
      // @ts-expect-error — exercising runtime validation of bad input
      mergeConfigs({ security: { semgrep: { enabled: 'yes' } } }),
    ).toThrow(/security\.semgrep\.enabled must be true or false/);
  });

  it('throws when security is not a mapping', () => {
    // @ts-expect-error — exercising runtime validation of bad input
    expect(() => mergeConfigs({ security: [] })).toThrow(/security must be a mapping/);
  });

  it('ignores unknown keys under security.semgrep', () => {
    const { config } = mergeConfigs({
      // @ts-expect-error — exercising runtime validation of unknown keys
      security: { semgrep: { enabled: true, gate: 'blocking', tier: 'platform' } },
    });
    expect(config.security.semgrep).toEqual({ enabled: true });
  });

  it('does not mutate DEFAULT_CONFIG across merges', () => {
    mergeConfigs({ security: { semgrep: { enabled: true } } });
    expect(DEFAULT_CONFIG.security.semgrep.enabled).toBe(false);

    const { config } = mergeConfigs(null);
    expect(config.security.semgrep.enabled).toBe(false);
  });
});
