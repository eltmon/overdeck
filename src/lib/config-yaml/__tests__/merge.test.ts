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

describe('Prime Agent config merge', () => {
  it('defaults the RPC startup timeout without selecting a model', () => {
    expect(mergeConfigs().config.primeAgent).toEqual({ rpcStartupTimeoutMs: 30_000 });
  });

  it('merges binary and startup timeout overrides', () => {
    const { config } = mergeConfigs({
      primeAgent: {
        binaryPath: '/opt/prime/bin/prime-agent',
        rpcStartupTimeoutMs: 45_000,
      },
    });

    expect(config.primeAgent).toEqual({
      binaryPath: '/opt/prime/bin/prime-agent',
      rpcStartupTimeoutMs: 45_000,
    });
  });

  it('rejects a non-positive RPC startup timeout', () => {
    expect(() => mergeConfigs({ primeAgent: { rpcStartupTimeoutMs: 0 } })).toThrow(
      'primeAgent.rpcStartupTimeoutMs must be a positive integer',
    );
  });
});
