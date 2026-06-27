import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiSettingsConfig } from '../settings-api.js';

const mockLoadConfig = vi.fn();
const mockResolveModelId = vi.fn((modelId: string) => modelId);
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockClearConfigCache = vi.fn();
const mockMergeConfigs = vi.fn(() => ({ config: {}, explicitlyDisabled: new Set() }));

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock('../config-yaml.js', () => ({
  PARENT_MODEL_REF: 'parent',
  DEFAULT_MODEL_REFS: {
    plan: 'workhorse:expensive',
    work: 'workhorse:mid',
    review: 'workhorse:expensive',
    test: 'workhorse:mid',
    ship: 'workhorse:mid',
    flywheel: 'claude-opus-4-7',
    strike: 'workhorse:expensive',
    sequencer: 'workhorse:expensive',
  },
  DEFAULT_WORKHORSES: {
    expensive: 'claude-opus-4-7',
    mid: 'claude-sonnet-4-6',
    cheap: 'claude-haiku-4-5',
  },
  DEFAULT_ROLES: {
    plan: { model: 'workhorse:expensive' },
    work: { model: 'workhorse:mid', sub: { inspect: { model: 'workhorse:cheap' }, 'inspect-deep': { model: 'workhorse:mid' } } },
    review: { model: 'workhorse:expensive', sub: { security: { model: 'workhorse:expensive' }, correctness: { model: 'workhorse:mid' }, performance: { model: 'workhorse:mid' }, requirements: { model: 'workhorse:mid' }, synthesis: { model: 'workhorse:expensive' } } },
    test: { model: 'workhorse:mid' },
    ship: { model: 'workhorse:mid' },
    strike: { model: 'workhorse:expensive' },
    sequencer: { model: 'workhorse:expensive' },
    flywheel: { model: 'claude-opus-4-7', effort: 'high', maxAgents: 8, scope: 'pan-only' },
  },
  ROLE_EFFORTS: ['low', 'medium', 'high', 'xhigh', 'max'],
  loadConfig: () => mockLoadConfig(),
  loadConfigSync: () => mockLoadConfig(),
  getGlobalConfigPath: () => '/tmp/config.yaml',
  clearConfigCache: () => mockClearConfigCache(),
  mergeConfigs: (...args: unknown[]) => mockMergeConfigs(...args),
}));

vi.mock('../model-capabilities.js', () => ({
  MODEL_CAPABILITIES: {
    'claude-opus-4-7': { provider: 'anthropic', displayName: 'Claude Opus 4.7', costPer1MTokens: 1 },
    'claude-sonnet-4-6': { provider: 'anthropic', displayName: 'Claude Sonnet 4.6', costPer1MTokens: 1 },
    'claude-haiku-4-5': { provider: 'anthropic', displayName: 'Claude Haiku 4.5', costPer1MTokens: 1 },
    'gpt-5.5': { provider: 'openai', displayName: 'GPT-5.5', costPer1MTokens: 1 },
    'gpt-5.5-mini': { provider: 'openai', displayName: 'GPT-5.5 Mini', costPer1MTokens: 1 },
    'minimax-m2.7-highspeed': { provider: 'minimax', displayName: 'MiniMax M2.7', costPer1MTokens: 1 },
    'qwen3-coder-plus': { provider: 'dashscope', displayName: 'Qwen3 Coder Plus', costPer1MTokens: 1 },
  },
  MODEL_DEPRECATIONS: {
    'claude-opus-4-6': 'claude-opus-4-7',
  },
  getModelCapability: vi.fn(),
  getModelCapabilitySync: vi.fn(),
  hasModelCapability: (modelId: string) => [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'gpt-5.5',
    'gpt-5.5-mini',
    'minimax-m2.7-highspeed',
    'qwen3-coder-plus',
  ].includes(modelId),
  hasModelCapabilitySync: (modelId: string) => [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'gpt-5.5',
    'gpt-5.5-mini',
    'minimax-m2.7-highspeed',
    'qwen3-coder-plus',
  ].includes(modelId),
  resolveModelId: (modelId: string) => mockResolveModelId(modelId),
  resolveModelIdSync: (modelId: string) => mockResolveModelId(modelId),
  getModelEffortLevelsSync: (modelId: string) => (({
    'claude-opus-4-7': ['low', 'medium', 'high', 'xhigh', 'max'],
    'claude-opus-4-6': ['low', 'medium', 'high', 'max'],
    'claude-sonnet-4-6': ['low', 'medium', 'high'],
  }) as Record<string, readonly string[]>)[mockResolveModelId(modelId)],
}));


