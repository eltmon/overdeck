import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  Beaker,
  Eye,
  Brain,
  AlertTriangle,
  Flag,
  RefreshCw,
  ShieldCheck,
  Gauge,
  Globe,
} from 'lucide-react';
import { SettingsConfig, ModelId, type BackgroundAiConfig, type VoiceHardwareSettings, type VoiceSettings, BACKGROUND_AI_FEATURE_META } from './types';
import { consumePendingSettingsSection, SETTINGS_SECTION_EVENT } from '../../lib/settingsSection';
import { useUIPreferences } from '../../hooks/useUIPreferences';
import { useDiffPreferences } from '../../hooks/useDiffPreferences';
import { useCodexAuthStatus } from '../../hooks/useCodexAuthStatus';
import { DesktopSettingsSection } from './DesktopSettingsSection';
import { WorkhorsePanel } from './WorkhorsePanel';
import { RolesPanel } from './RolesPanel';
import { VoiceSettingsSection } from './sections/VoiceSettingsSection';
import { ConversationSearchSection } from './sections/ConversationSearchSection';
import { ConversationSettingsSection } from './sections/ConversationSettingsSection';
import { ProviderManagementSection } from './sections/ProviderManagementSection';
import { TtsConfigurationSection } from './sections/TtsConfigurationSection';
import { MODELS_BY_PROVIDER, type OpenRouterFavoriteModel } from './modelCatalog';
import { LegacyImportDialog } from './LegacyImportDialog';
import {
  SettingsLayout,
  SettingsHeader,
  SettingsSidebarNav,
} from './primitives';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../lib/wsTransport';
import { AUTOSAVE_DEBOUNCE_MS, useAutosavePipeline } from './hooks/useAutosavePipeline';
import { useConversationSearch } from './hooks/useConversationSearch';
import { EMBEDDING_MODELS_BY_PROVIDER } from './embeddingModels';
import { type CloisterConfig, type OpenRouterCatalogResponse, type SaveSettingsResponse } from './SettingsPage.types';
import { loadVoiceHardwareSettings, normalizeVoiceSettings, VOICE_HARDWARE_STORAGE_KEY } from './voiceSettingsDefaults';
import { buildMiniMaxFormData } from './miniMaxFormData';
import { BG_FEATURE_COST_SOURCE, SETTINGS_NAV_ITEMS, TRACKERS, type TrackerType } from './settingsPageConstants';

export { buildMiniMaxFormData } from './miniMaxFormData';

