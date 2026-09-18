import { beforeEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({ apiKey: 'sk-kimi-test' }));

vi.mock('../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: (...args: Parameters<typeof actual.loadConfigSync>) => {
      const result = actual.loadConfigSync(...args);
      return { ...result, config: { ...result.config, apiKeys: { ...result.config.apiKeys, kimi: routing.apiKey } } };
    },
  };
});

import { getAgentRuntimeBaseCommand, getRoleRuntimeBaseCommand } from '../agents/runtime-command.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { KIMI_CODING_BASE_URL, KIMI_PLATFORM_BASE_URL, PROVIDERS, getProviderEnvSync, resolveKimiModelForEndpoint } from '../providers.js';

describe('Claude Code K2.7 endpoint routing', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TEST_HARNESS_COMMAND;
  });

  it.each([
    ['sk-kimi-test', 'kimi-for-coding', KIMI_CODING_BASE_URL],
    ['sk-platform-test', 'kimi-k2.7-code', KIMI_PLATFORM_BASE_URL],
  ])('uses the correct main and tier IDs for %s', async (apiKey, wireModel, endpoint) => {
    routing.apiKey = apiKey;
    const env = getProviderEnvSync(PROVIDERS.kimi, apiKey, 'claude-code');
    expect(env.ANTHROPIC_BASE_URL).toBe(endpoint);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(endpoint === KIMI_CODING_BASE_URL ? 'k3-256k' : 'k3');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('k3[1m]');
    for (const key of ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
      expect(env[key]).toBe(wireModel);
    }
    const baseCommand = await getAgentRuntimeBaseCommand('kimi-k2.7-code');
    expect(baseCommand).toContain(`--model '${wireModel}'`);
    const roleCommand = await getRoleRuntimeBaseCommand('kimi-k2.7-code', 'agent-test', 'review', 'claude-code', 'supervisor');
    expect(roleCommand).toContain(`--model '${wireModel}'`);
    for (const spawnMode of [undefined, 'conversation'] as const) {
      const script = generateLauncherScriptSync({
        role: 'work', workingDir: '/workspace', harness: 'claude-code',
        model: 'kimi-k2.7-code', baseCommand, spawnMode,
      });
      const launchedIds = [...script.matchAll(/--model '([^']+)'/g)].map((match) => match[1]);
      expect(launchedIds.length).toBeGreaterThan(0);
      expect(launchedIds.every((model) => model === wireModel)).toBe(true);
    }
  });

  it('does not translate other model IDs or unrelated endpoints', () => {
    expect(resolveKimiModelForEndpoint('kimi-k2.7-code', `${KIMI_CODING_BASE_URL}/`)).toBe('kimi-for-coding');
    expect(resolveKimiModelForEndpoint('kimi-k2.7-code', 'https://another.example/coding')).toBe('kimi-k2.7-code');
    expect(resolveKimiModelForEndpoint('kimi-for-coding', KIMI_CODING_BASE_URL)).toBe('kimi-for-coding');
  });

  it('keeps non-Claude harness IDs in their own catalog', async () => {
    routing.apiKey = 'sk-kimi-test';
    expect(await getAgentRuntimeBaseCommand('kimi-k2.7-code', undefined, undefined, 'ohmypi'))
      .toContain("--model 'kimi-k2.7-code'");
    const script = generateLauncherScriptSync({
      role: 'work', workingDir: '/workspace', harness: 'kimi-code',
      kimiCodeModel: 'kimi-k2.7-code',
    });
    expect(script).toContain("kimi -m 'kimi-code/kimi-for-coding'");
  });
});
