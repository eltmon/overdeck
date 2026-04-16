import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadConfig = vi.fn();
const mockResolveModelId = vi.fn((modelId: string) => modelId);

vi.mock('../config-yaml.js', () => ({
  loadConfig: () => mockLoadConfig(),
  getGlobalConfigPath: () => '/tmp/config.yaml',
}));

vi.mock('../model-capabilities.js', () => ({
  MODEL_CAPABILITIES: {},
  MODEL_DEPRECATIONS: {},
  getModelCapability: vi.fn(),
  resolveModelId: (modelId: string) => mockResolveModelId(modelId),
}));

describe('getDefaultConversationModelApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to Claude Sonnet when OpenAI is not enabled', async () => {
    mockLoadConfig.mockReturnValue({
      config: {
        enabledProviders: new Set(['anthropic']),
        overrides: {},
        geminiThinkingLevel: 3,
        apiKeys: {},
        openrouterFavorites: [],
        trackerKeys: {},
        conversations: {
          compactionModel: 'claude-haiku-4-5',
          manualCompactMode: 'claude-code',
        },
      },
    });

    const { getDefaultConversationModelApi } = await import('../settings-api.js');

    expect(getDefaultConversationModelApi()).toBe('claude-sonnet-4-6');
    expect(mockResolveModelId).toHaveBeenCalledWith('claude-sonnet-4-6');
  });

  it('defaults to GPT-5.4 when OpenAI is enabled', async () => {
    mockLoadConfig.mockReturnValue({
      config: {
        enabledProviders: new Set(['anthropic', 'openai']),
        overrides: {},
        geminiThinkingLevel: 3,
        apiKeys: {},
        openrouterFavorites: [],
        trackerKeys: {},
        conversations: {
          compactionModel: 'claude-haiku-4-5',
          manualCompactMode: 'claude-code',
        },
      },
    });

    const { getDefaultConversationModelApi } = await import('../settings-api.js');

    expect(getDefaultConversationModelApi()).toBe('gpt-5.4');
    expect(mockResolveModelId).toHaveBeenCalledWith('gpt-5.4');
  });

  it('loads conversation compaction settings from config', async () => {
    mockLoadConfig.mockReturnValue({
      config: {
        enabledProviders: new Set(['anthropic']),
        overrides: {},
        geminiThinkingLevel: 3,
        apiKeys: {},
        openrouterFavorites: [],
        trackerKeys: {},
        tmux: { configMode: 'managed' },
        conversations: {
          compactionModel: 'claude-sonnet-4-6',
          manualCompactMode: 'panopticon-native',
        },
      },
    });

    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.conversations).toEqual({
      compaction_model: 'claude-sonnet-4-6',
      manual_compact_mode: 'panopticon-native',
    });
  });
});