async function fetchOpenRouterCatalog(): Promise<OpenRouterCatalogResponse | null> {
  try {
    const res = await fetch('/api/settings/openrouter/models');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// API Functions
async function fetchSettings(): Promise<SettingsConfig> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

async function saveSettings(settings: SettingsConfig): Promise<SaveSettingsResponse> {
  // PAN-1048 review feedback 004 (C4): WorkhorsePanel and RolesPanel save
  // workhorses + roles via their own PUTs. SettingsPage's parent formData is
  // populated once on mount and never refreshed, so a top-level save would
  // ship a stale workhorses/roles snapshot and silently undo every model-routing
  // change the user made through the child panels in this session.
  // Refetch before each PUT and overlay the latest workhorses/roles on top
  // of the parent's edits — those are the two slices the child panels own.
  let merged: SettingsConfig = settings;
  try {
    const latest = await fetchSettings();
    // workhorses + roles live on the API payload but are not modelled on
    // SettingsConfig — child panels (WorkhorsePanel, RolesPanel) own those
    // slices and PUT them directly through their own typed payloads, so the
    // parent only needs to carry them through opaquely without losing them.
    const latestRouting = latest as unknown as {
      workhorses?: unknown;
      roles?: unknown;
    };
    const parentConversationPatch: SettingsConfig['conversations'] = {
      ...(settings.conversations?.compaction_model !== undefined
        ? { compaction_model: settings.conversations.compaction_model }
        : {}),
      ...(settings.conversations?.manual_compact_mode !== undefined
        ? { manual_compact_mode: settings.conversations.manual_compact_mode }
        : {}),
      ...(settings.conversations?.rich_compaction !== undefined
        ? { rich_compaction: settings.conversations.rich_compaction }
        : {}),
      ...(settings.conversations?.title_model !== undefined
        ? { title_model: settings.conversations.title_model }
        : {}),
      // Background AI section edits these through the parent too; the embedding
      // card syncs its own saves back into parent formData, so the parent's
      // values are never stale for them (PAN-1589).
      ...(settings.conversations?.enrichment !== undefined
        ? { enrichment: settings.conversations.enrichment }
        : {}),
      ...(settings.conversations?.embeddings !== undefined
        ? { embeddings: settings.conversations.embeddings }
        : {}),
      ...(settings.conversations?.embedding_provider !== undefined
        ? { embedding_provider: settings.conversations.embedding_provider }
        : {}),
      ...(settings.conversations?.embedding_model !== undefined
        ? { embedding_model: settings.conversations.embedding_model }
        : {}),
      ...(settings.conversations?.embedding_auto_on_deep !== undefined
        ? { embedding_auto_on_deep: settings.conversations.embedding_auto_on_deep }
        : {}),
    };
    merged = {
      ...settings,
      conversations: {
        ...latest.conversations,
        ...parentConversationPatch,
      },
      ...(latestRouting.workhorses !== undefined
        ? { workhorses: latestRouting.workhorses }
        : {}),
      ...(latestRouting.roles !== undefined
        ? { roles: latestRouting.roles }
        : {}),
    } as SettingsConfig;
  } catch (err) {
    // Non-fatal — fall back to the parent's payload rather than blocking the
    // save. The user gets the same overwrite semantics the bug surfaced, but
    // only when the GET also fails (which would already be a bigger problem).
    console.warn('[settings] Pre-save refetch failed; saving parent payload as-is:', err);
  }
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(merged),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to save settings');
  }
  return res.json();
}

async function fetchCloisterConfig(): Promise<CloisterConfig> {
  const res = await fetch('/api/cloister/config', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch Cloister config');
  return res.json();
}

async function saveCloisterConfig(config: CloisterConfig): Promise<void> {
  await ensureDashboardSession();
  const res = await fetch('/api/cloister/config', {
    method: 'PUT',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save Cloister config (${res.status})`);
  }
}

async function fetchVoiceSettings(): Promise<VoiceSettings> {
  const res = await fetch('/api/voice/settings');
  if (!res.ok) throw new Error('Failed to fetch voice settings');
  return normalizeVoiceSettings(await res.json() as Partial<VoiceSettings>);
}

async function saveVoiceSettings(settings: VoiceSettings): Promise<VoiceSettings> {
  const res = await fetch('/api/voice/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to save voice settings');
  }
  return res.json();
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { prefs: uiPrefs, update: updateUIPrefs } = useUIPreferences();
  const { prefs: diffPrefs, update: updateDiffPrefs } = useDiffPreferences();
  const { data: codexAuth } = useCodexAuthStatus();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });
  const {
    data: cloisterConfig,
    error: cloisterConfigError,
  } = useQuery({
    queryKey: ['cloister-config'],
    queryFn: fetchCloisterConfig,
  });
  // Last-24h spend per background-AI source, for the Background AI section (PAN-1589).
  const { data: backgroundCost } = useQuery({
    queryKey: ['costs-background'],
    queryFn: async (): Promise<{ hours: number; bySource: Record<string, number> }> => {
      const res = await fetch('/api/costs/background');
      if (!res.ok) return { hours: 24, bySource: {} };
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const {
    data: voiceSettings,
    isLoading: voiceSettingsLoading,
    error: voiceSettingsError,
  } = useQuery({
    queryKey: ['voice-settings'],
    queryFn: fetchVoiceSettings,
  });

  const [formData, setFormData] = useState<SettingsConfig | null>(null);
  const [cloisterFormData, setCloisterFormData] = useState<CloisterConfig | null>(null);
  const [voiceFormData, setVoiceFormData] = useState<VoiceSettings | null>(null);
  const [voiceHardwareSettings, setVoiceHardwareSettings] = useState<VoiceHardwareSettings>(loadVoiceHardwareSettings);
  const [showTrackerKey, setShowTrackerKey] = useState<Record<string, boolean>>({});
  const [orCatalog, setOrCatalog] = useState<OpenRouterCatalogResponse | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [reloadingTldr, setReloadingTldr] = useState(false);
  const [claudeAuth, setClaudeAuth] = useState<{
    installed: boolean;
    loggedIn: boolean;
    expired: boolean;
    subscriptionType: string | null;
    rateLimitTier: string | null;
    expiresAt: number | null;
    hasAnthropicApiKey: boolean;
  } | null>(null);
  const [activeSection, setActiveSection] = useState('model-routing');
  const {
    cloisterSaveDebounceRef,
    flushAutosave,
    markSaveError,
    markSaved,
    saveStatus,
    scheduleAutosave,
    setSaveStatus,
  } = useAutosavePipeline({
    queryClient,
    saveSettings,
    saveVoiceSettings,
  });
  const {
    cancelReindexConfirm,
    confirmReindex,
    conversationSearch,
    conversationSearchEnabled,
    conversationSearchEstimate,
    conversationSearchModel,
    conversationSearchReindexPending,
    conversationSearchStatus,
    convConfig,
    convConfigDirty,
    convConfigError,
    convConfigLoading,
    convConfigSaving,
    embeddingTestResult,
    estimatingConversationSearch,
    handleConvConfigChange,
    handleConversationSearchChange,
    handleConversationSearchReindex,
    handleEmbeddingModelChange,
    handleSaveConvConfig,
    handleTestEmbeddingConnection,
    legacyImportOpen,
    loadConvConfig,
    reindexConfirm,
    reindexConfirmBusy,
    reindexProgress,
    setLegacyImportOpen,
    testingEmbedding,
  } = useConversationSearch({
    formData,
    voiceFormData,
    setFormData,
    scheduleAutosave,
    flushAutosave,
  });

  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id);
    // Two problems to handle: (1) on a fresh navigation the section may not be
    // mounted on the first frame; (2) sections above the target (model lists,
    // TTS voice library, memory) load async and reflow the page for ~1.5s AFTER
    // the first scroll — a single smooth scroll then undershoots by hundreds of
    // px and lands short of the section (PAN-1600 follow-up). So keep re-aligning
    // until scrolling no longer moves the section, i.e. it's aligned and the
    // page has stopped reflowing.
    let tries = 0;
    let stable = 0;
    const step = () => {
      const el = document.getElementById(id);
      if (!el) {
        if (tries++ < 40) setTimeout(step, 50);
        return;
      }
      const before = Math.round(el.getBoundingClientRect().top);
      el.scrollIntoView({ behavior: tries === 0 ? 'smooth' : 'auto', block: 'start' });
      const after = Math.round(el.getBoundingClientRect().top);
      // Aligned + settled once an instant re-scroll no longer moves the section.
      stable = tries > 0 && Math.abs(after - before) <= 2 ? stable + 1 : 0;
      if (stable < 2 && tries++ < 60) setTimeout(step, 120);
    };
    step();
  }, []);

  // Deep-link from other surfaces (e.g. the app-bar Low-cost mode pill). Handles
  // both cases: navigated-then-mounted (consume the pending intent on mount) and
  // already-open (react to the live event) — PAN-1600.
  useEffect(() => {
    const pending = consumePendingSettingsSection();
    if (pending) scrollToSection(pending);
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) scrollToSection(id);
    };
    window.addEventListener(SETTINGS_SECTION_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_SECTION_EVENT, handler);
  }, [scrollToSection]);

  const fetchClaudeAuth = async () => {
    try {
      const res = await fetch('/api/settings/claude-auth');
      if (res.ok) setClaudeAuth(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { void fetchClaudeAuth(); }, []);

  useEffect(() => {
    fetchOpenRouterCatalog().then(setOrCatalog);
  }, []);

  const openRouterFavoriteModels = useMemo<OpenRouterFavoriteModel[]>(() => {
    if (!orCatalog) return [];
    return orCatalog.models
      .filter((m) => orCatalog.favorites.includes(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        promptCostPer1M: m.promptCostPer1M,
        completionCostPer1M: m.completionCostPer1M,
        contextLength: m.contextLength,
        supportsThinking: m.supportsThinking,
        category: m.category,
      }));
  }, [orCatalog]);

  useEffect(() => {
    if (settings && !formData) {
      setFormData(settings);
      // Show toast for deprecation warnings
      if (settings.deprecation_warnings && settings.deprecation_warnings.length > 0) {
        const count = settings.deprecation_warnings.length;
        toast.warning(
          `${count} deprecated model${count > 1 ? 's' : ''} detected. Click "Migrate now" in the Settings banner to update them.`,
          { duration: 10000 }
        );
      }
    }
  }, [settings, formData]);

  useEffect(() => {
    if (cloisterConfig && !cloisterFormData) {
      setCloisterFormData(cloisterConfig);
    }
  }, [cloisterConfig, cloisterFormData]);

  useEffect(() => {
    if (voiceSettings && !voiceFormData) {
      setVoiceFormData(voiceSettings);
    }
  }, [voiceSettings, voiceFormData]);

  useEffect(() => {
    window.localStorage.setItem(VOICE_HARDWARE_STORAGE_KEY, JSON.stringify(voiceHardwareSettings));
  }, [voiceHardwareSettings]);

  // Shared chat-model <option> list (same catalog as the Conversations selects).
  // MUST be declared before the early returns below — it's a hook (PAN-1597 fix:
  // a misplaced useMemo here caused React error #310 / hooks-order violation that
  // crashed the entire Settings page).
  const chatModelOptionEls = useMemo(() => [
    ...Object.entries(MODELS_BY_PROVIDER).flatMap(([, providerDef]) =>
      providerDef.models.map((model) => (
        <option key={model.id} value={model.id}>{providerDef.name} — {model.name}</option>
      )),
    ),
    ...openRouterFavoriteModels.map((model) => (
      <option key={model.id} value={model.id}>OpenRouter — {model.name}</option>
    )),
  ], [openRouterFavoriteModels]);

  if (isLoading || voiceSettingsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error || voiceSettingsError || !formData || !voiceFormData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">
          Error: {(error as Error)?.message || (voiceSettingsError as Error)?.message || 'Failed to load settings'}
        </div>
      </div>
    );
  }

  // Apply a settings patch and autosave it. Pass debounce for text inputs and
  // sliders; click-style controls save immediately.
  const applySettings = (next: SettingsConfig, opts: { debounce?: boolean } = {}) => {
    setFormData(next);
    scheduleAutosave({ settings: next, voiceSettings: voiceFormData }, opts);
  };

  const applyVoiceSettings = (next: VoiceSettings, opts: { debounce?: boolean } = {}) => {
    setVoiceFormData(next);
    scheduleAutosave({ settings: formData, voiceSettings: next }, opts);
  };

  const handleTrackerKeyChange = (tracker: TrackerType, key: string) => {
    applySettings({
      ...formData,
      tracker_keys: {
        ...formData.tracker_keys,
        [tracker]: key || undefined,
      },
    }, { debounce: true });
  };

  const handleTmuxConfigModeChange = (configMode: 'managed' | 'inherit-user') => {
    applySettings({
      ...formData,
      tmux: {
        ...formData.tmux,
        config_mode: configMode,
      },
    });
  };

  const handleRemoteResiliencyTierChange = (tier: 'ephemeral' | 'durable') => {
    applySettings({
      ...formData,
      remote: {
        ...formData.remote,
        resiliency_tier: tier,
      },
    });
  };

  const handleRemoteMaxConcurrentAgentsChange = (value: string) => {
    const num = value === '' ? undefined : Number(value);
    applySettings({
      ...formData,
      remote: {
        ...formData.remote,
        max_concurrent_agents: num,
      },
    }, { debounce: true });
  };

  const updateMemorySettings = (memory: NonNullable<SettingsConfig['memory']>, opts: { debounce?: boolean } = {}) => {
    applySettings({
      ...formData,
      memory: {
        ...formData.memory,
        ...memory,
      },
    }, opts);
  };

  const handleMemoryNumberChange = (
    key: 'per_day_cost_cap_usd' | 'rollup_pending_threshold' | 'sidebar_refresh_interval_ms' | 'worker_concurrency',
    value: string,
  ) => {
    updateMemorySettings({ [key]: value === '' ? undefined : Number(value) }, { debounce: true });
  };

  const saveCloisterSnapshot = async (snapshot: CloisterConfig) => {
    setSaveStatus('saving');
    try {
      await saveCloisterConfig(snapshot);
      queryClient.setQueryData(['cloister-config'], snapshot);
      queryClient.invalidateQueries({ queryKey: ['cloister-config'] });
      markSaved();
    } catch (error) {
      markSaveError();
      toast.error(`Failed to save Cloister settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const updateCloisterConcurrency = (
    key: 'max_work_agents' | 'reserved_advancing_slots',
    rawValue: string,
  ) => {
    if (!cloisterFormData) return;
    const next: CloisterConfig = {
      ...cloisterFormData,
      concurrency: {
        ...cloisterFormData.concurrency,
        [key]: rawValue === '' ? undefined : Number(rawValue),
      },
    };
    setCloisterFormData(next);
    if (cloisterSaveDebounceRef.current) {
      clearTimeout(cloisterSaveDebounceRef.current);
      cloisterSaveDebounceRef.current = null;
    }
    cloisterSaveDebounceRef.current = setTimeout(() => {
      cloisterSaveDebounceRef.current = null;
      void saveCloisterSnapshot(next);
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  // Background AI toggles persist immediately (one-click low-cost mode).
  const updateBackgroundAi = (patch: BackgroundAiConfig) => {
    if (!formData) return;
    applySettings({
      ...formData,
      background_ai: {
        cheap_mode: patch.cheap_mode ?? formData.background_ai?.cheap_mode ?? false,
        features: {
          ...formData.background_ai?.features,
          ...patch.features,
        },
      },
    });
  };

  // Apply an arbitrary settings patch and persist (used by the per-feature
  // model pickers in the Background AI section — PAN-1589).
  const applyBackgroundModelPatch = (next: SettingsConfig, opts: { debounce?: boolean } = {}) => {
    applySettings(next, opts);
  };

  const bgSelectClass = 'bg-background border border-border rounded-md px-2 py-1 text-[11px] text-foreground focus:ring-1 focus:ring-primary';

  // Render the model control for one background feature. Heterogeneous: chat
  // features use the chat-model select; memory uses provider+model; embeddings
  // use a dedicated provider+embedding-model picker; TTS edits its own model.
  const backgroundModelControl = (key: BackgroundAiFeature) => {
    const setConv = (patch: NonNullable<SettingsConfig['conversations']>) =>
      applyBackgroundModelPatch({ ...formData!, conversations: { ...formData!.conversations, ...patch } });
    switch (key) {
      case 'conversationTitles':
      case 'titleRefinement':
        return (
          <select value={formData?.conversations?.title_model || 'claude-haiku-4-5'}
            onChange={(e) => setConv({ title_model: e.target.value as ModelId })} className={`${bgSelectClass} max-w-[180px]`}>
            {chatModelOptionEls}
          </select>
        );
      case 'summaryFork':
        return (
          <select value={formData?.conversations?.compaction_model || 'claude-haiku-4-5'}
            onChange={(e) => setConv({ compaction_model: e.target.value as ModelId })} className={`${bgSelectClass} max-w-[180px]`}>
            {chatModelOptionEls}
          </select>
        );
      case 'conversationEnrichment':
        return (
          <select value={formData?.conversations?.enrichment?.quick_model || ''}
            onChange={(e) => setConv({ enrichment: { ...formData?.conversations?.enrichment, quick_model: e.target.value || null } })}
            className={`${bgSelectClass} max-w-[180px]`}>
            <option value="">Auto (tier default)</option>
            {chatModelOptionEls}
          </select>
        );
      case 'memoryExtraction':
      case 'memoryQueryExpansion': {
        const provider = formData?.memory?.provider || 'anthropic';
        const setMem = (patch: NonNullable<SettingsConfig['memory']>, opts: { debounce?: boolean } = {}) =>
          applyBackgroundModelPatch({ ...formData!, memory: { ...formData!.memory, ...patch } }, opts);
        return (
          <div className="flex items-center gap-1">
            <select value={provider} onChange={(e) => setMem({ provider: e.target.value as 'anthropic' | 'cliproxy' })} className={`${bgSelectClass} max-w-[110px]`}>
              <option value="anthropic">Anthropic</option>
              <option value="cliproxy">cliproxy</option>
            </select>
            <input type="text" value={formData?.memory?.model || ''}
              onChange={(e) => setMem({ model: e.target.value || undefined }, { debounce: true })}
              placeholder={provider === 'cliproxy' ? 'gpt-4.1-nano' : 'claude-haiku-4-5-20251001'}
              className="w-36 bg-background border border-border rounded-md px-2 py-1 text-[11px] font-mono text-foreground focus:ring-1 focus:ring-primary" />
          </div>
        );
      }
      case 'sessionEmbeddings': {
        const provider = formData?.conversations?.embedding_provider || 'openai';
        const models = EMBEDDING_MODELS_BY_PROVIDER[provider] ?? [];
        const model = formData?.conversations?.embedding_model || models[0]?.id || '';
        return (
          <div className="flex items-center gap-1">
            <select value={provider}
              onChange={(e) => { const p = e.target.value as 'openai' | 'voyage' | 'ollama'; setConv({ embedding_provider: p, embedding_model: EMBEDDING_MODELS_BY_PROVIDER[p]?.[0]?.id }); }}
              className={`${bgSelectClass} max-w-[100px]`}>
              <option value="openai">OpenAI</option>
              <option value="voyage">Voyage</option>
              <option value="ollama">Ollama</option>
            </select>
            <select value={model} onChange={(e) => setConv({ embedding_model: e.target.value })} className={`${bgSelectClass} max-w-[170px]`}>
              {models.map((m) => <option key={m.id} value={m.id} title={m.description}>{m.label}</option>)}
            </select>
          </div>
        );
      }
      case 'ttsSummarizer':
        return (
          <select value={formData?.tts_summarizer?.model || 'gpt-5.4-mini'}
            onChange={(e) => applyBackgroundModelPatch({ ...formData!, tts_summarizer: { ...formData!.tts_summarizer, model: e.target.value as ModelId } })}
            className={`${bgSelectClass} max-w-[180px]`}>
            {chatModelOptionEls}
          </select>
        );
      default:
        return null;
    }
  };

  const handleClaudeCodeChannelsToggle = (enabled: boolean) => {
    applySettings({
      ...formData,
      experimental: {
        ...formData.experimental,
        claudeCodeChannels: enabled,
      },
    });
  };

  const handleExperimentalFeaturesToggle = (enabled: boolean) => {
    applySettings({
      ...formData,
      experimental: {
        ...formData.experimental,
        experimentalFeatures: enabled,
      },
    });
  };

  const handleStreamdownToggle = (enabled: boolean) => {
    applySettings({
      ...formData,
      experimental: {
        ...formData.experimental,
        streamdownRenderer: enabled,
      },
    });
  };

  const handleHarnessModelPermutationsToggle = (enabled: boolean) => {
    applySettings({
      ...formData,
      experimental: {
        ...formData.experimental,
        showHarnessModelPermutations: enabled,
      },
    });
  };

  const handleRtkToggle = (enabled: boolean) => {
    applySettings({
      ...formData,
      agents: {
        ...formData.agents,
        rtk: {
          ...formData.agents?.rtk,
          enabled,
        },
      },
    });
  };

  const handleTldrToggle = (enabled: boolean) => {
    applySettings({
      ...formData,
      agents: {
        ...formData.agents,
        tldr: {
          ...formData.agents?.tldr,
          enabled,
        },
      },
    });
  };

  const handlePermissionModeChange = (mode: 'auto' | 'bypass') => {
    applySettings({
      ...formData,
      claude: {
        ...formData.claude,
        permissionMode: mode,
      },
    });
  };

  const handleCodexPermissionModeChange = (mode: 'read-only' | 'workspace' | 'auto-review' | 'full-access') => {
    applySettings({
      ...formData,
      codex: {
        ...formData.codex,
        permissionMode: mode,
      },
    });
  };


  return (
    <SettingsLayout
      header={
        <SettingsHeader
          title="Settings"
          status={saveStatus}
        />
      }
      sidebar={
        <SettingsSidebarNav
          items={SETTINGS_NAV_ITEMS}
          activeId={activeSection}
          onSelect={scrollToSection}
        />
      }
    >
      {/* Deprecation Warning Banner */}
      {formData.deprecation_warnings && formData.deprecation_warnings.length > 0 && (
        <div className="bg-warning/10 border border-warning/25 rounded-lg px-4 py-3 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-warning text-sm font-medium mb-1">
                Deprecated model IDs detected
              </p>
              <div className="space-y-0.5">
                {formData.deprecation_warnings.map((warning, idx) => (
                  <p key={idx} className="text-muted-foreground text-xs">
                    <code className="font-mono">{warning.workType}</code>
                    {': '}
                    <code className="font-mono line-through">{warning.from}</code>
                    {' → '}
                    <code className="font-mono">{warning.to}</code>
                  </p>
                ))}
              </div>
              <button
                type="button"
                onClick={() => scheduleAutosave({ settings: formData, voiceSettings: voiceFormData })}
                className="mt-2 px-3 py-1 text-xs font-medium rounded-md bg-warning/20 text-warning hover:bg-warning/30 transition-colors"
              >
                Migrate now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Model Routing */}
      <section id="model-routing" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Model Routing
        </h2>

        <WorkhorsePanel />
        <RolesPanel />
      </section>

      <ProviderManagementSection
        claudeAuth={claudeAuth}
        codexAuth={codexAuth}
        formData={formData}
        onHarnessModelPermutationsToggle={handleHarnessModelPermutationsToggle}
        onOpenRouterApiKeySaved={(savedKey) => {
          setFormData(prev => prev ? {
            ...prev,
            api_keys: { ...prev.api_keys, openrouter: savedKey },
          } : prev);
        }}
        onSettingsChange={applySettings}
      />

      {/* Permissions — controls what flags get passed to spawned agents */}
      <section id="permissions" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          Permissions
        </h2>
        <p className="text-xs text-muted-foreground mb-6">
          How spawned agents are gated, configured per harness. Applies to work agents, specialists,
          conversations, and remote agents.
        </p>

        {/* Claude Code */}
        <div className="mb-6">
          <p className="text-xs font-medium text-foreground mb-1">Claude Code</p>
          <p className="text-xs text-muted-foreground mb-3">
            Override per-invocation with{' '}
            <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">--yolo</code>,{' '}
            <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">--no-yolo</code>, or{' '}
            <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">PAN_YOLO</code>.
          </p>
          <div className="space-y-2">
            {([
              {
                value: 'auto' as const,
                title: 'Auto (recommended)',
                flag: '--permission-mode auto',
                description:
                  "Claude Code's built-in classifier auto-approves safe tool calls and blocks destructive ones (force pushes, exfiltration, rm -rf, writes outside workspace). Requires skipAutoPermissionPrompt: true in ~/.claude/settings.json.",
              },
              {
                value: 'bypass' as const,
                title: 'Bypass (yolo)',
                flag: '--permission-mode bypassPermissions',
                description:
                  'Every tool call auto-approved with no classifier — fastest, but the agent can do anything its file/network access allows. Use when the classifier interferes with intentionally destructive automation.',
              },
            ]).map((opt) => {
              const selected = (formData.claude?.permissionMode ?? 'auto') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`permission-mode-${opt.value}`}
                  onClick={() => handlePermissionModeChange(opt.value)}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 ${
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-transparent hover:bg-muted/30'
                  }`}
                >
                  <span
                    className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      selected ? 'border-primary' : 'border-muted-foreground/40'
                    }`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{opt.title}</span>
                      <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {opt.flag}
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {opt.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Codex */}
        <div>
          <p className="text-xs font-medium text-foreground mb-1">Codex</p>
          <p className="text-xs text-muted-foreground mb-3">
            Applies to Codex TUI conversation sessions. Takes effect on the next resume or new conversation.
          </p>
          <div className="space-y-2">
            {([
              {
                value: 'read-only' as const,
                title: 'Read-only',
                flag: 'approval_policy=on-request + sandbox=read-only',
                description:
                  'Codex can browse files but asks before making any changes or running commands.',
              },
              {
                value: 'workspace' as const,
                title: 'Workspace',
                flag: 'approval_policy=on-request + sandbox=workspace-write',
                description:
                  'Codex works freely inside the working directory, but asks before going outside it or using the network.',
              },
              {
                value: 'auto-review' as const,
                title: 'Auto-review (recommended)',
                flag: 'approvals_reviewer=auto_review + sandbox=workspace-write',
                description:
                  'A sub-agent automatically reviews and answers approval requests instead of prompting you. Codex still runs inside the workspace sandbox — the reviewer decides whether to allow escapes.',
              },
              {
                value: 'full-access' as const,
                title: 'Full access (yolo)',
                flag: 'approval_policy=never + sandbox=danger-full-access',
                description:
                  'No approval prompts — Codex has full filesystem and network access. Use with care.',
              },
            ]).map((opt) => {
              const selected = (formData.codex?.permissionMode ?? 'auto-review') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`codex-permission-mode-${opt.value}`}
                  onClick={() => handleCodexPermissionModeChange(opt.value)}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 ${
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-transparent hover:bg-muted/30'
                  }`}
                >
                  <span
                    className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      selected ? 'border-primary' : 'border-muted-foreground/40'
                    }`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{opt.title}</span>
                      <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {opt.flag}
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {opt.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Cloister */}
      <section id="cloister" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
          <Flag className="w-4 h-4 text-muted-foreground" />
          Cloister
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Deacon dispatch limits for automatically resumed work agents and review, test, and ship specialists.
        </p>
        {cloisterConfigError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            Failed to load Cloister settings: {cloisterConfigError instanceof Error ? cloisterConfigError.message : String(cloisterConfigError)}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">Max work agents</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Running work-agent ceiling used by auto-resume before the deacon defers more work.
                </p>
              </div>
              <input
                type="number"
                min="1"
                step="1"
                disabled={!cloisterFormData}
                value={cloisterFormData?.concurrency?.max_work_agents ?? 6}
                onChange={(e) => updateCloisterConcurrency('max_work_agents', e.target.value)}
                className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">Reserved advancing slots</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Extra slots above the work cap reserved for review, test, and ship dispatch.
                </p>
              </div>
              <input
                type="number"
                min="0"
                step="1"
                disabled={!cloisterFormData}
                value={cloisterFormData?.concurrency?.reserved_advancing_slots ?? 3}
                onChange={(e) => updateCloisterConcurrency('reserved_advancing_slots', e.target.value)}
                className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </section>

      {/* Remote */}
      <section id="remote" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground" />
          Remote
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Provisioning defaults for Fly.io remote work agents.
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Resiliency tier</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Durable machines keep a persistent workspace volume; ephemeral machines are cheaper but lose state on crash.
              </p>
            </div>
            <select
              value={formData.remote?.resiliency_tier ?? 'ephemeral'}
              onChange={(e) => handleRemoteResiliencyTierChange(e.target.value as 'ephemeral' | 'durable')}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="ephemeral">Ephemeral</option>
              <option value="durable">Durable</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Max concurrent remote agents</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                0 means unlimited.
              </p>
            </div>
            <input
              type="number"
              min="0"
              step="1"
              value={formData.remote?.max_concurrent_agents ?? 0}
              onChange={(e) => handleRemoteMaxConcurrentAgentsChange(e.target.value)}
              className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </section>

      <VoiceSettingsSection
        voiceFormData={voiceFormData}
        voiceHardwareSettings={voiceHardwareSettings}
        onVoiceSettingsChange={applyVoiceSettings}
        onVoiceHardwareSettingsChange={setVoiceHardwareSettings}
      />

      <ConversationSettingsSection
        formData={formData}
        onSettingsChange={applySettings}
        openRouterFavoriteModels={openRouterFavoriteModels}
      >
        <ConversationSearchSection
          conversationSearch={conversationSearch}
          conversationSearchEnabled={conversationSearchEnabled}
          conversationSearchEstimate={conversationSearchEstimate}
          conversationSearchModel={conversationSearchModel}
          conversationSearchReindexPending={conversationSearchReindexPending}
          conversationSearchStatus={conversationSearchStatus}
          convConfig={convConfig}
          convConfigDirty={convConfigDirty}
          convConfigError={convConfigError}
          convConfigLoading={convConfigLoading}
          convConfigSaving={convConfigSaving}
          embeddingTestResult={embeddingTestResult}
          estimatingConversationSearch={estimatingConversationSearch}
          hasOpenAiKey={Boolean(formData.api_keys.openai)}
          loadConvConfig={loadConvConfig}
          reindexConfirm={reindexConfirm}
          reindexConfirmBusy={reindexConfirmBusy}
          reindexProgress={reindexProgress}
          testingEmbedding={testingEmbedding}
          onCancelReindexConfirm={cancelReindexConfirm}
          onConfirmReindex={confirmReindex}
          onConversationSearchChange={handleConversationSearchChange}
          onConversationSearchReindex={handleConversationSearchReindex}
          onConvConfigChange={handleConvConfigChange}
          onEmbeddingModelChange={handleEmbeddingModelChange}
          onSaveConvConfig={handleSaveConvConfig}
          onTestEmbeddingConnection={handleTestEmbeddingConnection}
        />
      </ConversationSettingsSection>

      {/* Memory */}
      <section id="memory" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-muted-foreground" />
          Memory
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Configure durable memory extraction, prompt-time retrieval, rollups, and activity refresh behavior.
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Extraction provider</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                OVERDECK_MEMORY_PROVIDER and OVERDECK_MEMORY_MODEL override these UI values.
              </p>
            </div>
            <select
              value={formData.memory?.provider || 'anthropic'}
              onChange={(e) => updateMemorySettings({ provider: e.target.value as 'anthropic' | 'cliproxy' })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="anthropic">Anthropic</option>
              <option value="cliproxy">cliproxy</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Extraction model</span>
              <p className="text-xs text-muted-foreground mt-0.5">Used for observations, query expansion, and status rollups unless env vars override it</p>
            </div>
            <input
              type="text"
              value={formData.memory?.model || ''}
              onChange={(e) => updateMemorySettings({ model: e.target.value || undefined }, { debounce: true })}
              placeholder={formData.memory?.provider === 'cliproxy' ? 'gpt-4.1-nano' : 'claude-haiku-4-5-20251001'}
              className="w-64 bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Fallback provider</span>
              <p className="text-xs text-muted-foreground mt-0.5">Optional single fallback target when the primary provider fails</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={formData.memory?.fallback_provider || ''}
                onChange={(e) => updateMemorySettings({ fallback_provider: e.target.value as 'anthropic' | 'cliproxy' | '' })}
                className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
              >
                <option value="">None</option>
                <option value="anthropic">Anthropic</option>
                <option value="cliproxy">cliproxy</option>
              </select>
              <input
                type="text"
                value={formData.memory?.fallback_model || ''}
                onChange={(e) => updateMemorySettings({ fallback_model: e.target.value || undefined }, { debounce: true })}
                placeholder="fallback model"
                className="w-44 bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Daily cost cap</span>
              <p className="text-xs text-muted-foreground mt-0.5">USD per project per day; 0 disables the cap</p>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.memory?.per_day_cost_cap_usd ?? 5}
              onChange={(e) => handleMemoryNumberChange('per_day_cost_cap_usd', e.target.value)}
              className="w-28 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Disable observations</span>
              <p className="text-xs text-muted-foreground mt-0.5">Stops hook and poller memory registration on the next settings read, no restart required</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!(formData.memory?.observations_enabled ?? true)}
              aria-label="Disable memory observations"
              onClick={() => updateMemorySettings({ observations_enabled: !(formData.memory?.observations_enabled ?? true) })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                !(formData.memory?.observations_enabled ?? true) ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                !(formData.memory?.observations_enabled ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Prompt-time injection</span>
              <p className="text-xs text-muted-foreground mt-0.5">Retrieve memory on user prompts using query expansion and RAG runs telemetry</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={formData.memory?.prompt_time_injection_enabled ?? true}
              aria-label="Toggle prompt-time memory injection"
              onClick={() => updateMemorySettings({ prompt_time_injection_enabled: !(formData.memory?.prompt_time_injection_enabled ?? true) })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                (formData.memory?.prompt_time_injection_enabled ?? true) ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                (formData.memory?.prompt_time_injection_enabled ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Rollup threshold</span>
              <p className="text-xs text-muted-foreground mt-0.5">Pending turns required before synthesizing workspace status</p>
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={formData.memory?.rollup_pending_threshold ?? 4}
              onChange={(e) => handleMemoryNumberChange('rollup_pending_threshold', e.target.value)}
              className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Extraction workers</span>
              <p className="text-xs text-muted-foreground mt-0.5">Maximum concurrent memory extractions across all sessions</p>
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={formData.memory?.worker_concurrency ?? 4}
              onChange={(e) => handleMemoryNumberChange('worker_concurrency', e.target.value)}
              className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Sidebar refresh interval</span>
              <p className="text-xs text-muted-foreground mt-0.5">Milliseconds between activity fallback refreshes</p>
            </div>
            <input
              type="number"
              min="1"
              step="1000"
              value={formData.memory?.sidebar_refresh_interval_ms ?? 10000}
              onChange={(e) => handleMemoryNumberChange('sidebar_refresh_interval_ms', e.target.value)}
              className="w-28 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </section>

      {/* Background AI */}
      <section id="background-ai" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          Background AI
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Automatic, behind-the-scenes model calls Overdeck makes on your behalf — conversation
          titles, memory extraction, enrichment, narration. Token spend for these is recorded in the
          cost ledger under <code className="font-mono">background:&lt;feature&gt;</code>.
        </p>
        <div className="space-y-1">
          {/* Low-cost master switch */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-muted/30 border border-border">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Low-cost mode</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                One-click switch that turns off every background AI feature below. Individual toggles
                resume when this is off.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={formData.background_ai?.cheap_mode ?? false}
              aria-label="Toggle low-cost mode"
              onClick={() => updateBackgroundAi({ cheap_mode: !(formData.background_ai?.cheap_mode ?? false) })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                (formData.background_ai?.cheap_mode ?? false) ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                (formData.background_ai?.cheap_mode ?? false) ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>

          {BACKGROUND_AI_FEATURE_META.map((feature) => {
            const cheapMode = formData.background_ai?.cheap_mode ?? false;
            const featureOn = formData.background_ai?.features?.[feature.key] ?? true;
            const effectiveOn = !cheapMode && featureOn;
            const cost24h = backgroundCost?.bySource?.[BG_FEATURE_COST_SOURCE[feature.key]];
            return (
              <div
                key={feature.key}
                className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <span className={`text-sm font-medium ${effectiveOn ? 'text-foreground' : 'text-muted-foreground'}`}>{feature.label}</span>
                  {!effectiveOn && (
                    <span
                      className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title="This feature is off, so it isn't running — but you can still change its model below; the new model takes effect when you enable it (or turn off low-cost mode)."
                    >
                      not active
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">{feature.description}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    {backgroundModelControl(feature.key)}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="font-mono tabular-nums text-[11px] text-muted-foreground w-16 text-right"
                    title="Spend over the last 24 hours"
                  >
                    {typeof cost24h === 'number' ? `$${cost24h.toFixed(2)}` : '—'}
                    <span className="block text-[9px] uppercase tracking-wide text-muted-foreground/60">24h</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={effectiveOn}
                    aria-label={`Toggle ${feature.label}`}
                    disabled={cheapMode}
                    onClick={() => updateBackgroundAi({ features: { [feature.key]: !featureOn } })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                      effectiveOn ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      effectiveOn ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 px-4">
          You can change any feature's model even while it's off (e.g. to pick a cheaper one) — the
          choice is saved and takes effect when the feature runs, but a model shown under a
          <span className="mx-1 rounded bg-muted px-1 py-0.5 font-medium">not active</span>
          feature isn't being used yet. 24h figures are actual recorded spend. Models shared between
          rows (titles + refinement, memory extraction + query expansion) edit the same setting.
        </p>
      </section>

      {/* Terminal */}
      <section id="terminal" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Terminal
        </h2>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">tmux configuration</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(formData.tmux?.config_mode || 'managed') === 'managed'
                  ? 'Using Overdeck-managed tmux socket and config'
                  : 'Inheriting your user tmux configuration'}
              </p>
            </div>
            <select
              value={formData.tmux?.config_mode || 'managed'}
              onChange={(e) => handleTmuxConfigModeChange(e.target.value as 'managed' | 'inherit-user')}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="managed">Managed</option>
              <option value="inherit-user">Inherit user</option>
            </select>
          </div>
        </div>
      </section>

      <TtsConfigurationSection
        formData={formData}
        onSettingsChange={applySettings}
      />

      {/* Tracker Keys */}
      <section id="tracker-keys" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Tracker Keys
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Override environment variables ({TRACKERS.map(t => t.envVar).join(', ')}).
        </p>
        <div className="space-y-1">
          {TRACKERS.map((tracker) => {
            const trackerKey = formData.tracker_keys?.[tracker.id] || '';

            return (
              <div key={tracker.id} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                <tracker.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{tracker.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{tracker.envVar}</span>
                  </div>
                  {trackerKey.startsWith('$') && (
                    <p className="text-[10px] text-warning mt-0.5">
                      Configured via env: <code className="font-mono">{trackerKey}</code>
                    </p>
                  )}
                </div>
                <div className="relative w-[200px] shrink-0">
                  <input
                    type={showTrackerKey[tracker.id] ? 'text' : 'password'}
                    value={trackerKey.startsWith('$') ? '' : trackerKey}
                    onChange={(e) => handleTrackerKeyChange(tracker.id, e.target.value)}
                    placeholder={trackerKey.startsWith('$') ? 'Override env value...' : tracker.placeholder}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 pr-8 text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
                  />
                  {(trackerKey && !trackerKey.startsWith('$')) && (
                    <button
                      onClick={() => setShowTrackerKey({ ...showTrackerKey, [tracker.id]: !showTrackerKey[tracker.id] })}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showTrackerKey[tracker.id] ? 'Hide key' : 'Show key'}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Appearance */}
      <section id="appearance" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Appearance
        </h2>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Ready to Merge shimmer</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Animate the badge with a subtle shimmer for cards awaiting merge approval
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={uiPrefs.readyToMergeShimmer}
              aria-label="Toggle Ready to Merge shimmer"
              onClick={() => updateUIPrefs({ readyToMergeShimmer: !uiPrefs.readyToMergeShimmer })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                uiPrefs.readyToMergeShimmer ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                uiPrefs.readyToMergeShimmer ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
        </div>
      </section>

      {/* Diff */}
      <section id="diff" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">Diff</h2>
        <div className="space-y-1">
          {/* diffRenderMode */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Diff style</span>
              <p className="text-xs text-muted-foreground mt-0.5">Unified (stacked) or split (side-by-side)</p>
            </div>
            <select
              value={diffPrefs.diffRenderMode}
              onChange={(e) => updateDiffPrefs({ diffRenderMode: e.target.value as 'stacked' | 'split' })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
            >
              <option value="stacked">Stacked (unified)</option>
              <option value="split">Split (side-by-side)</option>
            </select>
          </div>

          {/* diffWordWrap */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Line wrapping</span>
              <p className="text-xs text-muted-foreground mt-0.5">Wrap long lines instead of scrolling horizontally</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={diffPrefs.diffWordWrap}
              aria-label="Toggle line wrapping"
              onClick={() => updateDiffPrefs({ diffWordWrap: !diffPrefs.diffWordWrap })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                diffPrefs.diffWordWrap ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                diffPrefs.diffWordWrap ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>

          {/* lineDiffType */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Intra-line diff granularity</span>
              <p className="text-xs text-muted-foreground mt-0.5">How finely to highlight changes within a single line</p>
            </div>
            <select
              value={diffPrefs.lineDiffType}
              onChange={(e) => updateDiffPrefs({ lineDiffType: e.target.value as 'word-alt' | 'word' | 'char' | 'none' })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
            >
              <option value="word-alt">Word-alt (join adjacent)</option>
              <option value="word">Word</option>
              <option value="char">Character</option>
              <option value="none">None</option>
            </select>
          </div>

          {/* diffIndicators */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Change indicators</span>
              <p className="text-xs text-muted-foreground mt-0.5">Classic +/- prefixes, colored bars, or none</p>
            </div>
            <select
              value={diffPrefs.diffIndicators}
              onChange={(e) => updateDiffPrefs({ diffIndicators: e.target.value as 'classic' | 'bars' | 'none' })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
            >
              <option value="bars">Bars</option>
              <option value="classic">Classic (+/-)</option>
              <option value="none">None</option>
            </select>
          </div>

          {/* hunkSeparators */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Hunk separators</span>
              <p className="text-xs text-muted-foreground mt-0.5">How collapsed hunks are displayed between change groups</p>
            </div>
            <select
              value={diffPrefs.hunkSeparators}
              onChange={(e) => updateDiffPrefs({ hunkSeparators: e.target.value as 'simple' | 'metadata' | 'line-info' | 'line-info-basic' })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
            >
              <option value="line-info">Line info</option>
              <option value="line-info-basic">Line info (basic)</option>
              <option value="simple">Simple</option>
              <option value="metadata">Metadata</option>
            </select>
          </div>

          {/* expandUnchanged */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Expand unchanged</span>
              <p className="text-xs text-muted-foreground mt-0.5">Auto-expand all unchanged context lines</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={diffPrefs.expandUnchanged}
              aria-label="Toggle expand unchanged"
              onClick={() => updateDiffPrefs({ expandUnchanged: !diffPrefs.expandUnchanged })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                diffPrefs.expandUnchanged ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                diffPrefs.expandUnchanged ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>

          {/* collapsedContextThreshold */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Collapsed context threshold</span>
              <p className="text-xs text-muted-foreground mt-0.5">Lines of context before collapsing unchanged blocks</p>
            </div>
            <input
              type="number"
              min={0}
              max={20}
              value={diffPrefs.collapsedContextThreshold}
              onChange={(e) => updateDiffPrefs({ collapsedContextThreshold: Math.max(0, Math.min(20, Number(e.target.value))) })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary w-[80px]"
            />
          </div>

          {/* lineHoverHighlight */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Line hover highlight</span>
              <p className="text-xs text-muted-foreground mt-0.5">Highlight lines on mouse hover</p>
            </div>
            <select
              value={diffPrefs.lineHoverHighlight}
              onChange={(e) => updateDiffPrefs({ lineHoverHighlight: e.target.value as 'disabled' | 'both' | 'number' | 'line' })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
            >
              <option value="disabled">Disabled</option>
              <option value="both">Both (number + line)</option>
              <option value="number">Number only</option>
              <option value="line">Line only</option>
            </select>
          </div>

          {/* disableLineNumbers */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Hide line numbers</span>
              <p className="text-xs text-muted-foreground mt-0.5">Remove line number columns from diff view</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={diffPrefs.disableLineNumbers}
              aria-label="Toggle hide line numbers"
              onClick={() => updateDiffPrefs({ disableLineNumbers: !diffPrefs.disableLineNumbers })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                diffPrefs.disableLineNumbers ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                diffPrefs.disableLineNumbers ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>

          {/* enableLineSelection */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Enable line selection</span>
              <p className="text-xs text-muted-foreground mt-0.5">Multi-line selection with shift-click</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={diffPrefs.enableLineSelection}
              aria-label="Toggle enable line selection"
              onClick={() => updateDiffPrefs({ enableLineSelection: !diffPrefs.enableLineSelection })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                diffPrefs.enableLineSelection ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                diffPrefs.enableLineSelection ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
        </div>
      </section>

      {/* Maintenance */}
      <section id="maintenance" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">Maintenance</h2>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Issue cache</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Clear cached issue data and re-fetch from all trackers
              </p>
            </div>
            <button
              onClick={async () => {
                setClearingCache(true);
                try {
                  const res = await fetch('/api/cache/clear', { method: 'POST' });
                  if (!res.ok) throw new Error(await res.text());
                  toast.success('Issue cache cleared and re-fetched');
                  queryClient.invalidateQueries({ queryKey: ['issues'] });
                } catch (err: any) {
                  toast.error(`Failed to clear cache: ${err.message}`);
                } finally {
                  setClearingCache(false);
                }
              }}
              disabled={clearingCache}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:border-warning/50 hover:bg-warning/10 text-muted-foreground hover:text-warning transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {clearingCache ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {clearingCache ? 'Clearing...' : 'Clear & Refresh'}
            </button>
          </div>
        </div>
      </section>

      {/* Desktop App settings — shown only inside Electron */}
      <div id="desktop" className="py-6 scroll-mt-4">
        <DesktopSettingsSection />
      </div>

      {/* Experimental — research-preview features, must remain the LAST section on the page */}
      <section
        id="experimental"
        data-testid="experimental-section"
        aria-label="Experimental"
        className="py-6 scroll-mt-4 border-t border-warning/30 mt-4"
      >
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
          <Beaker className="w-4 h-4 text-warning" />
          Experimental
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Research-preview features that may change or be removed without notice.
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Experimental features</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Show experimental dashboard surfaces in the sidebar: Agents, AutoPreso, Resources, Activity, Sessions, Metrics, Costs, Health, Skills, and God View.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(formData.experimental?.experimentalFeatures)}
              aria-label="Show experimental dashboard features"
              data-testid="experimental-features-toggle"
              onClick={() => handleExperimentalFeaturesToggle(!formData.experimental?.experimentalFeatures)}
              disabled={saveStatus === 'saving'}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                formData.experimental?.experimentalFeatures ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                formData.experimental?.experimentalFeatures ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">RTK Bash compression</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Filters Bash command outputs through rtk-ai/rtk to reduce token consumption. Opt-in.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(formData.agents?.rtk?.enabled)}
              aria-label="Enable RTK Bash compression"
              data-testid="experimental-rtk-toggle"
              onClick={() => handleRtkToggle(!formData.agents?.rtk?.enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                formData.agents?.rtk?.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                formData.agents?.rtk?.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">TLDR code-aware reads</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Replaces large code-file reads with structured TLDR summaries to save 90–95% of context tokens.
                Defaults on. Takes effect immediately for new reads — no agent restart needed.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="tldr-reload-daemons"
                title="Restart the TLDR index daemons so the daemon layer matches the toggle. Read-interception already updates live on the next read."
                onClick={async () => {
                  setReloadingTldr(true);
                  try {
                    const res = await fetch('/api/services/tldr/reload', { method: 'POST' });
                    if (!res.ok) throw new Error(await res.text());
                    const body = await res.json();
                    const verb = body.enabled ? `restarted ${body.restarted}` : `stopped ${body.stopped}`;
                    toast.success(`TLDR daemons reloaded (${verb})`);
                    queryClient.invalidateQueries({ queryKey: ['tldr-status'] });
                  } catch (err: any) {
                    toast.error(`Failed to reload TLDR daemons: ${err.message}`);
                  } finally {
                    setReloadingTldr(false);
                  }
                }}
                disabled={reloadingTldr}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:border-primary/50 hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {reloadingTldr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {reloadingTldr ? 'Reloading…' : 'Reload daemons'}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={formData.agents?.tldr?.enabled ?? true}
                aria-label="Enable TLDR code-aware reads"
                data-testid="experimental-tldr-toggle"
                onClick={() => handleTldrToggle(!(formData.agents?.tldr?.enabled ?? true))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                  (formData.agents?.tldr?.enabled ?? true) ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  (formData.agents?.tldr?.enabled ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`} />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Claude Code Channels</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use Channels transport for conversation delivery; work-agent MCP wiring is YAML-only
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(formData.experimental?.claudeCodeChannels)}
              aria-label="Use Claude Code Channels for prompt delivery (work agents only)"
              data-testid="experimental-claude-code-channels-toggle"
              onClick={() => handleClaudeCodeChannelsToggle(!formData.experimental?.claudeCodeChannels)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                formData.experimental?.claudeCodeChannels ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                formData.experimental?.claudeCodeChannels ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Streamdown renderer</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Render chat markdown with Streamdown — research preview
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(formData.experimental?.streamdownRenderer)}
              aria-label="Render chat markdown with Streamdown"
              data-testid="experimental-streamdown-toggle"
              onClick={() => handleStreamdownToggle(!formData.experimental?.streamdownRenderer)}
              disabled={saveStatus === 'saving'}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                formData.experimental?.streamdownRenderer ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                formData.experimental?.streamdownRenderer ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Import conversations from old Panopticon</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Migrate conversations from your pre-rebrand <span className="font-mono">~/.panopticon/panopticon.db</span> into
                Overdeck. Titles, cost history, favorites, and JSONL transcript links are preserved.
                Existing conversations are never overwritten.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLegacyImportOpen(true)}
              data-testid="legacy-import-open-button"
              className="shrink-0 px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/30 transition-colors"
            >
              Import…
            </button>
          </div>
        </div>
      </section>

      <LegacyImportDialog open={legacyImportOpen} onClose={() => setLegacyImportOpen(false)} />

    </SettingsLayout>
  );
}
