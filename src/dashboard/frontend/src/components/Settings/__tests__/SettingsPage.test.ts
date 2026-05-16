import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildMiniMaxFormData } from '../SettingsPage';
import { MODELS_BY_PROVIDER } from '../modelCatalog';
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
      nous: false,
    },
    overrides: {
      'legacy.route': 'minimax-m2.7-highspeed',
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
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'kimi-k2',
  'glm-4.7',
  'glm-4.7-flash',
];

const SETTINGS_PAGE_SOURCE = readFileSync(
  resolve(fileURLToPath(import.meta.url), '../../SettingsPage.tsx'),
  'utf8',
);

describe('SettingsPage role model routing panels', () => {
  it('renders WorkhorsePanel before RolesPanel and does not mount AgentCardsPanel', () => {
    const workhorseIndex = SETTINGS_PAGE_SOURCE.indexOf('<WorkhorsePanel />');
    const rolesIndex = SETTINGS_PAGE_SOURCE.indexOf('<RolesPanel />');

    expect(workhorseIndex).toBeGreaterThanOrEqual(0);
    expect(rolesIndex).toBeGreaterThan(workhorseIndex);
    expect(SETTINGS_PAGE_SOURCE).not.toContain('<AgentCardsPanel');
    expect(SETTINGS_PAGE_SOURCE).not.toContain("from './AgentCards'");
  });

  it('includes the TTS sidebar item and settings section controls', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain("{ id: 'tts', label: 'TTS'");
    expect(SETTINGS_PAGE_SOURCE).toContain('id="tts"');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ enabled:');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ volume:');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ rate:');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ maxChars:');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ dropInfoWhenFull:');
    expect(SETTINGS_PAGE_SOURCE).toContain('<TtsSystemVoicePicker');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ voice: voiceId })');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ statusVoice: voiceId })');
  });

  it('includes advanced TTS voice map, muted sources, and template controls', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain('fetchTtsVoices');
    expect(SETTINGS_PAGE_SOURCE).toContain('TTS_EVENT_KEYS.map');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsVoiceMapChange(eventKey');
    expect(SETTINGS_PAGE_SOURCE).toContain('ACTIVITY_SOURCE_OPTIONS.map');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsMutedSourceChange(source');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleAddTtsTemplate');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsTemplateChange(eventKey');
  });

  it('serializes TTS settings autosaves through a latest-snapshot queue', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain('pendingTtsSaveRef');
    expect(SETTINGS_PAGE_SOURCE).toContain('ttsSaveInFlightRef');
    expect(SETTINGS_PAGE_SOURCE).toContain('saveMutation.mutateAsync(snapshot)');
    expect(SETTINGS_PAGE_SOURCE).toContain('queueTtsSave(next)');
  });
});

describe('MODELS_BY_PROVIDER', () => {
  it('contains no deprecated model IDs', () => {
    const allModelIds = Object.values(MODELS_BY_PROVIDER).flatMap(p => p.models.map(m => m.id));
    const found = DEPRECATED_MODEL_IDS.filter(dep => allModelIds.includes(dep as never));
    expect(found).toEqual([]);
  });
});


describe('buildMiniMaxFormData', () => {
  it('applies MiniMax providers and overrides', () => {
    const result = buildMiniMaxFormData(null, MINIMAX_DEFAULTS);
    expect(result.models.providers.minimax).toBe(true);
    expect(result.models.providers.anthropic).toBe(false);
    expect(result.models.overrides['legacy.route']).toBe('minimax-m2.7-highspeed');
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

  it('preserves existing TTS settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      tts: { enabled: true, volume: 0.6, rate: 1.2, maxChars: 200, dropInfoWhenFull: false },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.tts).toEqual(existing.tts);
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

  it('anthropic can be set to false — MiniMax preset sets anthropic=false', () => {
    // Regression: ProviderPanel previously hard-locked anthropic=true in the UI.
    // The backend (getMiniMaxDefaultsApi) and this preset both set anthropic=false.
    // This test verifies the SettingsConfig type allows anthropic=false and that
    // buildMiniMaxFormData correctly propagates it.
    const result = buildMiniMaxFormData(null, MINIMAX_DEFAULTS);
    expect(result.models.providers.anthropic).toBe(false);
    expect(result.models.providers.minimax).toBe(true);
  });

});
