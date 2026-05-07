import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadYamlConfig,
  mockGetProviderForModel,
  mockGetProviderEnv,
  mockOpenAIAuthStatus,
} = vi.hoisted(() => ({
  mockLoadYamlConfig: vi.fn(),
  mockGetProviderForModel: vi.fn(),
  mockGetProviderEnv: vi.fn(),
  mockOpenAIAuthStatus: vi.fn(),
}));

vi.mock('../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfig: mockLoadYamlConfig,
  };
});

vi.mock('../../src/lib/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/providers.js')>();
  return {
    ...actual,
    getProviderForModel: mockGetProviderForModel,
    getProviderEnv: mockGetProviderEnv,
  };
});

vi.mock('../../src/lib/openai-auth.js', () => ({
  getOpenAIAuthStatusSync: mockOpenAIAuthStatus,
  getOpenAIAuthStatus: (...args: unknown[]) => Promise.resolve(mockOpenAIAuthStatus(...args)),
}));

vi.mock('../../src/lib/cliproxy.js', () => ({
  getCliproxyClientEnv: () => ({
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
    ANTHROPIC_AUTH_TOKEN: 'panopticon-local-cliproxy-key',
  }),
  startCliproxy: vi.fn(),
}));

import { getClaudishPrefix, getProviderEnvForModel, getAgentRuntimeBaseCommand, getProviderExportsForModel } from '../../src/lib/agents.js';

describe('agents auth routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: {},
        providerAuth: {},
      },
    });

    mockGetProviderForModel.mockImplementation((model: string) => {
      if (model.startsWith('gpt-') || model === 'o3' || model === 'o4-mini') {
        return { name: 'openai', displayName: 'OpenAI', compatibility: 'claudish', authType: 'env' };
      }
      if (model.startsWith('minimax-')) {
        return { name: 'minimax', displayName: 'MiniMax', compatibility: 'claudish', authType: 'static' };
      }
      if (model.startsWith('kimi-')) {
        return { name: 'kimi', displayName: 'Kimi', compatibility: 'claudish', authType: 'static' };
      }
      if (model.startsWith('glm-')) {
        return { name: 'zai', displayName: 'Z.AI', compatibility: 'claudish', authType: 'static' };
      }
      if (model.startsWith('mimo-')) {
        return { name: 'mimo', displayName: 'MiMo', compatibility: 'claudish', authType: 'static' };
      }
      if (model.includes('/')) {
        return { name: 'openrouter', displayName: 'OpenRouter', compatibility: 'claudish', authType: 'static' };
      }
      return { name: 'anthropic', displayName: 'Anthropic', compatibility: 'direct', authType: 'env' };
    });

    mockGetProviderEnv.mockImplementation((_provider, authToken: string) => ({
      AUTH_TOKEN: authToken,
    }));
  });

  it('routes GPT models through the local cliproxy sidecar when Codex subscription login is active', async () => {
    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: { openai: 'sk-test-123' },
        providerAuth: {},
      },
    });
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: true });

    const env = await getProviderEnvForModel('gpt-5.4');

    // Subscription path bypasses claudish-backed getProviderEnv entirely and
    // instead injects ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN pointing at
    // the local CLIProxyAPI sidecar.
    expect(mockGetProviderEnv).not.toHaveBeenCalled();
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
      ANTHROPIC_AUTH_TOKEN: 'panopticon-local-cliproxy-key',
    });
  });

  it('falls back to the OpenAI API key when no Codex subscription login exists', async () => {
    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: { openai: 'sk-test-123' },
        providerAuth: {},
      },
    });
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: false });

    const env = await getProviderEnvForModel('gpt-5.4');

    expect(mockGetProviderEnv).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openai' }),
      'sk-test-123'
    );
    expect(env).toEqual({ AUTH_TOKEN: 'sk-test-123' });
  });

  it('uses cx@ prefix for GPT models routed through subscription auth', () => {
    expect(getClaudishPrefix('gpt-5.4', 'subscription')).toBe('cx@gpt-5.4');
  });

  it('launches MiniMax models through claudish with mm@ prefix', async () => {
    expect(await getAgentRuntimeBaseCommand('minimax-m2.7')).toBe(
      'claudish -i --model mm@minimax-m2.7 --dangerously-skip-permissions --permission-mode bypassPermissions'
    );
  });

  it('launches Kimi models through claudish with kc@ prefix', async () => {
    expect(await getAgentRuntimeBaseCommand('kimi-k2.6')).toBe(
      'claudish -i --model kc@kimi-k2.6 --dangerously-skip-permissions --permission-mode bypassPermissions'
    );
  });

  it('launches Z.AI models through claudish with zai@ prefix', async () => {
    expect(await getAgentRuntimeBaseCommand('glm-4.7')).toBe(
      'claudish -i --model zai@glm-4.7 --dangerously-skip-permissions --permission-mode bypassPermissions'
    );
  });

  it('launches OpenRouter models through claudish with or@ prefix', async () => {
    expect(await getAgentRuntimeBaseCommand('qwen/qwen3.6-plus:free')).toBe(
      'claudish -i --model or@qwen/qwen3.6-plus:free --dangerously-skip-permissions --permission-mode bypassPermissions'
    );
  });

  it('launches Mimo models through claudish custom URL', async () => {
    expect(await getAgentRuntimeBaseCommand('mimo-v2.5')).toBe(
      'claudish -i --model https://token-plan-sgp.xiaomimimo.com/anthropic/mimo-v2.5 --dangerously-skip-permissions --permission-mode bypassPermissions'
    );
  });

  it('omits --agent and --name for claudish (Commander.js rejects unknown flags)', async () => {
    expect(await getAgentRuntimeBaseCommand('kimi-k2.6', 'agent-pan-964', 'work')).toBe(
      'claudish -i --model kc@kimi-k2.6 --dangerously-skip-permissions --permission-mode bypassPermissions'
    );
  });

  it('clears stale provider env before exporting Anthropic settings', async () => {
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: false });

    expect(await getProviderExportsForModel('claude-sonnet-4-6')).toBe(
      [
        'unset ANTHROPIC_API_KEY',
        'unset ANTHROPIC_BASE_URL',
        'unset ANTHROPIC_AUTH_TOKEN',
        'unset ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'unset OPENAI_API_KEY',
        'unset GEMINI_API_KEY',
        'unset API_TIMEOUT_MS',
        'unset CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
        '',
      ].join('\n')
    );
  });

  it('replaces stale Anthropic routing env with cliproxy exports for GPT subscription launches', async () => {
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: true });

    const result = await getProviderExportsForModel('gpt-5.4');
    expect(result).toContain('unset ANTHROPIC_API_KEY');
    expect(result).toContain('export ANTHROPIC_BASE_URL="http://127.0.0.1:8317"');
    expect(result).toContain('export ANTHROPIC_AUTH_TOKEN="panopticon-local-cliproxy-key"');
    expect(result).toContain('export CLAUDE_PATH=');
  });
});
