import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { primeAgentAuthFilePath } from '../../runtimes/storage/prime-agent.js';
import {
  PrimeAgentCredentialError,
  PrimeAgentProviderMappingError,
  resolvePrimeAgentCredential,
  type PrimeAgentCredentialDeps,
} from '../provider-map.js';

describe('resolvePrimeAgentCredential (PAN-3668 WI-8, D12)', () => {
  let home: string;
  let authFile: string;

  const deps = (overrides: Partial<PrimeAgentCredentialDeps> = {}): PrimeAgentCredentialDeps => ({
    authFile,
    env: {},
    loadApiKeys: async () => ({}),
    ...overrides,
  });

  const writeAuth = (keys: Record<string, unknown>) => writeFile(authFile, JSON.stringify(keys));

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'prime-home-'));
    authFile = primeAgentAuthFilePath(home);
    await mkdir(join(home, '.prime', 'agent'), { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('keeps auth.json under the given HOME', () => {
    expect(authFile).toBe(join(home, '.prime', 'agent', 'auth.json'));
  });

  it('allows a launch when auth.json holds the Prime provider key and no env var is set', async () => {
    await writeAuth({ 'kimi-coding': { type: 'api_key', key: 'secret-kimi' } });
    await expect(resolvePrimeAgentCredential('k3', 'api-key', deps())).resolves.toEqual({ provider: 'kimi-coding', envExports: {} });
  });

  it('passes an env-var credential through envExports, because agent panes blank provider keys', async () => {
    await expect(resolvePrimeAgentCredential('gpt-5.4', 'api-key', deps({ env: { OPENAI_API_KEY: 'sk-env' } })))
      .resolves.toEqual({ provider: 'openai', envExports: { OPENAI_API_KEY: 'sk-env' } });
  });

  it('exports an Overdeck settings key under Prime env var name when no other source holds one', async () => {
    const result = await resolvePrimeAgentCredential('k3', 'api-key', deps({ loadApiKeys: async () => ({ kimi: 'sk-kimi-settings' }) }));
    expect(result).toEqual({ provider: 'kimi-coding', envExports: { KIMI_API_KEY: 'sk-kimi-settings' } });

    await writeAuth({ 'kimi-coding': { type: 'api_key' } });
    const preferAuthFile = await resolvePrimeAgentCredential('k3', 'api-key', deps({ loadApiKeys: async () => ({ kimi: 'sk-kimi-settings' }) }));
    expect(preferAuthFile.envExports).toEqual({});
  });

  it('names all three sources when no credential is set, without leaking values', async () => {
    await writeAuth({ openrouter: { type: 'api_key', key: 'secret-openrouter' } });
    const error = await resolvePrimeAgentCredential('k3', undefined, deps()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrimeAgentCredentialError);
    const message = (error as Error).message;
    expect(message).toContain('"kimi-coding"');
    expect(message).toContain(authFile);
    expect(message).toContain('KIMI_API_KEY');
    expect(message).toContain('/login');
    expect(message).toContain('Overdeck Settings');
    expect(message).not.toContain('secret-openrouter');
  });

  it('refuses an unmapped provider with no fallback model', async () => {
    const error = await resolvePrimeAgentCredential('qwen/qwen3.6-plus', 'api-key', deps()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrimeAgentProviderMappingError);
    expect((error as Error).message).toContain('"nous"');
    expect((error as Error).message).toContain('No fallback model was selected');
  });

  it('routes openai subscription to openai-codex only when auth.json holds that sign-in', async () => {
    const missing = await resolvePrimeAgentCredential('gpt-5.5', 'subscription', deps({ env: { OPENAI_API_KEY: 'sk-env' } }))
      .catch((caught: unknown) => caught);
    expect(missing).toBeInstanceOf(PrimeAgentCredentialError);
    expect((missing as Error).message).toContain('"openai-codex"');
    expect((missing as Error).message).toContain('/login');

    await writeAuth({ 'openai-codex': { type: 'oauth' } });
    await expect(resolvePrimeAgentCredential('gpt-5.5', 'subscription', deps()))
      .resolves.toEqual({ provider: 'openai-codex', envExports: {} });
  });

  it('refuses subscription auth for a provider with no Prime subscription route', async () => {
    await expect(resolvePrimeAgentCredential('gemini-2.5-pro', 'subscription', deps()))
      .rejects.toBeInstanceOf(PrimeAgentProviderMappingError);
  });

  it('treats a malformed auth.json as holding no keys', async () => {
    await writeFile(authFile, '{not json');
    await expect(resolvePrimeAgentCredential('k3', 'api-key', deps())).rejects.toBeInstanceOf(PrimeAgentCredentialError);
  });
});
