import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isOllamaInstalled: vi.fn(),
  checkOllamaEndpointReachable: vi.fn(),
  loadConfigSync: vi.fn(),
}));

vi.mock('../../../lib/ollama.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/ollama.js')>()),
  isOllamaInstalled: mocks.isOllamaInstalled,
  checkOllamaEndpointReachable: mocks.checkOllamaEndpointReachable,
}));

vi.mock('../../../lib/config-yaml.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config-yaml.js')>()),
  loadConfigSync: mocks.loadConfigSync,
}));

import { checkOllama } from '../doctor.js';

describe('doctor checkOllama', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigSync.mockReturnValue({
      config: {
        providerBaseUrls: { ollama: 'http://localhost:11434' },
      },
    });
  });

  it('reports ok when Ollama is installed and reachable', async () => {
    mocks.isOllamaInstalled.mockResolvedValue(true);
    mocks.checkOllamaEndpointReachable.mockResolvedValue(true);

    const results = await checkOllama();

    expect(results).toEqual([
      {
        name: 'Ollama',
        status: 'ok',
        message: 'Installed and reachable at http://localhost:11434',
      },
    ]);
  });

  it('reports installed-but-down with an actionable serve command', async () => {
    mocks.isOllamaInstalled.mockResolvedValue(true);
    mocks.checkOllamaEndpointReachable.mockResolvedValue(false);

    const results = await checkOllama();

    expect(results[0]).toMatchObject({
      name: 'Ollama',
      status: 'warn',
      message: 'Installed but endpoint is not reachable at http://localhost:11434',
    });
    expect(results[0].fix).toContain('ollama serve');
  });

  it('checks the configured Ollama base URL', async () => {
    mocks.loadConfigSync.mockReturnValue({
      config: {
        providerBaseUrls: { ollama: 'http://127.0.0.1:11435' },
      },
    });
    mocks.isOllamaInstalled.mockResolvedValue(true);
    mocks.checkOllamaEndpointReachable.mockResolvedValue(true);

    const results = await checkOllama();

    expect(mocks.checkOllamaEndpointReachable).toHaveBeenCalledWith('http://127.0.0.1:11435');
    expect(results[0]).toMatchObject({
      status: 'ok',
      message: 'Installed and reachable at http://127.0.0.1:11435',
    });
  });

  it('reports missing Ollama as advisory with install guidance', async () => {
    mocks.isOllamaInstalled.mockResolvedValue(false);

    const results = await checkOllama();

    expect(results[0]).toMatchObject({
      name: 'Ollama',
      status: 'warn',
      message: 'Not installed (optional local model sidecar)',
    });
    expect(results[0].fix).toContain('ollama.com/install.sh');
    expect(results[0].fix).toContain('brew install --cask ollama');
    expect(mocks.checkOllamaEndpointReachable).not.toHaveBeenCalled();
  });
});
