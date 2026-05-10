import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiSettingsConfig } from '../settings-api.js';

const mockLoadConfig = vi.fn();
const mockWriteFile = vi.fn();
const mockResolveModelId = vi.fn((modelId: string) => modelId);

vi.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock('../config-yaml.js', () => ({
  loadConfig: () => mockLoadConfig(),
  getGlobalConfigPath: () => '/tmp/config.yaml',
  clearConfigCache: vi.fn(),
}));

vi.mock('../work-type-router.js', () => ({
  reloadGlobalRouter: vi.fn(),
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

  it('defaults to GPT-5.5 when OpenAI is enabled', async () => {
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

    expect(getDefaultConversationModelApi()).toBe('gpt-5.5');
    expect(mockResolveModelId).toHaveBeenCalledWith('gpt-5.5');
  });

  it('loads conversation compaction settings from config', async () => {
    mockLoadConfig.mockReturnValue({
      config: {
        enabledProviders: new Set(['anthropic']),
        overrides: {},
        harnessOverrides: {},
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
      rich_compaction: undefined,
      title_model: undefined,
    });
  });

  it('round-trips harness overrides through settings load and save', async () => {
    mockLoadConfig.mockReturnValue({
      config: {
        enabledProviders: new Set(['anthropic', 'openai']),
        overrides: { 'issue-agent:implementation': 'glm-5.1' },
        harnessOverrides: {
          'issue-agent:implementation': 'pi',
          'specialist-review-agent': 'claude-code',
        },
        geminiThinkingLevel: 3,
        apiKeys: {},
        openrouterFavorites: [],
        trackerKeys: {},
        providerAuth: {},
        providerPlan: {},
        tmux: { configMode: 'managed' },
        conversations: {
          compactionModel: 'claude-haiku-4-5',
          manualCompactMode: 'claude-code',
        },
        experimental: { claudeCodeChannels: false },
        claude: { permissionMode: 'auto' },
      },
    });

    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.models.harness_overrides).toEqual({
      'issue-agent:implementation': 'pi',
      'specialist-review-agent': 'claude-code',
    });

    await saveSettingsApi(settings);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile.mock.calls[0][0]).toBe('/tmp/config.yaml');
    expect(mockWriteFile.mock.calls[0][1]).toContain('harness_overrides:');
    expect(mockWriteFile.mock.calls[0][1]).toContain('issue-agent:implementation: pi');
    expect(mockWriteFile.mock.calls[0][1]).toContain('specialist-review-agent: claude-code');
  });

  it('rejects invalid settings harness override values', async () => {
    const settings = {
      models: {
        providers: {
          anthropic: true,
          openai: false,
          google: false,
          minimax: false,
          zai: false,
          kimi: false,
          mimo: false,
          openrouter: false,
        },
        overrides: {},
        harness_overrides: {
          'issue-agent:implementation': 'not-a-harness',
        },
      },
      api_keys: {},
    } as unknown as ApiSettingsConfig;

    const { validateSettingsApi } = await import('../settings-api.js');

    expect(validateSettingsApi(settings)).toMatchObject({
      valid: false,
      errors: ['Invalid harness "not-a-harness" for work type "issue-agent:implementation"'],
    });
  });
});
