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

describe('Ollama config merge', () => {
  it('defaults to the local endpoint and a 64K context window when the block is absent', () => {
    expect(mergeConfigs().config.ollama).toEqual({
      baseUrl: 'http://localhost:11434',
      contextLength: 65_536,
    });
  });

  it('overrides the default endpoint and strips a trailing slash', () => {
    const { config } = mergeConfigs({ ollama: { base_url: 'http://127.0.0.1:11500/' } });

    expect(config.ollama).toEqual({ baseUrl: 'http://127.0.0.1:11500', contextLength: 65_536 });
  });

  it('lets the higher-precedence layer override one field without dropping the other', () => {
    const { config } = mergeConfigs(
      { ollama: { context_length: 32_768 } },
      { ollama: { base_url: 'http://127.0.0.1:11500', context_length: 131_072 } },
    );

    expect(config.ollama).toEqual({ baseUrl: 'http://127.0.0.1:11500', contextLength: 32_768 });
  });

  it('refuses a non-localhost base URL at config load', () => {
    expect(() => mergeConfigs({ ollama: { base_url: 'https://ollama.example.com' } })).toThrow(
      /ollama\.base_url must be a localhost address/,
    );
  });

  it('refuses a context length that is not a usable integer', () => {
    expect(() => mergeConfigs({ ollama: { context_length: 1_024 } })).toThrow(/ollama\.context_length/);
    expect(() => mergeConfigs({ ollama: { context_length: 65_536.5 } })).toThrow(/ollama\.context_length/);
  });
});
