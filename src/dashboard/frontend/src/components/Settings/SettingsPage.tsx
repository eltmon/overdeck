import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  Beaker,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { SettingsConfig, type VoiceHardwareSettings, type VoiceSettings } from './types';
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
import { PermissionsSection } from './sections/PermissionsSection';
import { CloisterSection } from './sections/CloisterSection';
import { RemoteSection } from './sections/RemoteSection';
import { MemorySection } from './sections/MemorySection';
import { BackgroundAiSection } from './sections/BackgroundAiSection';
import { TerminalSection } from './sections/TerminalSection';
import { TtsConfigurationSection } from './sections/TtsConfigurationSection';
import { TrackerKeysSection } from './sections/TrackerKeysSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { DiffSection } from './sections/DiffSection';
import { MODELS_BY_PROVIDER, type OpenRouterFavoriteModel } from './modelCatalog';
import { LegacyImportDialog } from './LegacyImportDialog';
import {
  SettingsLayout,
  SettingsHeader,
  SettingsSidebarNav,
} from './primitives';
import { useAutosavePipeline } from './hooks/useAutosavePipeline';
import { useConversationSearch } from './hooks/useConversationSearch';
import { type CloisterConfig, type OpenRouterCatalogResponse, type SaveSettingsResponse } from './SettingsPage.types';
import { loadVoiceHardwareSettings, normalizeVoiceSettings, VOICE_HARDWARE_STORAGE_KEY } from './voiceSettingsDefaults';
import { buildMiniMaxFormData } from './miniMaxFormData';
import { SETTINGS_NAV_ITEMS } from './settingsPageConstants';

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

      <PermissionsSection
        formData={formData}
        onClaudePermissionModeChange={handlePermissionModeChange}
        onCodexPermissionModeChange={handleCodexPermissionModeChange}
      />

      <CloisterSection
        cloisterConfigError={cloisterConfigError}
        cloisterFormData={cloisterFormData}
        cloisterSaveDebounceRef={cloisterSaveDebounceRef}
        markSaveError={markSaveError}
        markSaved={markSaved}
        setCloisterFormData={setCloisterFormData}
        setSaveStatus={setSaveStatus}
      />

      <RemoteSection
        formData={formData}
        onSettingsChange={applySettings}
      />

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

      <MemorySection
        formData={formData}
        onSettingsChange={applySettings}
      />

      <BackgroundAiSection
        backgroundCost={backgroundCost}
        chatModelOptionEls={chatModelOptionEls}
        formData={formData}
        onSettingsChange={applySettings}
      />

      <TerminalSection
        formData={formData}
        onSettingsChange={applySettings}
      />

      <TtsConfigurationSection
        formData={formData}
        onSettingsChange={applySettings}
      />

      <TrackerKeysSection
        formData={formData}
        onSettingsChange={applySettings}
      />

      <AppearanceSection
        uiPrefs={uiPrefs}
        updateUIPrefs={updateUIPrefs}
      />

      <DiffSection
        diffPrefs={diffPrefs}
        updateDiffPrefs={updateDiffPrefs}
      />

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
