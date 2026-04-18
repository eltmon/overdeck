import { describe, it, expect } from 'vitest';
import { buildMiniMaxFormData } from '../SettingsPage';
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
