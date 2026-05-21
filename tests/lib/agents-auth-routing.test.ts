import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadYamlConfig,
  mockGetProviderForModel,
  mockGetProviderEnv,
  mockOpenAIAuthStatus,
  mockBridgeGeminiAuth,
} = vi.hoisted(() => ({
  mockLoadYamlConfig: vi.fn(),
  mockGetProviderForModel: vi.fn(),
  mockGetProviderEnv: vi.fn(),
  mockOpenAIAuthStatus: vi.fn(),
  mockBridgeGeminiAuth: vi.fn(),
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
  bridgeGeminiAuthToCliproxyAsync: mockBridgeGeminiAuth,
  getCliproxyClientEnv: () => ({
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
    ANTHROPIC_AUTH_TOKEN: 'panopticon-local-cliproxy-key',
  }),
  startCliproxy: vi.fn(),
}));

import { getProviderEnvForModel, getAgentRuntimeBaseCommand, getProviderExportsForModel } from '../../src/lib/agents.js';

describe('agents auth routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: {},
        providerAuth: {},
        // Pin bypass so command-shape assertions remain explicit; Auto-mode
        // invariants are covered in permission-mode-leak.test.ts.
        claude: { permissionMode: 'bypass' },
      },
    });

    mockGetProviderForModel.mockImplementation((model: string) => {
      if (model.startsWith('gpt-') || model === 'o3' || model === 'o4-mini') {
        return { name: 'openai', displayName: 'OpenAI', compatibility: 'direct', authType: 'static' };
      }
      if (model.startsWith('minimax-')) {
        return { name: 'minimax', displayName: 'MiniMax', compatibility: 'direct', authType: 'static' };
      }
      if (model.startsWith('kimi-')) {
        return { name: 'kimi', displayName: 'Kimi', compatibility: 'direct', authType: 'static' };
      }
      if (model.startsWith('glm-')) {
        return { name: 'zai', displayName: 'Z.AI', compatibility: 'direct', authType: 'static' };
      }
      if (model.startsWith('gemini-')) {
        return { name: 'google', displayName: 'Google (Gemini)', compatibility: 'direct', authType: 'static' };
      }
      if (model.startsWith('mimo-')) {
        return { name: 'mimo', displayName: 'MiMo', compatibility: 'direct', authType: 'static' };
      }
      if (model.includes('/')) {
        return { name: 'openrouter', displayName: 'OpenRouter', compatibility: 'direct', authType: 'static' };
      }
      return { name: 'anthropic', displayName: 'Anthropic', compatibility: 'direct', authType: 'env' };
    });

    mockBridgeGeminiAuth.mockResolvedValue(true);
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

    // Subscription path bypasses provider-native env construction entirely
    // and instead injects ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN pointing
    // at the local CLIProxyAPI sidecar.
    expect(mockGetProviderEnv).not.toHaveBeenCalled();
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
      ANTHROPIC_AUTH_TOKEN: 'panopticon-local-cliproxy-key',
    });
  });

  it('rejects OpenAI API-key routing when no Codex subscription login exists', async () => {
    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: { openai: 'sk-test-123' },
        providerAuth: {},
      },
    });
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: false, hasOpenAIApiKey: true });

    await expect(getProviderEnvForModel('gpt-5.4')).rejects.toThrow(
      'OpenAI API-key routing is no longer supported'
    );
    expect(mockGetProviderEnv).not.toHaveBeenCalled();
  });

  it('uses bare GPT model IDs when launching through CLIProxy subscription auth', async () => {
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: true });

    expect(await getAgentRuntimeBaseCommand('gpt-5.4')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'gpt-5.4'"
    );
  });

  it('maps OpenAI -pro aliases to CLIProxy-supported model IDs', async () => {
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: true });

    expect(await getAgentRuntimeBaseCommand('gpt-5.5-pro')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'gpt-5.5'"
    );
  });

  it('bridges Gemini API keys into CLIProxy env instead of provider-native env', async () => {
    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: { google: 'google-test-key' },
        providerAuth: {},
      },
    });

    const env = await getProviderEnvForModel('gemini-3-flash-preview');

    expect(mockBridgeGeminiAuth).toHaveBeenCalledWith('google-test-key');
    expect(mockGetProviderEnv).not.toHaveBeenCalled();
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
      ANTHROPIC_AUTH_TOKEN: 'panopticon-local-cliproxy-key',
    });
  });

  it('launches Gemini models with Claude Code through CLIProxy-compatible direct routing', async () => {
    expect(await getAgentRuntimeBaseCommand('gemini-3-flash-preview')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'gemini-3-flash-preview'"
    );
  });

  it('launches MiniMax models directly with Claude Code', async () => {
    expect(await getAgentRuntimeBaseCommand('minimax-m2.7')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'minimax-m2.7'"
    );
  });

  it('launches Kimi models directly with Claude Code', async () => {
    expect(await getAgentRuntimeBaseCommand('kimi-k2.6')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'kimi-k2.6'"
    );
  });

  it('launches Z.AI models directly with Claude Code', async () => {
    expect(await getAgentRuntimeBaseCommand('glm-4.7')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'glm-4.7'"
    );
  });

  it('launches OpenRouter models directly with Claude Code and preserves slash model IDs', async () => {
    expect(await getAgentRuntimeBaseCommand('qwen/qwen3.6-plus:free')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'qwen/qwen3.6-plus:free'"
    );
  });

  it('launches Mimo models directly with Claude Code', async () => {
    expect(await getAgentRuntimeBaseCommand('mimo-v2.5')).toBe(
      "claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'mimo-v2.5'"
    );
  });

  it('keeps role agent definition and --name for direct Kimi launches', async () => {
    expect(await getAgentRuntimeBaseCommand('kimi-k2.6', 'agent-pan-964', 'roles/work.md')).toBe(
      "claude --dangerously-skip-permissions --agent roles/work.md --model 'kimi-k2.6' --name agent-pan-964"
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
        'unset ANTHROPIC_DEFAULT_OPUS_MODEL',
        'unset ANTHROPIC_DEFAULT_SONNET_MODEL',
        'unset ANTHROPIC_SMALL_FAST_MODEL',
        'unset CLAUDE_CODE_SUBAGENT_MODEL',
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
  });
});
