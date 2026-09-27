import { describe, expect, it } from 'vitest';

import { PROVIDERS } from '../../providers.js';
import { mergeConfigs } from '../merge.js';

describe('ACP config merge', () => {
  it('defaults permission mode to auto when the ACP block is absent', () => {
    expect(mergeConfigs().config.acp).toEqual({ permissionMode: 'auto' });
  });

  it('merges Kimi binary overrides without dropping ACP defaults', () => {
    const { config } = mergeConfigs({
      acp: {
        kimi: {
          binaryPath: '/opt/kimi/bin/kimi',
        },
      },
    });

    expect(config.acp).toEqual({
      permissionMode: 'auto',
      kimi: {
        binaryPath: '/opt/kimi/bin/kimi',
      },
    });
  });

  it('accepts ACP as Kimi provider harness without changing the built-in default', () => {
    const { config } = mergeConfigs({
      models: {
        providers: {
          kimi: {
            enabled: true,
            harness: 'acp',
          },
        },
      },
      acp: {
        permissionMode: 'auto',
      },
    });

    expect(config.providerHarnesses.kimi).toBe('acp');
    expect(config.acp.permissionMode).toBe('auto');
    expect(PROVIDERS.kimi.defaultHarness).toBe('kimi-code');
  });
});

describe('context config merge', () => {
  it('defaults auto-sync to on', () => {
    expect(mergeConfigs().config.context.autoSync).toBe(true);
  });

  it('honors auto_sync: false', () => {
    expect(mergeConfigs({ context: { auto_sync: false } }).config.context.autoSync).toBe(false);
  });

  it('keeps rules and auto_sync from the same config', () => {
    const { config } = mergeConfigs({ context: { auto_sync: false, rules: { 'ste-writing': false } } });

    expect(config.context).toEqual({ rules: { 'ste-writing': false }, autoSync: false });
  });

  it('keeps an earlier auto_sync: false when a later config sets only rules', () => {
    const { config } = mergeConfigs(
      { context: { rules: { 'ste-writing': false } } },
      { context: { auto_sync: false } },
    );

    expect(config.context).toEqual({ rules: { 'ste-writing': false }, autoSync: false });
  });
});