function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      enabledProviders: new Set(['anthropic']),
      overrides: {},
      geminiThinkingLevel: 3,
      apiKeys: {},
      providerAuth: {},
      providerPlan: {},
      providerHarnesses: {},
      openrouterFavorites: [],
      defaultConversationModel: 'claude-sonnet-4-6',
      trackerKeys: {},
      tmux: { configMode: 'managed' },
      conversations: {
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'claude-code',
        richCompaction: true,
        titleModel: 'claude-haiku-4-5',
      },
      conversationSearch: {
        enabled: false,
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKeyRef: undefined,
        dbPath: '/tmp/conversations/embeddings.db',
      },
      memory: {
        extraction: { fallbackChain: [] },
        observationsEnabled: true,
        promptTimeInjectionEnabled: true,
        rollupPendingThreshold: 4,
        sidebarRefreshIntervalMs: 10000,
      },
      experimental: { experimentalFeatures: false, claudeCodeChannels: false, claudeCodeChannelsMcp: false, streamdownRenderer: false, showHarnessModelPermutations: false },
      rtk: { enabled: false },
      claude: { permissionMode: 'auto' },
      tts: {
        enabled: false,
        voice: '',
        volume: 1,
        rate: 1,
        maxChars: 140,
        dropInfoWhenFull: true,
        daemonPort: 8787,
        daemonHost: '127.0.0.1',
        voiceMap: {},
        mutedSources: [],
        utteranceTemplates: {},
        mutedIssues: [],
      },
      ...overrides,
    },
  };
}

describe('getDefaultConversationModelApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(baseConfig());
  });

  it('returns the explicitly configured default conversation model', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ defaultConversationModel: 'claude-haiku-4-5' }));

    const { getDefaultConversationModelApi } = await import('../settings-api.js');

    expect(getDefaultConversationModelApi()).toBe('claude-haiku-4-5');
    expect(mockResolveModelId).toHaveBeenCalledWith('claude-haiku-4-5');
  });

  it('fails loudly when default_conversation_model is unset', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({
      enabledProviders: new Set(['anthropic', 'openai']),
      defaultConversationModel: undefined,
    }));

    const { getDefaultConversationModelApi } = await import('../settings-api.js');

    expect(() => getDefaultConversationModelApi()).toThrow('No default model configured — set models.default_conversation_model');
    expect(mockResolveModelId).not.toHaveBeenCalled();
  });
});

