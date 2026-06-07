import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isOllamaInstalled: vi.fn(),
  checkOllamaEndpointReachable: vi.fn(),
  resolveOllamaBaseUrl: vi.fn(),
}));

vi.mock('../../../lib/ollama.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/ollama.js')>()),
  isOllamaInstalled: mocks.isOllamaInstalled,
  checkOllamaEndpointReachable: mocks.checkOllamaEndpointReachable,
  resolveOllamaBaseUrl: mocks.resolveOllamaBaseUrl,
}));

import { checkOllama } from '../doctor.js';

describe('doctor checkOllama', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOllamaBaseUrl.mockReturnValue('http://localhost:11434');
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
