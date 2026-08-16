import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({
  loadConfigSync: vi.fn(),
}));
const ollamaMock = vi.hoisted(() => ({
  ensureOllamaServeRunning: vi.fn(),
  checkOllamaHealth: vi.fn(),
}));

vi.mock('../config-yaml.js', () => ({
  loadConfigSync: configMock.loadConfigSync,
  resolveModel: vi.fn(),
}));

vi.mock('../ollama.js', () => ollamaMock);

import {
  buildSpawnEnvForModel,
  getProviderEnvForModel,
  getProviderExportsForModel,
} from '../agents/provider-env.js';
import { getProviderEnvSync, PROVIDERS } from '../providers.js';

describe('Ollama provider environment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.loadConfigSync.mockReturnValue({
      config: {
        apiKeys: {},
        providerBaseUrls: { ollama: 'http://127.0.0.1:22434' },
      },
    });
    ollamaMock.ensureOllamaServeRunning.mockResolvedValue(undefined);
    ollamaMock.checkOllamaHealth.mockResolvedValue({
      endpointReachable: true,
      modelPresent: true,
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
    expect(ollamaMock.ensureOllamaServeRunning).not.toHaveBeenCalled();
    expect(ollamaMock.checkOllamaHealth).toHaveBeenCalledWith(
      'ollama:gemma4:12b',
      'http://127.0.0.1:22434',
    );
  });

  it('surfaces a distinct endpoint error before returning spawn environment', async () => {
    ollamaMock.checkOllamaHealth.mockResolvedValueOnce({
      endpointReachable: false,
      modelPresent: false,
    });
    ollamaMock.ensureOllamaServeRunning.mockRejectedValueOnce(
      new Error('Ollama did not become reachable at http://127.0.0.1:22434 after starting `ollama serve`.'),
    );

    await expect(getProviderEnvForModel('ollama:gemma4:12b', 'ohmypi')).rejects.toThrow(
      'Ollama did not become reachable at http://127.0.0.1:22434 after starting `ollama serve`.',
    );
    expect(ollamaMock.checkOllamaHealth).toHaveBeenCalledOnce();
  });

  it('starts an unreachable endpoint and rechecks the model after startup', async () => {
    ollamaMock.checkOllamaHealth
      .mockResolvedValueOnce({ endpointReachable: false, modelPresent: false })
      .mockResolvedValueOnce({ endpointReachable: true, modelPresent: true });

    await getProviderEnvForModel('ollama:gemma4:12b', 'ohmypi');

    expect(ollamaMock.ensureOllamaServeRunning).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:22434',
      knownUnhealthy: true,
    });
    expect(ollamaMock.checkOllamaHealth).toHaveBeenCalledTimes(2);
  });

  it('surfaces the pull command when the requested model is absent', async () => {
    ollamaMock.checkOllamaHealth.mockResolvedValueOnce({
      endpointReachable: true,
      modelPresent: false,
      message: 'Ollama model gemma4:12b is not pulled. Run `ollama pull gemma4:12b`.',
    });

    await expect(getProviderEnvForModel('ollama:gemma4:12b', 'ohmypi')).rejects.toThrow(
      'Ollama model gemma4:12b is not pulled. Run `ollama pull gemma4:12b`.',
    );
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
