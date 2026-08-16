import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({
  loadConfigSync: vi.fn(),
}));

vi.mock('../config-yaml.js', () => ({
  loadConfigSync: configMock.loadConfigSync,
}));

import { provisionOhmypiProviderForModel } from '../ohmypi-models.js';

describe('Ollama Pi model registry provisioning', () => {
  beforeEach(() => {
    configMock.loadConfigSync.mockReturnValue({
      config: { providerBaseUrls: {} },
    });
  });

  it('registers the bare Ollama tag against the OpenAI-compatible endpoint env', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'overdeck-ollama-models-'));
    await provisionOhmypiProviderForModel('ollama:gemma4:12b', agentDir);

    const registry = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf8')) as {
      providers: Record<string, { baseUrl: string; apiKey: string; models: Array<{ id: string }> }>;
    };
    expect(registry.providers.ollama.baseUrl).toBe('http://localhost:11434/v1');
    expect(registry.providers.ollama.apiKey).toBe('OPENAI_API_KEY');
    expect(registry.providers.ollama.models).toEqual([
      expect.objectContaining({ id: 'gemma4:12b' }),
    ]);
  });
});