describe('loadSettingsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(baseConfig());
  });

  it('loads conversation compaction settings from config', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({
      conversations: {
        compactionModel: 'claude-sonnet-4-6',
        manualCompactMode: 'overdeck-native',
        richCompaction: true,
        titleModel: 'claude-haiku-4-5',
      },
    }));

    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.conversations).toEqual({
      compaction_model: 'claude-sonnet-4-6',
      manual_compact_mode: 'overdeck-native',
      rich_compaction: true,
      title_model: 'claude-haiku-4-5',
    });
  });

  it('loads streamdown renderer experimental flag with default false', async () => {
    const { loadSettingsApi } = await import('../settings-api.js');

    expect(loadSettingsApi().experimental?.streamdownRenderer).toBe(false);
    expect(loadSettingsApi().experimental?.showHarnessModelPermutations).toBe(false);
    expect(loadSettingsApi().experimental?.experimentalFeatures).toBe(false);

    mockLoadConfig.mockReturnValue(baseConfig({
      experimental: { experimentalFeatures: true, claudeCodeChannels: false, claudeCodeChannelsMcp: false, streamdownRenderer: true, showHarnessModelPermutations: true },
    }));

    expect(loadSettingsApi().experimental?.streamdownRenderer).toBe(true);
    expect(loadSettingsApi().experimental?.showHarnessModelPermutations).toBe(true);
    expect(loadSettingsApi().experimental?.experimentalFeatures).toBe(true);
  });

  it('returns seeded workhorses and roles without legacy overrides', async () => {
    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.workhorses).toEqual({
      expensive: 'claude-opus-4-7',
      mid: 'claude-sonnet-4-6',
      cheap: 'claude-haiku-4-5',
    });
    expect(settings.roles).toMatchObject({
      plan: { model: 'workhorse:expensive' },
      work: {
        model: 'workhorse:mid',
        sub: {
          inspect: { model: 'workhorse:cheap' },
          'inspect-deep': { model: 'workhorse:mid' },
        },
      },
      review: {
        model: 'workhorse:expensive',
        sub: {
          security: { model: 'workhorse:expensive' },
          correctness: { model: 'workhorse:mid' },
          performance: { model: 'workhorse:mid' },
          requirements: { model: 'workhorse:mid' },
          synthesis: { model: 'workhorse:expensive' },
        },
      },
      test: { model: 'workhorse:mid' },
      ship: { model: 'workhorse:mid' },
      flywheel: { model: 'claude-opus-4-7', effort: 'high', maxAgents: 8, scope: 'pan-only' },
    });
    expect(settings.models).not.toHaveProperty('overrides');
  });

  it('exposes built-in provider harness defaults separately from overrides', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ providerHarnesses: { openai: 'ohmypi' } }));

    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.models.provider_harnesses).toEqual({ openai: 'ohmypi' });
    expect(settings.models.provider_default_harnesses).toEqual({
      anthropic: 'claude-code',
      openai: 'codex',
      google: 'ohmypi',
      minimax: 'ohmypi',
      zai: 'ohmypi',
      kimi: 'claude-code', // PAN-2102: omp can no longer launch Kimi; default to native claude-code
      mimo: 'ohmypi',
      openrouter: 'ohmypi',
      nous: 'ohmypi',
      dashscope: 'ohmypi',
    });
  });

  it('overlays configured workhorses and roles on seeded defaults', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({
      workhorses: { mid: 'gpt-5.5-mini' },
      roles: { work: { model: 'workhorse:mid', sub: { inspect: { model: 'claude-haiku-4-5' } } } },
    }));

    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.workhorses?.mid).toBe('gpt-5.5-mini');
    expect(settings.workhorses?.expensive).toBe('claude-opus-4-7');
    expect(settings.roles?.work?.sub?.inspect?.model).toBe('claude-haiku-4-5');
  });

  it('exposes flywheel role config helpers', async () => {
    mockReadFile.mockResolvedValue('{}\n');
    const { getRoleConfig, setRoleConfig } = await import('../settings-api.js');

    expect(getRoleConfig('flywheel')).toEqual({
      model: 'claude-opus-4-7',
      effort: 'high',
      maxAgents: 8,
      scope: 'pan-only',
    });

    await Effect.runPromise(setRoleConfig('flywheel', {
      harness: 'ohmypi',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
      maxAgents: 4,
      scope: 'all-tracked-projects',
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('flywheel:');
    expect(written).toContain('harness: ohmypi');
    expect(written).toContain('maxAgents: 4');
  });

  it('removes role harness overrides when saved as null or empty', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({
      roles: { work: { model: 'workhorse:mid', harness: 'ohmypi' } },
    }));
    const { loadSettingsApi, saveSettingsApi, setRoleConfig } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      roles: {
        ...settings.roles,
        work: {
          ...settings.roles?.work,
          harness: null,
        },
      },
    } as never));

    let written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).not.toContain('harness: ohmypi');
    expect(written).not.toContain('harness: null');

    mockWriteFile.mockClear();
    await Effect.runPromise(setRoleConfig('work', {
      model: 'workhorse:mid',
      harness: '',
    } as never));

    written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).not.toContain('harness: ohmypi');
    expect(written).not.toContain('harness: ""');
  });

  it('loads tts daemon settings from normalized config', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({
      tts: {
        enabled: true,
        voice: 'voice-main',
        statusVoice: 'voice-status',
        volume: 0.6,
        rate: 1.2,
        maxChars: 180,
        dropInfoWhenFull: false,
        daemonPort: 8787,
        daemonHost: '127.0.0.1',
        voiceMap: { 'mergeStatus.merged': 'voice-merge' },
        mutedSources: ['merge-agent'],
        utteranceTemplates: { readyForMerge: '{issueId} ready' },
        mutedIssues: ['PAN-123'],
      },
    }));

    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.tts).toEqual({
      enabled: true,
      voice: 'voice-main',
      statusVoice: 'voice-status',
      volume: 0.6,
      rate: 1.2,
      maxChars: 180,
      dropInfoWhenFull: false,
      voiceMap: { 'mergeStatus.merged': 'voice-merge' },
      mutedSources: ['merge-agent'],
      utteranceTemplates: { readyForMerge: '{issueId} ready' },
      mutedIssues: ['PAN-123'],
    });
  });

  it('loads memory settings from config', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({
      memory: {
        extraction: {
          provider: 'cliproxy',
          model: 'gpt-4.1-nano',
          perDayCostCapUsd: 0,
          fallbackChain: [
            { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
            { provider: 'cliproxy', model: 'gpt-4.1-nano-fallback' },
          ],
        },
        observationsEnabled: false,
        promptTimeInjectionEnabled: false,
        rollupPendingThreshold: 6,
        sidebarRefreshIntervalMs: 15000,
      },
    }));

    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.memory).toEqual({
      provider: 'cliproxy',
      model: 'gpt-4.1-nano',
      per_day_cost_cap_usd: 0,
      fallback_provider: 'anthropic',
      fallback_model: 'claude-haiku-4-5-20251001',
      fallback_chain: [
        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
        { provider: 'cliproxy', model: 'gpt-4.1-nano-fallback' },
      ],
      observations_enabled: false,
      prompt_time_injection_enabled: false,
      rollup_pending_threshold: 6,
      sidebar_refresh_interval_ms: 15000,
    });
  });
});

