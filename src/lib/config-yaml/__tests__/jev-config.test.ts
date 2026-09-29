import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../../config-yaml.js';
import { DEFAULT_NORMALIZED_JEV, normalizeJevConfig } from '../jev.js';

describe('config-yaml jev block (PAN-4369)', () => {
  it('defaults to an unconfigured block with the default key ref and timeout', () => {
    const { config } = mergeConfigs(null);
    expect(config.jev).toEqual({ configured: false, apiKeyRef: 'TYPESAFE_API_KEY', timeoutMs: 2000 });
  });

  it('merges a full jev block', () => {
    const { config } = mergeConfigs({
      jev: { model: 'm', base_url: 'https://opencode.ai/zen', timeout_ms: 1500 },
    });
    expect(config.jev).toEqual({
      configured: true,
      model: 'm',
      baseUrl: 'https://opencode.ai/zen',
      apiKeyRef: 'TYPESAFE_API_KEY',
      timeoutMs: 1500,
    });
  });

  it('marks an empty jev mapping as configured with no model', () => {
    const { config } = mergeConfigs({ jev: {} });
    expect(config.jev.configured).toBe(true);
    expect(config.jev.model).toBeUndefined();
  });

  it('normalizes a blank model to undefined and keeps a custom key ref', () => {
    const { config } = mergeConfigs({ jev: { model: '  ', api_key_ref: 'MY_JEV_KEY' } });
    expect(config.jev.model).toBeUndefined();
    expect(config.jev.apiKeyRef).toBe('MY_JEV_KEY');
  });

  it('throws on an out-of-range timeout_ms', () => {
    expect(() => mergeConfigs({ jev: { timeout_ms: 0 } })).toThrow(/jev.timeout_ms/);
    expect(() => mergeConfigs({ jev: { timeout_ms: 30_001 } })).toThrow(/jev.timeout_ms/);
  });

  it('throws on a non-string model', () => {
    // @ts-expect-error — exercising runtime validation of bad input
    expect(() => mergeConfigs({ jev: { model: 42 } })).toThrow(/jev.model must be a string/);
  });

  it('merges the api_keys.typesafe slot', () => {
    const { config } = mergeConfigs({ api_keys: { typesafe: 'k' } });
    expect(config.apiKeys.typesafe).toBe('k');
  });

  it('returns the current value unchanged for an absent block', () => {
    expect(normalizeJevConfig(null, DEFAULT_NORMALIZED_JEV)).toBe(DEFAULT_NORMALIZED_JEV);
    expect(normalizeJevConfig(undefined, DEFAULT_NORMALIZED_JEV)).toBe(DEFAULT_NORMALIZED_JEV);
  });
});
