import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { provisionOhmypiProviderForModel } from '../../src/lib/ohmypi-models.js';

describe('provisionOhmypiProviderForModel', () => {
  let agentDir: string;
  const registryPath = () => join(agentDir, 'models.json');
  const readRegistry = () => JSON.parse(readFileSync(registryPath(), 'utf8'));

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), 'omp-models-test-'));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    delete process.env.DASHSCOPE_BASE_URL;
  });

  it('provisions the dashscope provider for a bare dashscope model id', () => {
    provisionOhmypiProviderForModel('qwen3.8-max', agentDir);
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

  it('accepts a provider-qualified id (conversations pre-qualify models)', () => {
    provisionOhmypiProviderForModel('dashscope/qwen3.8-max', agentDir);
    expect(readRegistry().providers.dashscope).toBeDefined();
  });

  it('honors the DASHSCOPE_BASE_URL region override', () => {
    process.env.DASHSCOPE_BASE_URL = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1';
    provisionOhmypiProviderForModel('qwen3.8-max', agentDir);
    expect(readRegistry().providers.dashscope.baseUrl).toBe('https://dashscope-us.aliyuncs.com/compatible-mode/v1');
  });

  it('is a no-op for providers the bundled omp catalog covers', () => {
    provisionOhmypiProviderForModel('claude-sonnet-5', agentDir);
    expect(existsSync(registryPath())).toBe(false);
  });

  it('preserves existing user providers when merging', () => {
    writeFileSync(registryPath(), JSON.stringify({ providers: { 'my-local': { baseUrl: 'http://localhost:1234/v1' } } }));
    provisionOhmypiProviderForModel('qwen3.8-max', agentDir);
    const registry = readRegistry();
    expect(registry.providers['my-local'].baseUrl).toBe('http://localhost:1234/v1');
    expect(registry.providers.dashscope).toBeDefined();
  });

  it('throws rather than overwrite an unparseable existing registry', () => {
    writeFileSync(registryPath(), 'not json{');
    expect(() => provisionOhmypiProviderForModel('qwen3.8-max', agentDir)).toThrow(/not valid JSON/);
    expect(readFileSync(registryPath(), 'utf8')).toBe('not json{');
  });
});
