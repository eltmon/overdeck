import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../defaults.js';
import { stripProjectSecurity } from '../load.js';
import { mergeConfigs } from '../merge.js';
import type { YamlConfig } from '../schema.js';

describe('harnesses.auto_update config (PAN-5108)', () => {
  it('defaults to true when no harnesses block is present', () => {
    expect(mergeConfigs({}).config.harnesses).toEqual({ autoUpdate: true });
    expect(mergeConfigs(null).config.harnesses.autoUpdate).toBe(true);
  });

  it('reads auto_update: false', () => {
    expect(mergeConfigs({ harnesses: { auto_update: false } }).config.harnesses.autoUpdate).toBe(false);
  });

  it('lets the higher-priority (first) layer win', () => {
    const { config } = mergeConfigs({ harnesses: { auto_update: true } }, { harnesses: { auto_update: false } });
    expect(config.harnesses.autoUpdate).toBe(true);
  });

  it('ignores a non-boolean value and keeps the default', () => {
    const yaml = { harnesses: { auto_update: 'no' } } as unknown as YamlConfig;
    expect(mergeConfigs(yaml).config.harnesses.autoUpdate).toBe(true);
  });

  it('does not mutate DEFAULT_CONFIG when merging false', () => {
    mergeConfigs({ harnesses: { auto_update: false } });
    expect(DEFAULT_CONFIG.harnesses.autoUpdate).toBe(true);
  });

  it('strips harnesses from a project config', () => {
    const stripped = stripProjectSecurity({ harnesses: { auto_update: false } });
    expect(stripped).not.toBeNull();
    expect(stripped).not.toHaveProperty('harnesses');
  });
});
