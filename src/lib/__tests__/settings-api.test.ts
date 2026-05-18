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
  DEFAULT_MODEL_REFS: {
    plan: 'workhorse:expensive',
    work: 'workhorse:mid',
    review: 'workhorse:expensive',
    test: 'workhorse:mid',
    ship: 'workhorse:mid',
    flywheel: 'claude-opus-4-7',
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
    flywheel: { harness: 'claude-code', model: 'claude-opus-4-7', effort: 'high', maxAgents: 8, scope: 'pan-only' },
  },
  loadConfig: () => mockLoadConfig(),
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
  },
  MODEL_DEPRECATIONS: {
    'claude-opus-4-6': 'claude-opus-4-7',
  },
  getModelCapability: vi.fn(),
  resolveModelId: (modelId: string) => mockResolveModelId(modelId),
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
      openrouterFavorites: [],
      trackerKeys: {},
      tmux: { configMode: 'managed' },
      conversations: {
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'claude-code',
        richCompaction: true,
        titleModel: 'claude-haiku-4-5',
      },
      experimental: { claudeCodeChannels: false },
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

  it('defaults to Claude Sonnet when OpenAI is not enabled', async () => {
    const { getDefaultConversationModelApi } = await import('../settings-api.js');

    expect(getDefaultConversationModelApi()).toBe('claude-sonnet-4-6');
    expect(mockResolveModelId).toHaveBeenCalledWith('claude-sonnet-4-6');
  });

  it('defaults to GPT-5.5 when OpenAI is enabled', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ enabledProviders: new Set(['anthropic', 'openai']) }));

    const { getDefaultConversationModelApi } = await import('../settings-api.js');

    expect(getDefaultConversationModelApi()).toBe('gpt-5.5');
    expect(mockResolveModelId).toHaveBeenCalledWith('gpt-5.5');
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
        manualCompactMode: 'panopticon-native',
        richCompaction: true,
        titleModel: 'claude-haiku-4-5',
      },
    }));

    const { loadSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    expect(settings.conversations).toEqual({
      compaction_model: 'claude-sonnet-4-6',
      manual_compact_mode: 'panopticon-native',
      rich_compaction: true,
      title_model: 'claude-haiku-4-5',
    });
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
      flywheel: { harness: 'claude-code', model: 'claude-opus-4-7', effort: 'high', maxAgents: 8, scope: 'pan-only' },
    });
    expect(settings.models).not.toHaveProperty('overrides');
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
      harness: 'claude-code',
      model: 'claude-opus-4-7',
      effort: 'high',
      maxAgents: 8,
      scope: 'pan-only',
    });

    await setRoleConfig('flywheel', {
      harness: 'pi',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
      maxAgents: 4,
      scope: 'all-tracked-projects',
    });

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('flywheel:');
    expect(written).toContain('harness: pi');
    expect(written).toContain('maxAgents: 4');
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
});

describe('saveSettingsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(baseConfig());
    mockReadFile.mockResolvedValue('# user comment\nmodels:\n  providers:\n    anthropic: true\n  overrides:\n    issue-agent:implementation: glm-5.1\n');
  });

  it('round-trips config.yaml comments while writing roles and dropping overrides', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await saveSettingsApi({
      ...settings,
      workhorses: { ...settings.workhorses, mid: 'gpt-5.5-mini' },
      roles: {
        ...settings.roles,
        work: { model: 'workhorse:mid', sub: { inspect: { model: 'claude-haiku-4-5' } } },
      },
    });

    const written = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(written).toContain('# user comment');
    expect(written).toContain('workhorses:');
    expect(written).toContain('mid: gpt-5.5-mini');
    expect(written).toContain('roles:');
    expect(written).toContain('inspect:');
    expect(written).not.toContain('overrides:');
    expect(mockClearConfigCache).toHaveBeenCalledOnce();
  });

  it('rejects untrusted tts daemon endpoint keys at runtime', async () => {
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await expect(saveSettingsApi({
      ...settings,
      tts: {
        ...settings.tts,
        daemonHost: '169.254.169.254',
      } as typeof settings.tts,
    })).rejects.toThrow('Unknown tts setting(s): daemonHost');

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes tts daemon settings without removing tts.summarizer', async () => {
    mockReadFile.mockResolvedValue('tts:\n  summarizer:\n    enabled: true\n    model: claude-haiku-4-5\n');
    const { loadSettingsApi, saveSettingsApi } = await import('../settings-api.js');
    const settings = loadSettingsApi();

    await saveSettingsApi({
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
    });

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
        flywheel: { model: 'claude-opus-4-7', harness: 'bad', effort: 'max', maxAgents: 0, scope: 'everything' } as never,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('roles.flywheel.harness must be claude-code or pi');
    expect(result.errors).toContain('roles.flywheel.effort must be low, medium, or high');
    expect(result.errors).toContain('roles.flywheel.maxAgents must be a positive integer');
    expect(result.errors).toContain('roles.flywheel.scope must be pan-only or all-tracked-projects');
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
});
