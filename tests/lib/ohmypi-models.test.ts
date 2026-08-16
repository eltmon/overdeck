import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

import { provisionOhmypiProviderForModel } from '../../src/lib/ohmypi-models.js';
import { writeFile as writeFileAsync } from 'node:fs/promises';

describe('provisionOhmypiProviderForModel', () => {
  let agentDir: string;
  const registryPath = () => join(agentDir, 'models.json');
  const readRegistry = () => JSON.parse(readFileSync(registryPath(), 'utf8'));

  beforeEach(() => {
    vi.mocked(writeFileAsync).mockClear();
    agentDir = mkdtempSync(join(tmpdir(), 'omp-models-test-'));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    delete process.env.DASHSCOPE_BASE_URL;
  });

  it('provisions the dashscope provider for a bare dashscope model id', async () => {
    await provisionOhmypiProviderForModel('qwen3.8-max', agentDir);
    const registry = readRegistry();
    const dashscope = registry.providers.dashscope;
    expect(dashscope.api).toBe('openai-completions');
    expect(dashscope.baseUrl).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    // Env-var name, never key material — omp resolves it from the launcher env.
    expect(dashscope.apiKey).toBe('DASHSCOPE_API_KEY');
    const ids = dashscope.models.map((m: { id: string }) => m.id);
    expect(ids).toContain('qwen3.8-max');
    expect(ids).toContain('qwen3.7-max');
  });

  it('accepts a provider-qualified id (conversations pre-qualify models)', async () => {
    await provisionOhmypiProviderForModel('dashscope/qwen3.8-max', agentDir);
    expect(readRegistry().providers.dashscope).toBeDefined();
  });

  it('honors the DASHSCOPE_BASE_URL region override', async () => {
    process.env.DASHSCOPE_BASE_URL = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1';
    await provisionOhmypiProviderForModel('qwen3.8-max', agentDir);
    expect(readRegistry().providers.dashscope.baseUrl).toBe('https://dashscope-us.aliyuncs.com/compatible-mode/v1');
  });

  it('is a no-op for providers the bundled omp catalog covers', async () => {
    await provisionOhmypiProviderForModel('claude-sonnet-5', agentDir);
    expect(existsSync(registryPath())).toBe(false);
  });

  it('preserves existing user providers when merging', async () => {
    writeFileSync(registryPath(), JSON.stringify({ providers: { 'my-local': { baseUrl: 'http://localhost:1234/v1' } } }));
    await provisionOhmypiProviderForModel('qwen3.8-max', agentDir);
    const registry = readRegistry();
    expect(registry.providers['my-local'].baseUrl).toBe('http://localhost:1234/v1');
    expect(registry.providers.dashscope).toBeDefined();
  });

  it('throws rather than overwrite an unparseable existing registry', async () => {
    writeFileSync(registryPath(), 'not json{');
    await expect(provisionOhmypiProviderForModel('qwen3.8-max', agentDir)).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(registryPath(), 'utf8')).toBe('not json{');
  });

  it('skips all writes when the provider entry is unchanged', async () => {
    await provisionOhmypiProviderForModel('qwen3.8-max', agentDir);
    vi.mocked(writeFileAsync).mockClear();

    await provisionOhmypiProviderForModel('qwen3.8-max', agentDir);

    expect(writeFileAsync).not.toHaveBeenCalled();
  });

  it('serializes concurrent updates to one registry without losing either provider', async () => {
    await Promise.all([
      provisionOhmypiProviderForModel('qwen3.8-max', agentDir),
      provisionOhmypiProviderForModel('ollama:gemma4:12b', agentDir),
    ]);

    const providers = readRegistry().providers;
    expect(providers.dashscope).toBeDefined();
    expect(providers.ollama).toBeDefined();
  });
});
