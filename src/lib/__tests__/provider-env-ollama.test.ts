import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({
  loadConfigSync: vi.fn(),
}));

vi.mock('../config-yaml.js', () => ({
  loadConfigSync: configMock.loadConfigSync,
  resolveModel: vi.fn(),
}));

import {
  buildSpawnEnvForModel,
  getProviderEnvForModel,
  getProviderExportsForModel,
} from '../agents/provider-env.js';
import { getProviderEnvSync, PROVIDERS } from '../providers.js';

describe('Ollama provider environment', () => {
  beforeEach(() => {
    configMock.loadConfigSync.mockReturnValue({
      config: {
        apiKeys: {},
        providerBaseUrls: { ollama: 'http://127.0.0.1:22434' },
      },
    });
  });

  it('uses only OpenAI-compatible environment variables', async () => {
    await expect(getProviderEnvForModel('ollama:gemma4:12b', 'ohmypi')).resolves.toEqual({
      OPENAI_BASE_URL: 'http://127.0.0.1:22434/v1',
      OPENAI_API_KEY: 'ollama',
    });
    expect(getProviderEnvSync(PROVIDERS.ollama, '')).toEqual({
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_API_KEY: 'ollama',
    });
  });

  it('unsets stale endpoint variables before exporting the Ollama endpoint', async () => {
    const exports = await getProviderExportsForModel('ollama:gemma4:12b', 'ohmypi');
    expect(exports).toContain('unset OPENAI_BASE_URL');
    expect(exports).toContain('export OPENAI_BASE_URL="http://127.0.0.1:22434/v1"');
    expect(exports).not.toContain('export ANTHROPIC_BASE_URL=');
    expect(exports).not.toContain('export ANTHROPIC_AUTH_TOKEN=');
  });

  it('strips a stale endpoint from programmatic spawn environments', async () => {
    await expect(buildSpawnEnvForModel('ollama:gemma4:12b', {
      PATH: '/bin',
      OPENAI_BASE_URL: 'https://stale.example.com/v1',
      ANTHROPIC_BASE_URL: 'https://stale.example.com',
    })).resolves.toEqual({
      PATH: '/bin',
      OPENAI_BASE_URL: 'http://127.0.0.1:22434/v1',
      OPENAI_API_KEY: 'ollama',
    });
  });
});
