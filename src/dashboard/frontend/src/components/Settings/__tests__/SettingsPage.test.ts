import { describe, it, expect } from 'vitest';
import { buildMiniMaxFormData } from '../SettingsPage';
import { MODELS_BY_PROVIDER } from '../AgentCards/ModelOverrideModal';
import { getEffectiveModelId, DEFAULT_MODELS_BY_WORK_TYPE, FALLBACK_DEFAULT_MODEL } from '../modelDefaults';
import type { SettingsConfig } from '../types';

const MINIMAX_DEFAULTS: SettingsConfig = {
  models: {
    providers: {
      anthropic: false,
      openai: false,
      google: false,
      minimax: true,
      zai: false,
      kimi: false,
      openrouter: false,
    },
    overrides: {
      'issue-agent:implementation': 'minimax-m2.7-highspeed',
    },
    gemini_thinking_level: 3,
  },
  api_keys: {},
  tracker_keys: {},
};

// Deprecated model IDs that must not appear in the UI model catalog.
// When adding new deprecations, add them here too.
const DEPRECATED_MODEL_IDS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'gpt-5.2-codex',
  'o3-deep-research',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'kimi-k2',
  'glm-4.7',
  'glm-4.7-flash',
];

describe('MODELS_BY_PROVIDER', () => {
  it('contains no deprecated model IDs', () => {
    const allModelIds = Object.values(MODELS_BY_PROVIDER).flatMap(p => p.models.map(m => m.id));
    const found = DEPRECATED_MODEL_IDS.filter(dep => allModelIds.includes(dep as never));
    expect(found).toEqual([]);
  });
});

describe('getEffectiveModelId', () => {
  it('returns the override when one is set', () => {
    const result = getEffectiveModelId('issue-agent:implementation', {
      'issue-agent:implementation': 'minimax-m2.7-highspeed',
    });
    expect(result).toBe('minimax-m2.7-highspeed');
  });

  it('returns the backend optimal default when no override is set', () => {
    // Without an override, the settings page must show the backend default — NOT
    // the generic FALLBACK_DEFAULT_MODEL. Regression for the bug where any
    // unoverridden card showed gpt-4o-mini regardless of actual routing defaults.
    const result = getEffectiveModelId('issue-agent:exploration', {});
    expect(result).toBe(DEFAULT_MODELS_BY_WORK_TYPE['issue-agent:exploration']);
    expect(result).not.toBe(FALLBACK_DEFAULT_MODEL);
  });

  it('returns FALLBACK_DEFAULT_MODEL only for work types with no backend default', () => {
    // A work type unknown to the router should fall through to the generic fallback.
    const result = getEffectiveModelId('unknown-work-type' as never, {});
    expect(result).toBe(FALLBACK_DEFAULT_MODEL);
  });
});

describe('buildMiniMaxFormData', () => {
  it('applies MiniMax providers and overrides', () => {
    const result = buildMiniMaxFormData(null, MINIMAX_DEFAULTS);
    expect(result.models.providers.minimax).toBe(true);
    expect(result.models.providers.anthropic).toBe(false);
    expect(result.models.overrides['issue-agent:implementation']).toBe('minimax-m2.7-highspeed');
  });

  it('preserves existing conversations settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      conversations: { compaction_model: 'claude-haiku-4-5', manual_compact_mode: 'panopticon-native', rich_compaction: true },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.conversations?.compaction_model).toBe('claude-haiku-4-5');
    expect(result.conversations?.manual_compact_mode).toBe('panopticon-native');
    expect(result.conversations?.rich_compaction).toBe(true);
  });

  it('preserves existing tmux settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      tmux: { config_mode: 'inherit-user' },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.tmux?.config_mode).toBe('inherit-user');
  });

  it('preserves existing openrouter settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      openrouter: { favorites: ['qwen/qwq-32b'] },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.openrouter?.favorites).toEqual(['qwen/qwq-32b']);
  });

  it('preserves gemini_thinking_level from formData, not from defaults', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      models: { ...MINIMAX_DEFAULTS.models, gemini_thinking_level: 2 },
    };
    const defaults = { ...MINIMAX_DEFAULTS, models: { ...MINIMAX_DEFAULTS.models, gemini_thinking_level: 4 } };
    const result = buildMiniMaxFormData(existing, defaults);
    expect(result.models.gemini_thinking_level).toBe(2);
  });

  it('works correctly when formData is null', () => {
    const result = buildMiniMaxFormData(null, MINIMAX_DEFAULTS);
    expect(result.models.providers.minimax).toBe(true);
    expect(result.conversations).toEqual({});
    expect(result.tmux).toEqual({});
    expect(result.openrouter).toEqual({});
  });
});
