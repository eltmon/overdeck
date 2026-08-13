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
  it('defaults the Ollama base URL to localhost', () => {
    expect(mergeConfigs().config.providerBaseUrls.ollama).toBe('http://localhost:11434');
  });

  it('normalizes boolean and object provider forms without requiring an API key', () => {
    const booleanConfig = mergeConfigs({ models: { providers: { ollama: true } } }).config;
    expect(booleanConfig.enabledProviders.has('ollama')).toBe(true);
    expect(booleanConfig.providerBaseUrls.ollama).toBe('http://localhost:11434');

    const objectConfig = mergeConfigs({
      models: { providers: { ollama: { enabled: true, base_url: 'http://127.0.0.1:22434/' } } },
    }).config;
    expect(objectConfig.enabledProviders.has('ollama')).toBe(true);
    expect(objectConfig.providerBaseUrls.ollama).toBe('http://127.0.0.1:22434');
  });

  it('rejects a remote Ollama base URL', () => {
    expect(() => mergeConfigs({
      models: { providers: { ollama: { enabled: true, base_url: 'https://ollama.example.com' } } },
    })).toThrow('Ollama baseUrl must be a localhost address');
  });

  it('preserves an inherited Ollama endpoint when a higher layer configures another provider', () => {
    const { config } = mergeConfigs(
      { models: { providers: { openai: { enabled: true } } } },
      { models: { providers: { ollama: { enabled: true, base_url: 'http://127.0.0.1:22434' } } } },
    );

    expect(config.providerBaseUrls.ollama).toBe('http://127.0.0.1:22434');
    expect(config.enabledProviders.has('ollama')).toBe(true);
  });
});
