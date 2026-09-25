import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeConfigs } from '../../../lib/config-yaml/merge.js';
import { checkOllama } from '../doctor-ollama.js';

const HEALTHY = {
  endpointReachable: true,
  version: '0.19.0',
  versionSupported: true,
  modelPresent: true,
};

function configWith(model?: string) {
  return mergeConfigs(model ? { roles: { work: { model } } } : {}).config;
}

/** /api/ps double; anything that is not /api/ps is an unexpected call. */
function psFetch(models: Array<{ name: string; context_length: number }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith('/api/ps')) throw new Error(`unexpected fetch ${url}`);
    return { ok: true, status: 200, json: async () => ({ models }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('checkOllama', () => {
  let checkHealth: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    checkHealth = vi.fn(async () => HEALTHY);
  });

  it('stays silent on a host with no local model and no Ollama', async () => {
    const checks = await checkOllama({
      config: configWith(),
      detectInstalled: async () => false,
      checkHealth: checkHealth as never,
    });

    expect(checks).toEqual([]);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('warns with install guidance when a local model is configured but Ollama is missing', async () => {
    const checks = await checkOllama({
      config: configWith('ollama:gemma4:12b'),
      detectInstalled: async () => false,
      checkHealth: checkHealth as never,
    });

    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('warn');
    expect(checks[0].message).toContain('ollama:gemma4:12b');
    expect(checks[0].fix).toMatch(/ollama/i);
  });

  it('warns to start the server when it is installed but unreachable', async () => {
    checkHealth.mockResolvedValue({
      endpointReachable: false,
      versionSupported: false,
      modelPresent: false,
    });

    const checks = await checkOllama({
      config: configWith('ollama:gemma4:12b'),
      detectInstalled: async () => true,
      checkHealth: checkHealth as never,
    });

    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('warn');
    expect(checks[0].fix).toContain('ollama serve');
  });

  it('fails on a server too old to serve the Anthropic Messages API', async () => {
    checkHealth.mockResolvedValue({
      endpointReachable: true,
      version: '0.13.5',
      versionSupported: false,
      modelPresent: true,
    });

    const checks = await checkOllama({
      config: configWith('ollama:gemma4:12b'),
      detectInstalled: async () => true,
      checkHealth: checkHealth as never,
    });

    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('error');
    expect(checks[0].fix).toContain('0.14.0');
  });

  it('reports ok with version and base URL when everything is in place', async () => {
    const checks = await checkOllama({
      config: configWith('ollama:gemma4:12b'),
      detectInstalled: async () => true,
      checkHealth: checkHealth as never,
      fetchImpl: psFetch([{ name: 'gemma4:12b', context_length: 65_536 }]),
    });

    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('ok');
    expect(checks[0].message).toContain('0.19.0');
    expect(checks[0].message).toContain('http://localhost:11434');
  });

  it('warns per configured tag that is not pulled', async () => {
    checkHealth.mockResolvedValue({ ...HEALTHY, modelPresent: false });

    const checks = await checkOllama({
      config: configWith('ollama:gemma4:12b'),
      detectInstalled: async () => true,
      checkHealth: checkHealth as never,
      fetchImpl: psFetch([]),
    });

    expect(checks.map((c) => c.status)).toEqual(['ok', 'warn']);
    expect(checks[1].fix).toBe('Run: ollama pull gemma4:12b');
  });

  it('warns when a resident model has a window too small for a first prompt', async () => {
    const checks = await checkOllama({
      config: configWith('ollama:gemma4:12b'),
      detectInstalled: async () => true,
      checkHealth: checkHealth as never,
      fetchImpl: psFetch([{ name: 'gemma4:12b', context_length: 8_192 }]),
    });

    expect(checks.map((c) => c.status)).toEqual(['ok', 'warn']);
    expect(checks[1].message).toContain('8192');
    expect(checks[1].fix).toContain('OLLAMA_CONTEXT_LENGTH=65536');
  });

  it('never warm-loads a model: it only reads /api/ps', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return { ok: true, status: 200, json: async () => ({ models: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await checkOllama({
      config: configWith('ollama:gemma4:12b'),
      detectInstalled: async () => true,
      checkHealth: checkHealth as never,
      fetchImpl,
    });

    expect(seen).toEqual(['http://localhost:11434/api/ps']);
  });
});
