import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeConfigs } from '../../../lib/config-yaml/merge.js';
import { ensureOllamaForUp } from '../up-ollama.js';

function configWith(model?: string) {
  return mergeConfigs(model ? { roles: { work: { model } } } : {}).config;
}

describe('ensureOllamaForUp', () => {
  let checkHealth: ReturnType<typeof vi.fn>;
  let ensureServe: ReturnType<typeof vi.fn>;
  let lines: string[];
  let log: (line: string) => void;

  beforeEach(() => {
    checkHealth = vi.fn(async () => ({
      endpointReachable: true,
      version: '0.19.0',
      versionSupported: true,
      modelPresent: true,
    }));
    ensureServe = vi.fn(async () => {});
    lines = [];
    log = (line: string) => { lines.push(line); };
  });

  it('makes no network call at all when no local model is configured', async () => {
    const result = await ensureOllamaForUp(configWith(), {
      checkHealth: checkHealth as never,
      ensureServe: ensureServe as never,
      log,
    });

    expect(result).toBe('not-configured');
    expect(checkHealth).not.toHaveBeenCalled();
    expect(ensureServe).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('leaves an already-reachable server alone', async () => {
    const result = await ensureOllamaForUp(configWith('ollama:gemma4:12b'), {
      checkHealth: checkHealth as never,
      ensureServe: ensureServe as never,
      log,
    });

    expect(result).toBe('running');
    expect(ensureServe).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('Ollama running at http://localhost:11434');
  });

  it('starts the server once, with knownUnhealthy, when nothing answers', async () => {
    checkHealth.mockResolvedValue({
      endpointReachable: false,
      versionSupported: false,
      modelPresent: false,
    });

    const result = await ensureOllamaForUp(configWith('ollama:gemma4:12b'), {
      checkHealth: checkHealth as never,
      ensureServe: ensureServe as never,
      log,
    });

    expect(result).toBe('started');
    expect(ensureServe).toHaveBeenCalledTimes(1);
    expect(ensureServe).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:11434',
      contextLength: 65_536,
      knownUnhealthy: true,
    });
  });

  it('warns and returns failed rather than throwing when the server will not start', async () => {
    checkHealth.mockResolvedValue({
      endpointReachable: false,
      versionSupported: false,
      modelPresent: false,
    });
    ensureServe.mockRejectedValue(new Error('did not become healthy within 30s'));

    const result = await ensureOllamaForUp(configWith('ollama:gemma4:12b'), {
      checkHealth: checkHealth as never,
      ensureServe: ensureServe as never,
      log,
    });

    expect(result).toBe('failed');
    expect(lines.join('\n')).toContain('did not become healthy within 30s');
    expect(lines.join('\n')).toContain('cloud models are unaffected');
  });
});