describe('saveSettingsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(baseConfig());
    mockReadFile.mockResolvedValue('# user comment\nmodels:\n  providers:\n    anthropic: true\n  overrides:\n    issue-agent:implementation: glm-5.1\n');
  });

  it('round-trips config.yaml comments while writing roles, memory settings, and dropping overrides', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      workhorses: { ...settings.workhorses, mid: 'gpt-5.5-mini' },
      roles: {
        ...settings.roles,
        work: { model: 'workhorse:mid', sub: { inspect: { model: 'claude-haiku-4-5' } } },
      },
      memory: {
        provider: 'cliproxy',
        model: 'gpt-4.1-nano',
        per_day_cost_cap_usd: 0,
        fallback_provider: 'anthropic',
        fallback_model: 'claude-haiku-4-5-20251001',
        fallback_chain: [
          { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
          { provider: 'cliproxy', model: 'gpt-4.1-nano-fallback' },
        ],
        observations_enabled: false,
        prompt_time_injection_enabled: false,
        rollup_pending_threshold: 6,
        sidebar_refresh_interval_ms: 15000,
      },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('# user comment');
    expect(written).toContain('workhorses:');
    expect(written).toContain('mid: gpt-5.5-mini');
    expect(written).toContain('roles:');
    expect(written).toContain('inspect:');
    expect(written).toContain('memory:');
    expect(written).toContain('provider: cliproxy');
    expect(written).toContain('per_day_cost_cap_usd: 0');
    expect(written).toContain('fallback_chain:');
    expect(written).toContain('model: claude-haiku-4-5-20251001');
    expect(written).toContain('model: gpt-4.1-nano-fallback');
    expect(written).toContain('observations: false');
    expect(written).not.toContain('overrides:');
    expect(mockClearConfigCache).toHaveBeenCalledOnce();
  });

  it('persists explicit provider harness overrides', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      models: {
        ...settings.models,
        provider_harnesses: { openai: 'ohmypi' },
      },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('openai:');
    expect(written).toContain('harness: ohmypi');

    mockLoadConfig.mockReturnValue(baseConfig({ providerHarnesses: { openai: 'ohmypi' } }));
    expect(loadSettingsApi().models.provider_harnesses?.openai).toBe('ohmypi');
  });

  it('removes provider harness overrides when saved as empty or absent', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ providerHarnesses: { openai: 'ohmypi' } }));
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      models: {
        ...settings.models,
        provider_harnesses: { openai: '' },
      },
    }));

    let written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).not.toContain('harness: ohmypi');
    expect(written).not.toContain('harness: ""');

    mockWriteFile.mockClear();
    await Effect.runPromise(saveSettingsApi({
      ...settings,
      models: {
        ...settings.models,
        provider_harnesses: {},
      },
    }));

    written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).not.toContain('harness: ohmypi');
  });

  it('round-trips parent sub-role model refs through saved and loaded settings', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      roles: {
        ...settings.roles,
        review: {
          ...settings.roles?.review,
          model: 'workhorse:expensive',
          sub: {
            ...settings.roles?.review?.sub,
            security: { model: 'parent' },
          },
        },
      },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('security:');
    expect(written).toContain('model: parent');

    mockLoadConfig.mockReturnValue(baseConfig({
      roles: {
        review: {
          model: 'workhorse:expensive',
          sub: { security: { model: 'parent' } },
        },
      },
    }));

    expect(loadSettingsApi().roles?.review?.sub?.security?.model).toBe('parent');
  });

  it('round-trips streamdown renderer experimental flag', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      experimental: {
        ...settings.experimental,
        experimentalFeatures: true,
        streamdownRenderer: true,
        showHarnessModelPermutations: true,
      },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('experimental:');
    expect(written).toContain('experimentalFeatures: true');
    expect(written).toContain('streamdownRenderer: true');
    expect(written).toContain('showHarnessModelPermutations: true');
  });

  it('persists conversation search settings', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.conversationSearch?.enabled).toBe(false);

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      conversationSearch: {
        enabled: true,
        provider: 'openai',
        model: 'text-embedding-3-large',
        apiKeyRef: 'OPENAI_SEARCH_KEY',
        dbPath: '/tmp/search.db',
      },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('conversationSearch:');
    expect(written).toContain('enabled: true');
    expect(written).toContain('model: text-embedding-3-large');
    expect(written).toContain('apiKeyRef: OPENAI_SEARCH_KEY');
    expect(written).toContain('dbPath: /tmp/search.db');
  });

  it('persists DashScope provider enablement and API key', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      models: {
        ...settings.models,
        providers: {
          ...settings.models.providers,
          dashscope: true,
        },
      },
      api_keys: {
        ...settings.api_keys,
        dashscope: 'dashscope-test-key',
      },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('dashscope: true');
    expect(written).toContain('dashscope: dashscope-test-key');
  });

  it('persists RTK agent settings without removing existing agent settings', async () => {
    mockReadFile.mockResolvedValue('agents:\n  caveman:\n    enabled: true\n');
    mockLoadConfig.mockReturnValue(baseConfig({ rtk: { enabled: true } }));
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.agents?.rtk?.enabled).toBe(true);

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      agents: { rtk: { enabled: false } },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('caveman:');
    expect(written).toContain('rtk:');
    expect(written).toContain('enabled: false');
  });

  it('rejects untrusted tts daemon endpoint keys at runtime', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await expect(Effect.runPromise(saveSettingsApi({
      ...settings,
      tts: {
        ...settings.tts,
        daemonHost: '169.254.169.254',
      } as typeof settings.tts,
    }))).rejects.toThrow('Unknown tts setting(s): daemonHost');

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes tts daemon settings without removing tts.summarizer', async () => {
    mockReadFile.mockResolvedValue('tts:\n  summarizer:\n    enabled: true\n    model: claude-haiku-4-5\n');
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await Effect.runPromise(saveSettingsApi({
      ...settings,
      tts: {
        ...settings.tts,
        enabled: true,
        voice: 'voice-main',
        volume: 0.75,
        rate: 1.1,
        maxChars: 180,
        dropInfoWhenFull: false,
        voiceMap: { 'reviewStatus.passed': 'voice-review' },
        mutedSources: ['test-specialist'],
        utteranceTemplates: { readyForMerge: '{issueId} ready' },
        mutedIssues: ['PAN-123'],
      },
    }));

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('summarizer:');
    expect(written).toContain('enabled: true');
    expect(written).toContain('voice: voice-main');
    expect(written).toContain('volume: 0.75');
    expect(written).toContain('reviewStatus.passed: voice-review');
    expect(written).toContain('mutedSources:');
    expect(written).toContain('PAN-123');
  });
});

