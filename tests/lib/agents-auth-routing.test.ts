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

import { getClaudishPrefix, getProviderEnvForModel } from '../../src/lib/agents.js';

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
        return { name: 'openai', displayName: 'OpenAI', authType: 'env' };
      }
      return { name: 'anthropic', displayName: 'Anthropic', authType: 'env' };
    });

    mockGetProviderEnv.mockImplementation((_provider, authToken: string) => ({
      AUTH_TOKEN: authToken,
    }));
  });

  it('prefers Codex subscription auth over an OpenAI API key when login is active', () => {
    mockLoadYamlConfig.mockReturnValue({
      config: {
        apiKeys: { openai: 'sk-test-123' },
        providerAuth: {},
      },
    });
    mockOpenAIAuthStatus.mockReturnValue({ loggedIn: true });

    const env = getProviderEnvForModel('gpt-5.4');

    expect(mockGetProviderEnv).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openai' }),
      'subscription-oauth'
    );
    expect(env).toEqual({ AUTH_TOKEN: 'subscription-oauth' });
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
});
