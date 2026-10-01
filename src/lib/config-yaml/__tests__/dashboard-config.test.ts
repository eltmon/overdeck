import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../merge.js';

describe('dashboard.require_token_mint config', () => {
  it('normalizes require_token_mint: true', () => {
    const { config } = mergeConfigs({ dashboard: { require_token_mint: true } });
    expect(config.dashboard).toEqual({ requireTokenMint: true });
  });

  it('treats a non-boolean truthy value as false without throwing', () => {
    expect(() =>
      mergeConfigs({ dashboard: { require_token_mint: 'yes' as unknown as boolean } }),
    ).not.toThrow();
    expect(
      mergeConfigs({ dashboard: { require_token_mint: 'yes' as unknown as boolean } }).config
        .dashboard,
    ).toEqual({ requireTokenMint: false });
    expect(
      mergeConfigs({ dashboard: { require_token_mint: 1 as unknown as boolean } }).config
        .dashboard,
    ).toEqual({ requireTokenMint: false });
  });

  it('leaves dashboard undefined when no config sets it', () => {
    const { config } = mergeConfigs({});
    expect(config.dashboard).toBeUndefined();
  });

  it('lets the global config win over a project override', () => {
    const { config } = mergeConfigs(
      { dashboard: { require_token_mint: true } },
      { dashboard: { require_token_mint: false } },
    );
    expect(config.dashboard).toEqual({ requireTokenMint: false });
  });
});