describe('validateSettingsApi', () => {
  const validSettings = {
    workhorses: {
      expensive: 'claude-opus-4-7',
      mid: 'claude-sonnet-4-6',
      cheap: 'claude-haiku-4-5',
    },
    roles: {
      plan: { model: 'workhorse:expensive' },
      work: { model: 'workhorse:mid', sub: { inspect: { model: 'claude-haiku-4-5' } } },
      review: { model: 'workhorse:expensive', sub: { security: { model: 'claude-opus-4-7' }, synthesis: { model: 'workhorse:expensive' } } },
      test: { model: 'workhorse:mid' },
      ship: { model: 'workhorse:mid' },
      flywheel: { harness: 'claude-code', model: 'claude-opus-4-7', effort: 'high', maxAgents: 8, scope: 'pan-only' },
    },
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
        nous: false,
        dashscope: false,
      },
      gemini_thinking_level: 3,
    },
    api_keys: {},
    tracker_keys: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts role and workhorse model references', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');

    expect(validateSettingsApi(validSettings).valid).toBe(true);
  });

  it('rejects unknown roles and sub-roles', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      roles: {
        ...validSettings.roles,
        banana: { model: 'claude-sonnet-4-6' },
        work: { model: 'workhorse:mid', sub: { banana: { model: 'claude-haiku-4-5' } } },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown role "banana"');
    expect(result.errors).toContain('Unknown sub-role "banana" for role "work"');
  });

  it('rejects invalid, chained, and unresolved model references', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      workhorses: {
        expensive: 'workhorse:mid',
        mid: 'not-a-model',
      },
      roles: {
        plan: { model: 'workhorse:missing' },
        work: { model: 'not-a-model' },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('workhorses.expensive cannot reference another workhorse');
    expect(result.errors).toContain('Invalid model reference "not-a-model" at workhorses.mid');
    expect(result.errors).toContain('roles.plan.model references unknown workhorse slot "missing"');
    expect(result.errors).toContain('Invalid model reference "not-a-model" at roles.work.model');
  });

  it('rejects invalid flywheel role fields', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      roles: {
        ...validSettings.roles,
        flywheel: { model: 'claude-opus-4-7', harness: 'bad', effort: 'maximum', maxAgents: 0, scope: 'everything' } as never,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('roles.flywheel.harness must be claude-code, ohmypi, codex, null, or empty string');
    expect(result.errors).toContain('roles.flywheel.effort must be one of low, medium, high, xhigh, max');
    expect(result.errors).toContain('roles.flywheel.maxAgents must be a positive integer');
    expect(result.errors).toContain('roles.flywheel.scope must be pan-only or all-tracked-projects');
  });

  it('accepts null and empty string role harness clear sentinels', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      roles: {
        ...validSettings.roles,
        work: { model: 'workhorse:mid', harness: null } as never,
        review: { model: 'workhorse:expensive', harness: '' } as never,
      },
    });

    expect(result.valid).toBe(true);
  });

  it('accepts xhigh and max effort on an Opus 4.7 role', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      roles: {
        ...validSettings.roles,
        work: { model: 'workhorse:expensive', effort: 'xhigh' },
        review: { model: 'claude-opus-4-7', effort: 'max' },
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects an effort level the role model does not support (model-aware)', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      roles: {
        ...validSettings.roles,
        // workhorse:mid resolves to claude-sonnet-4-6, which supports low/medium/high only.
        test: { model: 'workhorse:mid', effort: 'xhigh' },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "roles.test.effort 'xhigh' is not supported by claude-sonnet-4-6 (supported: low, medium, high)",
    );
  });

  it('rejects unknown tts settings', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      tts: {
        enabled: true,
        daemonPort: 22,
      } as never,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown tts setting(s): daemonPort');
  });

  it('rejects invalid experimental flag types', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      experimental: {
        claudeCodeChannels: 'yes',
        claudeCodeChannelsMcp: 'yes',
        experimentalFeatures: 'yes',
        streamdownRenderer: 'yes',
        showHarnessModelPermutations: 'yes',
      } as never,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('experimental.claudeCodeChannels must be a boolean');
    expect(result.errors).toContain('experimental.claudeCodeChannelsMcp must be a boolean');
    expect(result.errors).toContain('experimental.experimentalFeatures must be a boolean');
    expect(result.errors).toContain('experimental.streamdownRenderer must be a boolean');
    expect(result.errors).toContain('experimental.showHarnessModelPermutations must be a boolean');
  });

  it('rejects invalid tts field types', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      tts: {
        enabled: 'yes',
        dropInfoWhenFull: 'no',
        voice: 1,
        statusVoice: 2,
        voiceMap: { good: 'voice-1', bad: 3 },
        utteranceTemplates: [],
        mutedSources: {},
        mutedIssues: [1],
      } as never,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('tts.enabled must be a boolean');
    expect(result.errors).toContain('tts.dropInfoWhenFull must be a boolean');
    expect(result.errors).toContain('tts.voice must be a string');
    expect(result.errors).toContain('tts.statusVoice must be a string');
    expect(result.errors).toContain('tts.voiceMap must be a string record');
    expect(result.errors).toContain('tts.utteranceTemplates must be a string record');
    expect(result.errors).toContain('tts.mutedSources must be an array of strings');
    expect(result.errors).toContain('tts.mutedIssues must be an array of strings');
  });

  it('rejects invalid tts numeric settings', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      tts: {
        volume: 1.2,
        rate: 0,
        maxChars: 0,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('tts.volume must be between 0 and 1');
    expect(result.errors).toContain('tts.rate must be greater than 0');
    expect(result.errors).toContain('tts.maxChars must be greater than 0');
  });

  it('rejects invalid memory numeric settings', async () => {
    const { validateSettingsApi } = await import('../settings-api.js');
    const result = validateSettingsApi({
      ...validSettings,
      memory: {
        per_day_cost_cap_usd: -1,
        rollup_pending_threshold: 0,
        sidebar_refresh_interval_ms: 0,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('memory.per_day_cost_cap_usd must be greater than or equal to 0');
    expect(result.errors).toContain('memory.rollup_pending_threshold must be a positive integer');
    expect(result.errors).toContain('memory.sidebar_refresh_interval_ms must be a positive integer');
  });
});

describe('getAvailableModelsApi — MODEL_DEPRECATIONS filter (PAN-1122 follow-up)', () => {
  // Regression guard: PR #1425 added the dropped OpenAI models to
  // MODEL_DEPRECATIONS but did not update this endpoint, so the dropdown
  // continued to surface them. Settings picker reads from this endpoint.
  // We use a scoped vi.doMock here so the test exercises the filter against
  // a CAPABILITIES catalog that actually contains a deprecated model — the
  // file-level mock at the top of this file doesn't.
  it('excludes any model whose ID appears in MODEL_DEPRECATIONS', async () => {
    vi.resetModules();
    vi.doMock('../model-capabilities.js', () => ({
      MODEL_CAPABILITIES: {
        'gpt-5.5': { provider: 'openai', displayName: 'GPT-5.5', costPer1MTokens: 1 },
        'gpt-5.4': { provider: 'openai', displayName: 'GPT-5.4', costPer1MTokens: 1 },
        'gpt-4o': { provider: 'openai', displayName: 'GPT-4o', costPer1MTokens: 1 },
        'gpt-5.5-pro': { provider: 'openai', displayName: 'GPT-5.5 Pro', costPer1MTokens: 1 },
        'o4-mini': { provider: 'openai', displayName: 'O4 Mini', costPer1MTokens: 1 },
      },
      MODEL_DEPRECATIONS: {
        'gpt-4o': 'gpt-5.4',
        'gpt-5.5-pro': 'gpt-5.5',
        'o4-mini': 'gpt-5.4-mini',
      },
      getModelCapability: vi.fn(),
      getModelCapabilitySync: vi.fn(),
      hasModelCapability: () => true,
      hasModelCapabilitySync: () => true,
      resolveModelId: (modelId: string) => modelId,
      resolveModelIdSync: (modelId: string) => modelId,
    }));

    const { getAvailableModelsApi } = await import('../settings-api.js');
    const openaiIds = getAvailableModelsApi().openai.map(m => m.id);

    // Kept models pass through.
    expect(openaiIds).toContain('gpt-5.5');
    expect(openaiIds).toContain('gpt-5.4');
    // Dropped models — present in capabilities for back-compat (cost lookups
    // on historical conversations) but excluded from user-facing pickers.
    expect(openaiIds).not.toContain('gpt-4o');
    expect(openaiIds).not.toContain('gpt-5.5-pro');
    expect(openaiIds).not.toContain('o4-mini');

    vi.doUnmock('../model-capabilities.js');
    vi.resetModules();
  });
});
