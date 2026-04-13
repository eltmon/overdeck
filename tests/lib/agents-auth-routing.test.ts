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
}));

vi.mock('../../src/lib/cliproxy.js', () => ({
  getCliproxyClientEnv: () => ({
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
    ANTHROPIC_AUTH_TOKEN: 'panopticon-local-cliproxy-key',
  }),
  startCliproxy: vi.fn(),
}));

import { getClaudishPrefix, getProviderEnvForModel, getAgentRuntimeBaseCommand } from '../../src/lib/agents.js';

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
        return { name: 'minimax', displayName: 'MiniMax', compatibility: 'direct', authType: 'static' };
      }
      return { name: 'anthropic', displayName: 'Anthropic', compatibility: 'direct', authType: 'env' };
    });

    mockGetProviderEnv.mockImplementation((_provider, authToken: string) => ({
      AUTH_TOKEN: authToken,
    }));
  });

  it('routes GPT models through the local cliproxy sidecar when Codex subscription login is active', () => {
    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: { openai: 'sk-test-123' },
        providerAuth: {},
      },
    });
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: true });

    const env = getProviderEnvForModel('gpt-5.4');

    // Subscription path bypasses claudish-backed getProviderEnv entirely and
    // instead injects ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN pointing at
    // the local CLIProxyAPI sidecar.
    expect(mockGetProviderEnv).not.toHaveBeenCalled();
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
      ANTHROPIC_AUTH_TOKEN: 'panopticon-local-cliproxy-key',
    });
  });

  it('falls back to the OpenAI API key when no Codex subscription login exists', () => {
    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: { openai: 'sk-test-123' },
        providerAuth: {},
      },
    });
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: false });

    const env = getProviderEnvForModel('gpt-5.4');

    expect(mockGetProviderEnv).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openai' }),
      'sk-test-123'
    );
    expect(env).toEqual({ AUTH_TOKEN: 'sk-test-123' });
  });

  it('uses cx@ prefix for GPT models routed through subscription auth', () => {
    expect(getClaudishPrefix('gpt-5.4', 'subscription')).toBe('cx@gpt-5.4');
  });

  it('launches MiniMax models directly through claude instead of claudish', () => {
    expect(getAgentRuntimeBaseCommand('minimax-m2.7')).toBe(
      'claude --dangerously-skip-permissions --model minimax-m2.7'
    );
  });
});
