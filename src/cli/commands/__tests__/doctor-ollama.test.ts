import { describe, expect, it } from 'vitest';

import { checkOllama } from '../doctor.js';

describe('pan doctor Ollama check', () => {
  it('reports absent Ollama as advisory', async () => {
    await expect(checkOllama({ detectInstalled: async () => false })).resolves.toEqual([{
      name: 'Ollama',
      status: 'warn',
      message: 'Not installed (optional local-model sidecar)',
      fix: 'Install from https://ollama.com/download',
    }]);
  });

  it('reports an installed but unreachable endpoint with a serve command', async () => {
    await expect(checkOllama({
      baseUrl: 'http://127.0.0.1:22434',
      detectInstalled: async () => true,
      checkHealth: async () => ({ endpointReachable: false, modelPresent: false }),
    })).resolves.toEqual([{
      name: 'Ollama',
      status: 'warn',
      message: 'Installed but endpoint is unreachable at http://127.0.0.1:22434',
      fix: 'Start it with `ollama serve`',
    }]);
  });

  it('reports an installed and reachable endpoint as healthy', async () => {
    await expect(checkOllama({
      detectInstalled: async () => true,
      checkHealth: async () => ({ endpointReachable: true, modelPresent: false }),
    })).resolves.toEqual([{
      name: 'Ollama',
      status: 'ok',
      message: 'Installed and reachable at http://localhost:11434',
    }]);
  });
});
