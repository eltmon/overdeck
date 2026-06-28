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
      mimo: false,
      openrouter: false,
      nous: false,
      dashscope: false,
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
const AUTOSAVE_PIPELINE_SOURCE = readFileSync(
  resolve(fileURLToPath(import.meta.url), '../../hooks/useAutosavePipeline.ts'),
  'utf8',
);
const CONVERSATION_SEARCH_HOOK_SOURCE = readFileSync(
  resolve(fileURLToPath(import.meta.url), '../../hooks/useConversationSearch.ts'),
  'utf8',
);
const CONVERSATION_SEARCH_SECTION_SOURCE = readFileSync(
  resolve(fileURLToPath(import.meta.url), '../../sections/ConversationSearchSection.tsx'),
  'utf8',
);
const PROVIDER_MANAGEMENT_SECTION_SOURCE = readFileSync(
  resolve(fileURLToPath(import.meta.url), '../../sections/ProviderManagementSection.tsx'),
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

  it('serializes all settings autosaves through one latest-snapshot queue', () => {
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('pendingSaveRef = useRef<AutosavePayload | null>(null)');
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('saveInFlightRef');
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('const drainSaveQueue = useCallback');
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('const scheduleAutosave = useCallback');
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('const flushAutosave = useCallback');
  });

  it('autosaves every control — no global Save/Reset buttons', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain('status={saveStatus}');
    expect(SETTINGS_PAGE_SOURCE).not.toContain('onSave={');
    expect(SETTINGS_PAGE_SOURCE).not.toContain('onReset={');
    expect(SETTINGS_PAGE_SOURCE).not.toContain('hasChanges');
    // Draft-style handlers now persist through the autosave pipeline.
    expect(SETTINGS_PAGE_SOURCE).toContain('const applySettings = (next: SettingsConfig');
    expect(SETTINGS_PAGE_SOURCE).toContain('const applyVoiceSettings = (next: VoiceSettings');
    // Text-input handlers debounce; click handlers save immediately.
    expect(SETTINGS_PAGE_SOURCE).toContain("}, { debounce: true });");
    // Deprecated-model migration kept its own explicit action.
    expect(SETTINGS_PAGE_SOURCE).toContain('Migrate now');
  });

  it('debounces high-frequency autosaves', () => {
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('const AUTOSAVE_DEBOUNCE_MS = 600');
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)');
    expect(AUTOSAVE_PIPELINE_SOURCE).toContain('setTimeout(() => {');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ volume: Number(e.target.value) }, { debounce: true })');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ rate: Number(e.target.value) }, { debounce: true })');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleTtsConfigChange({ maxChars: Number(e.target.value) }, { debounce: true })');
  });

  it('surfaces remote work-agent provisioning controls', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain("{ id: 'remote', label: 'Remote'");
    expect(SETTINGS_PAGE_SOURCE).toContain('id="remote"');
    expect(SETTINGS_PAGE_SOURCE).toContain('Resiliency tier');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleRemoteResiliencyTierChange');
    expect(SETTINGS_PAGE_SOURCE).toContain('Max concurrent remote agents');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleRemoteMaxConcurrentAgentsChange');
  });

  it('surfaces conversation search controls', () => {
    expect(CONVERSATION_SEARCH_SECTION_SOURCE).toContain('Conversation Search');
    expect(CONVERSATION_SEARCH_SECTION_SOURCE).toContain('aria-label="Toggle conversation search"');
    // cee57d395: conversation search uses the standard API Keys section now.
    expect(CONVERSATION_SEARCH_SECTION_SOURCE).toContain('Using OpenAI key from API Keys section');
    expect(CONVERSATION_SEARCH_SECTION_SOURCE).toContain('No OpenAI key set — configure in API Keys above');
    expect(CONVERSATION_SEARCH_SECTION_SOURCE).toContain('Last indexed:');
    expect(CONVERSATION_SEARCH_SECTION_SOURCE).toContain('Estimated reindex cost:');
    expect(CONVERSATION_SEARCH_SECTION_SOURCE).toContain('Estimate & reindex all conversations');
    // window.confirm was replaced by the confirm-modal + confirmationNonce flow
    // (reindex is a paid operation — server requires the nonce from the estimate).
    expect(SETTINGS_PAGE_SOURCE).toContain('confirmReindex');
    expect(CONVERSATION_SEARCH_HOOK_SOURCE).toContain('confirmationNonce');
  });

  it('surfaces memory settings, feature toggles, and environment override precedence', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain("{ id: 'memory', label: 'Memory'");
    expect(SETTINGS_PAGE_SOURCE).toContain('OVERDECK_MEMORY_PROVIDER and OVERDECK_MEMORY_MODEL override these UI values');
    expect(SETTINGS_PAGE_SOURCE).toContain('Extraction provider');
    expect(SETTINGS_PAGE_SOURCE).toContain('Fallback provider');
    expect(SETTINGS_PAGE_SOURCE).toContain('Daily cost cap');
    expect(SETTINGS_PAGE_SOURCE).toContain('0 disables the cap');
    expect(SETTINGS_PAGE_SOURCE).toContain('aria-label="Disable memory observations"');
    expect(SETTINGS_PAGE_SOURCE).toContain('aria-label="Toggle prompt-time memory injection"');
    expect(SETTINGS_PAGE_SOURCE).toContain('Rollup threshold');
    expect(SETTINGS_PAGE_SOURCE).toContain('Sidebar refresh interval');
  });

  it('renders provider harness selects as clearable built-in defaults', () => {
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain("const providerHarness = formData.models.provider_harnesses?.[provider.id] ?? ''");
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('const builtInHarness = formData.models.provider_default_harnesses?.[provider.id]');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('<ProviderLogo provider={provider.id}');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('<HarnessLogo harness={(providerHarness || builtInHarness) as Harness}');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('<ProviderLogo provider="openrouter"');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('formData.models.provider_harnesses?.openrouter || formData.models.provider_default_harnesses?.openrouter');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('<option value="">Default ({harnessLabel(builtInHarness)})</option>');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain("value={formData.models.provider_harnesses?.openrouter ?? ''}");
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain("Default ({harnessLabel(formData.models.provider_default_harnesses?.openrouter ?? 'claude-code')})");
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).not.toContain('icon: Lightbulb');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).not.toContain('<provider.icon');
  });

  it('deletes provider harness override keys when the Default option is selected', () => {
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain("if (harness === '')");
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('delete nextProviderHarnesses[provider]');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('provider_harnesses: nextProviderHarnesses');
  });

  it('surfaces the RTK Bash compression toggle in experimental settings', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain('RTK Bash compression');
    expect(SETTINGS_PAGE_SOURCE).toContain('aria-label="Enable RTK Bash compression"');
    expect(SETTINGS_PAGE_SOURCE).toContain('data-testid="experimental-rtk-toggle"');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleRtkToggle(!formData.agents?.rtk?.enabled)');
  });

  it('surfaces the Streamdown renderer toggle in experimental settings', () => {
    expect(SETTINGS_PAGE_SOURCE).toContain('Streamdown renderer');
    expect(SETTINGS_PAGE_SOURCE).toContain('Render chat markdown with Streamdown — research preview');
    expect(SETTINGS_PAGE_SOURCE).toContain('aria-label="Render chat markdown with Streamdown"');
    expect(SETTINGS_PAGE_SOURCE).toContain('data-testid="experimental-streamdown-toggle"');
    expect(SETTINGS_PAGE_SOURCE).toContain('handleStreamdownToggle(!formData.experimental?.streamdownRenderer)');
  });

  it('surfaces the harness/model permutations toggle in provider settings', () => {
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('Show all harness/model permutations');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('data-testid="show-harness-model-permutations-toggle"');
    expect(SETTINGS_PAGE_SOURCE).toContain('onHarnessModelPermutationsToggle={handleHarnessModelPermutationsToggle}');
    expect(PROVIDER_MANAGEMENT_SECTION_SOURCE).toContain('onHarnessModelPermutationsToggle(!formData.experimental?.showHarnessModelPermutations)');
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
      conversations: { compaction_model: 'claude-haiku-4-5', manual_compact_mode: 'overdeck-native', rich_compaction: true },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.conversations?.compaction_model).toBe('claude-haiku-4-5');
    expect(result.conversations?.manual_compact_mode).toBe('overdeck-native');
    expect(result.conversations?.rich_compaction).toBe(true);
  });

  it('preserves existing conversation search settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      conversationSearch: { enabled: true, provider: 'openai', model: 'text-embedding-3-large', apiKeyRef: 'OPENAI_SEARCH_KEY' },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.conversationSearch).toEqual(existing.conversationSearch);
  });

  it('preserves existing tmux settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      tmux: { config_mode: 'inherit-user' },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.tmux?.config_mode).toBe('inherit-user');
  });

  it('preserves existing memory settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      memory: { provider: 'cliproxy', model: 'gpt-4.1-nano', per_day_cost_cap_usd: 0 },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.memory).toEqual({ provider: 'cliproxy', model: 'gpt-4.1-nano', per_day_cost_cap_usd: 0 });
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

  it('preserves existing agent settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      agents: { rtk: { enabled: true } },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.agents?.rtk?.enabled).toBe(true);
  });

  it('preserves existing remote settings from formData', () => {
    const existing: SettingsConfig = {
      ...MINIMAX_DEFAULTS,
      remote: { resiliency_tier: 'durable', max_concurrent_agents: 5 },
    };
    const result = buildMiniMaxFormData(existing, MINIMAX_DEFAULTS);
    expect(result.remote).toEqual({ resiliency_tier: 'durable', max_concurrent_agents: 5 });
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
