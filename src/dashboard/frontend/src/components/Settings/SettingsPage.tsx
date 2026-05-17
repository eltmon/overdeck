import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  X,
  ChevronDown,
  Code,
  Beaker,
  Eye,
  Zap,
  CheckCircle,
  Globe,
  Terminal,
  Brain,
  SplitSquareVertical,
  BarChart3,
  Route,
  MessageCircle,
  Lightbulb,
  AlertTriangle,
  Key,
  GitBranch,
  Flag,
  RefreshCw,
  Trash2,
  Palette,
  Wrench,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { SettingsConfig, Provider, ModelId } from './types';
import { useUIPreferences } from '../../hooks/useUIPreferences';
import { useDiffPreferences } from '../../hooks/useDiffPreferences';
import { useCodexAuthStatus } from '../../hooks/useCodexAuthStatus';
import { setReauthSession } from '../../lib/pending-codex-spawn';
import { OpenRouterPage } from './OpenRouterPage';
import { SensitiveText } from '../SensitiveText';
import { DesktopSettingsSection } from './DesktopSettingsSection';
import { WorkhorsePanel } from './WorkhorsePanel';
import { RolesPanel } from './RolesPanel';
import { MODELS_BY_PROVIDER, type OpenRouterFavoriteModel } from './modelCatalog';
// PAN-1055: drop the cached available-models response when Settings is saved
// so subsequent picker renders see the new provider/keys mix immediately.
import { invalidateAvailableModelsCache } from '../shared/ModelPicker';
import {
  SettingsLayout,
  SettingsHeader,
  SettingsSidebarNav,
  type NavItem,
} from './primitives';

// OpenRouter types matching OpenRouterModelBrowser
interface OpenRouterModelCatalog {
  id: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number;
  supportsThinking: boolean;
  category: 'free' | 'chat' | 'code' | 'other';
  topProvider?: string;
}

interface OpenRouterCatalogResponse {
  models: OpenRouterModelCatalog[];
  favorites: string[];
}

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

interface SaveSettingsResponse {
  success: boolean;
  message: string;
  warnings?: string[];
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
    merged = {
      ...settings,
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

/** Pure merge: apply MiniMax model preset while preserving all non-model settings. */
export function buildMiniMaxFormData(
  formData: SettingsConfig | null,
  miniMaxDefaults: SettingsConfig,
): SettingsConfig {
  return {
    models: {
      providers: { ...miniMaxDefaults.models.providers },
      overrides: { ...miniMaxDefaults.models.overrides },
      gemini_thinking_level: formData?.models.gemini_thinking_level,
    },
    api_keys: { ...(formData?.api_keys || {}) },
    tracker_keys: { ...(formData?.tracker_keys || {}) },
    conversations: { ...(formData?.conversations || miniMaxDefaults.conversations || {}) },
    tmux: { ...(formData?.tmux || miniMaxDefaults.tmux || {}) },
    openrouter: { ...(formData?.openrouter || miniMaxDefaults.openrouter || {}) },
  };
}

interface TestApiKeyResult {
  success: boolean;
  error: string | null;
  response: string | null;
  latencyMs: number;
  model?: string;
}

async function testApiKey(provider: string, apiKey: string, model?: string): Promise<TestApiKeyResult> {
  const res = await fetch('/api/settings/test-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey, model }),
  });
  if (!res.ok) throw new Error('Failed to test API key');
  return res.json();
}

function formatCodexExpiry(expiresAt?: string): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Expires ${date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

// Provider definitions
const PROVIDERS: { id: Provider; name: string; icon: any; placeholder: string }[] = [
  { id: 'anthropic', name: 'Anthropic', icon: Code, placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', icon: Lightbulb, placeholder: 'sk-...' },
  { id: 'google', name: 'Google', icon: Globe, placeholder: 'AIza...' },
  { id: 'kimi', name: 'Kimi (Moonshot)', icon: Zap, placeholder: 'sk-kimi-...' },
  { id: 'zai', name: 'Zhipu (GLM)', icon: Brain, placeholder: 'sk-zai-...' },
  { id: 'minimax', name: 'MiniMax', icon: Zap, placeholder: 'eyJ...' },
  { id: 'mimo', name: 'Xiaomi MiMo', icon: Zap, placeholder: 'sk-... or tp-...' },
  { id: 'nous', name: 'Nous Portal', icon: Globe, placeholder: 'ns-...' },
];

// Tracker definitions
type TrackerType = 'linear' | 'github' | 'gitlab' | 'rally';
const TRACKERS: { id: TrackerType; name: string; icon: any; envVar: string; placeholder: string }[] = [
  { id: 'linear', name: 'Linear', icon: BarChart3, envVar: 'LINEAR_API_KEY', placeholder: 'lin_api_...' },
  { id: 'github', name: 'GitHub', icon: Code, envVar: 'GITHUB_TOKEN', placeholder: 'ghp_...' },
  { id: 'gitlab', name: 'GitLab', icon: GitBranch, envVar: 'GITLAB_TOKEN', placeholder: 'glpat-...' },
  { id: 'rally', name: 'Rally', icon: Flag, envVar: 'RALLY_API_KEY', placeholder: '_abc123...' },
];

const SETTINGS_NAV_ITEMS: NavItem[] = [
  { id: 'model-routing', label: 'Model Routing', icon: Route },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'tracker-keys', label: 'Tracker Keys', icon: GitBranch },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'diff', label: 'Diff', icon: SplitSquareVertical },
  { id: 'desktop', label: 'Desktop App', icon: Monitor },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { prefs: uiPrefs, update: updateUIPrefs } = useUIPreferences();
  const { prefs: diffPrefs, update: updateDiffPrefs } = useDiffPreferences();
  const { data: codexAuth } = useCodexAuthStatus();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const [formData, setFormData] = useState<SettingsConfig | null>(null);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [showTrackerKey, setShowTrackerKey] = useState<Record<string, boolean>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [modelsModalProvider, setModelsModalProvider] = useState<Provider | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [orCatalog, setOrCatalog] = useState<OpenRouterCatalogResponse | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
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
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

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
          `${count} deprecated model${count > 1 ? 's' : ''} detected. Click "Save" to migrate automatically.`,
          { duration: 10000 }
        );
      }
    }
  }, [settings, formData]);

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: (response) => {
      invalidateAvailableModelsCache();
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['tracker-status'] });

      // Show success toast
      toast.success('Settings saved successfully');

      // Show warnings if present
      if (response.warnings && response.warnings.length > 0) {
        response.warnings.forEach((warning) => {
          toast.warning(warning, { duration: 8000 });
        });
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !formData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">Error: {(error as Error)?.message || 'Failed to load settings'}</div>
      </div>
    );
  }

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(settings);

  const handleProviderToggle = (provider: Provider) => {
    setFormData({
      ...formData,
      models: {
        ...formData.models,
        providers: {
          ...formData.models.providers,
          [provider]: !formData.models.providers[provider],
        },
      },
    });
  };

  const handleApiKeyChange = (provider: Provider, key: string) => {
    if (provider === 'anthropic') return;
    setFormData({
      ...formData,
      api_keys: {
        ...formData.api_keys,
        [provider]: key || undefined,
      },
    });
  };

  const handleTrackerKeyChange = (tracker: TrackerType, key: string) => {
    setFormData({
      ...formData,
      tracker_keys: {
        ...formData.tracker_keys,
        [tracker]: key || undefined,
      },
    });
  };

  const handleTmuxConfigModeChange = (configMode: 'managed' | 'inherit-user') => {
    setFormData({
      ...formData,
      tmux: {
        ...formData.tmux,
        config_mode: configMode,
      },
    });
  };

  const handleCompactionModelChange = (modelId: ModelId) => {
    setFormData({
      ...formData,
      conversations: {
        ...formData.conversations,
        compaction_model: modelId,
      },
    });
  };

  const handleTitleModelChange = (modelId: ModelId) => {
    setFormData({
      ...formData,
      conversations: {
        ...formData.conversations,
        title_model: modelId,
      },
    });
  };

  const handleManualCompactModeChange = (mode: 'claude-code' | 'panopticon-native') => {
    setFormData({
      ...formData,
      conversations: {
        ...formData.conversations,
        manual_compact_mode: mode,
      },
    });
  };

  const handleRichCompactionChange = (enabled: boolean) => {
    setFormData({
      ...formData,
      conversations: {
        ...formData.conversations,
        rich_compaction: enabled,
      },
    });
  };

  const handleClaudeCodeChannelsToggle = (enabled: boolean) => {
    const next: SettingsConfig = {
      ...formData,
      experimental: {
        ...formData.experimental,
        claudeCodeChannels: enabled,
      },
    };
    setFormData(next);
    saveMutation.mutate(next);
  };

  const handlePermissionModeChange = (mode: 'auto' | 'bypass') => {
    const next: SettingsConfig = {
      ...formData,
      claude: {
        ...formData.claude,
        permissionMode: mode,
      },
    };
    setFormData(next);
    saveMutation.mutate(next);
  };


  const handleSave = () => saveMutation.mutate(formData);
  const handleReset = () => setFormData(settings || null);


  const handleTestApiKey = async (provider: Provider) => {
    const apiKey = formData?.api_keys[provider as keyof typeof formData.api_keys];
    if (!apiKey) return;

    setTestingProvider(provider);
    setTestResults({ ...testResults, [provider]: null });

    try {
      const result = await testApiKey(provider, apiKey);
      setTestResults({ ...testResults, [provider]: result });
    } catch (error) {
      setTestResults({
        ...testResults,
        [provider]: { success: false, error: 'Test failed', response: null, latencyMs: 0 },
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleTestModel = async (provider: Provider, modelId: string) => {
    const apiKey = formData?.api_keys[provider as keyof typeof formData.api_keys];
    if (!apiKey) return;

    const testKey = `${provider}:${modelId}`;
    setTestingModel(testKey);
    setModelTestResults({ ...modelTestResults, [testKey]: null });

    try {
      const result = await testApiKey(provider, apiKey, modelId);
      setModelTestResults({ ...modelTestResults, [testKey]: result });
    } catch (error) {
      setModelTestResults({
        ...modelTestResults,
        [testKey]: { success: false, error: 'Test failed', response: null, latencyMs: 0 },
      });
    } finally {
      setTestingModel(null);
    }
  };

  return (
    <SettingsLayout
      header={
        <SettingsHeader
          title="Settings"
          hasChanges={hasChanges}
          saving={saveMutation.isPending}
          saveSuccess={saveMutation.isSuccess}
          saveError={saveMutation.isError}
          onSave={handleSave}
          onReset={handleReset}
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
              <p className="text-muted-foreground text-xs mt-2">
                Save to migrate automatically.
              </p>
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

      {/* Providers */}
      <section id="providers" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Providers
        </h2>
        <div className="space-y-1">
          {PROVIDERS.map((provider) => {
            const isDefault = provider.id === 'anthropic';
            const isEnabled = formData.models.providers[provider.id];
            const apiKey = formData.api_keys[provider.id as keyof typeof formData.api_keys] || '';
            const isExpanded = expandedProviders[provider.id] || false;

            const getAuthSummary = () => {
              if (isDefault) {
                if (claudeAuth?.loggedIn) return { text: claudeAuth.subscriptionType ? `${claudeAuth.subscriptionType} plan` : 'Subscription', variant: 'success' as const };
                if (claudeAuth?.hasAnthropicApiKey) return { text: 'API key', variant: 'neutral' as const };
                return { text: 'Not authenticated', variant: 'warning' as const };
              }
              if (provider.id === 'openai') {
                if (codexAuth?.status === 'valid') return { text: 'OAuth', variant: 'success' as const };
                if (codexAuth?.status === 'expired' || codexAuth?.status === 'burned') return { text: codexAuth.status, variant: 'warning' as const };
              }
              if (apiKey && !apiKey.startsWith('$')) return { text: 'Key configured', variant: 'success' as const };
              if (apiKey?.startsWith('$')) return { text: `via ${apiKey}`, variant: 'neutral' as const };
              return { text: 'No key', variant: 'neutral' as const };
            };

            const authSummary = getAuthSummary();

            return (
              <div key={provider.id} className="border border-transparent rounded-lg hover:border-border transition-colors">
                {/* Summary row */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <provider.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground flex-1 min-w-0">{provider.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      authSummary.variant === 'success' ? 'text-success bg-success/10' :
                      authSummary.variant === 'warning' ? 'text-warning bg-warning/10' :
                      'text-muted-foreground bg-muted/50'
                    }`}>
                      {authSummary.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleProviderToggle(provider.id)}
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${provider.name}`}
                      className={`w-8 h-4.5 rounded-full relative transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                        isEnabled ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span className={`absolute top-0.5 size-3.5 bg-white rounded-full transition-all ${
                        isEnabled ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedProviders(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${provider.name} details`}
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 ml-7 space-y-3">
                    {isDefault ? (
                      <div className="space-y-2">
                        {claudeAuth?.loggedIn ? (
                          <div className="flex items-center gap-2 text-xs">
                            <div className="w-1.5 h-1.5 rounded-full bg-success" />
                            <span className="text-muted-foreground">
                              Subscription{claudeAuth.subscriptionType ? ` — ${claudeAuth.subscriptionType.toUpperCase()}` : ''}
                              {claudeAuth.rateLimitTier ? ` · ${claudeAuth.rateLimitTier}` : ''}
                            </span>
                          </div>
                        ) : claudeAuth?.hasAnthropicApiKey ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Key className="w-3 h-3" />
                            <span>Using ANTHROPIC_API_KEY from environment</span>
                          </div>
                        ) : (
                          <p className="text-xs text-warning">
                            Not authenticated. Run <code className="font-mono bg-muted px-1 rounded">claude</code> and use <code className="font-mono bg-muted px-1 rounded">/login</code>.
                          </p>
                        )}
                        {claudeAuth?.hasAnthropicApiKey && claudeAuth.loggedIn && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-warning" />
                            ANTHROPIC_API_KEY overrides subscription for direct API calls
                          </p>
                        )}
                      </div>
                    ) : provider.id === 'openai' ? (
                      <div className="space-y-2">
                        {codexAuth?.status === 'valid' ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-success" />
                            <span>Subscription OAuth active</span>
                            {codexAuth.email && (
                              <SensitiveText value={codexAuth.email} className="text-[10px] text-muted-foreground" />
                            )}
                            {formatCodexExpiry(codexAuth.expiresAt) && (
                              <span className="text-[10px] text-muted-foreground">{formatCodexExpiry(codexAuth.expiresAt)}</span>
                            )}
                          </div>
                        ) : (codexAuth?.status === 'expired' || codexAuth?.status === 'burned') ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-warning capitalize">{codexAuth.status}</span>
                            {codexAuth.email && (
                              <SensitiveText value={codexAuth.email} className="text-[10px] text-muted-foreground" />
                            )}
                            {formatCodexExpiry(codexAuth.expiresAt) && (
                              <span className="text-[10px] text-muted-foreground">{formatCodexExpiry(codexAuth.expiresAt)}</span>
                            )}
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch('/api/settings/codex-reauth', { method: 'POST' });
                                  if (!res.ok) {
                                    const body = await res.json().catch(() => ({}));
                                    throw new Error(body.error || `Failed (${res.status})`);
                                  }
                                  const { sessionName, statusToken } = await res.json() as { sessionName: string; statusToken: string };
                                  setReauthSession(sessionName, statusToken);
                                  window.location.href = `/terminal/${sessionName}`;
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : 'Failed to start re-authentication');
                                }
                              }}
                              className="text-[10px] text-warning hover:text-warning/80 underline"
                            >
                              Re-authenticate
                            </button>
                          </div>
                        ) : null}
                        {/* API key input for OpenAI */}
                        <div className="relative">
                          <input
                            type={showApiKey[provider.id] ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                            placeholder={provider.placeholder}
                            autoComplete="off"
                            className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary text-foreground pr-14"
                          />
                          {apiKey && (
                            <>
                              <button
                                onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })}
                                className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                title={showApiKey[provider.id] ? 'Hide' : 'Show'}
                                aria-label={showApiKey[provider.id] ? 'Hide key' : 'Show key'}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleApiKeyChange(provider.id, '')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                                title="Remove key"
                                aria-label="Remove API key"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {apiKey.startsWith('$') ? (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Env: </span>
                            <code className="font-mono text-muted-foreground">{apiKey}</code>
                            <input
                              type="text"
                              placeholder={provider.placeholder}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                              autoComplete="off"
                              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono mt-1.5 focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
                            />
                          </div>
                        ) : (
                          <div className="relative">
                            <input
                              type={showApiKey[provider.id] ? 'text' : 'password'}
                              value={apiKey}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                              placeholder={provider.placeholder}
                              autoComplete="off"
                              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary text-foreground pr-14"
                            />
                            {apiKey && (
                              <>
                                <button
                                  onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })}
                                  className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                  title={showApiKey[provider.id] ? 'Hide' : 'Show'}
                                  aria-label={showApiKey[provider.id] ? 'Hide key' : 'Show key'}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleApiKeyChange(provider.id, '')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                                  title="Remove key"
                                  aria-label="Remove API key"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Action buttons for non-default providers */}
                    {!isDefault && apiKey && !apiKey.startsWith('$') && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setModelsModalProvider(provider.id)}
                          className="text-xs text-primary hover:text-primary/80 font-medium"
                        >
                          View models
                        </button>
                        <span className="text-border">·</span>
                        <button
                          onClick={() => handleTestApiKey(provider.id)}
                          disabled={testingProvider === provider.id}
                          className="text-xs text-muted-foreground hover:text-foreground font-medium disabled:opacity-50 flex items-center gap-1"
                        >
                          {testingProvider === provider.id && <Loader2 className="w-3 h-3 animate-spin" />}
                          Test
                        </button>
                        {testResults[provider.id] && (
                          <span className={`text-[10px] ${testResults[provider.id]?.success ? 'text-success' : 'text-destructive'}`}>
                            {testResults[provider.id]?.success
                              ? `${testResults[provider.id]?.latencyMs}ms`
                              : testResults[provider.id]?.error?.slice(0, 20)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* OpenRouter as part of providers */}
          <div className="border border-transparent rounded-lg hover:border-border transition-colors">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground flex-1">OpenRouter</span>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  formData.api_keys.openrouter ? 'text-success bg-success/10' : 'text-muted-foreground bg-muted/50'
                }`}>
                  {formData.api_keys.openrouter ? 'Configured' : 'No key'}
                </span>
                <button
                  type="button"
                  onClick={() => handleProviderToggle('openrouter')}
                  role="switch"
                  aria-checked={!!formData.models.providers.openrouter}
                  aria-label={`${formData.models.providers.openrouter ? 'Disable' : 'Enable'} OpenRouter`}
                  className={`w-8 h-4.5 rounded-full relative transition-colors ${
                    formData.models.providers.openrouter ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`absolute top-0.5 size-3.5 bg-white rounded-full transition-all ${
                    formData.models.providers.openrouter ? 'right-0.5' : 'left-0.5'
                  }`} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedProviders(prev => ({ ...prev, openrouter: !prev.openrouter }))}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                  aria-expanded={expandedProviders.openrouter || false}
                  aria-label={`${expandedProviders.openrouter ? 'Collapse' : 'Expand'} OpenRouter details`}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedProviders.openrouter ? '' : '-rotate-90'}`} />
                </button>
              </div>
            </div>
            {expandedProviders.openrouter && (
              <div className="px-3 pb-3 pt-0 ml-7">
                <OpenRouterPage
                  apiKey={formData.api_keys.openrouter}
                  enabled={!!formData.models.providers.openrouter}
                  onApiKeyChange={(key) => handleApiKeyChange('openrouter', key)}
                  onToggleEnabled={() => handleProviderToggle('openrouter')}
                  onApiKeySaved={(savedKey) => {
                    setFormData(prev => prev ? {
                      ...prev,
                      api_keys: { ...prev.api_keys, openrouter: savedKey },
                    } : prev);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Permissions — controls what flags get passed to spawned `claude` processes */}
      <section id="permissions" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          Permissions
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          How spawned Claude Code agents are gated. Applies to work agents, specialists,
          conversations, and remote agents. Override per-invocation with{' '}
          <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">--yolo</code>,{' '}
          <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">--no-yolo</code>, or{' '}
          <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">PAN_YOLO</code>.
        </p>

        <div className="space-y-2">
          {([
            {
              value: 'auto',
              title: 'Auto (recommended)',
              flag: '--permission-mode auto',
              description:
                'Claude Code\'s built-in classifier auto-approves safe tool calls and blocks destructive ones (force pushes, exfiltration, rm -rf, writes outside workspace). Requires skipAutoPermissionPrompt: true in ~/.claude/settings.json.',
            },
            {
              value: 'bypass',
              title: 'Bypass (yolo)',
              flag: '--dangerously-skip-permissions --permission-mode bypassPermissions',
              description:
                'Legacy Panopticon behavior. Every tool call auto-approved with no classifier — fastest, but the agent can do anything its file/network access allows. Use when running providers that reject the auto flag, or when the classifier is interfering with intentionally destructive automation.',
            },
          ] as const).map((opt) => {
            const selected = (formData.claude?.permissionMode ?? 'auto') === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`permission-mode-${opt.value}`}
                onClick={() => handlePermissionModeChange(opt.value)}
                disabled={saveMutation.isPending}
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
                  <div className="flex items-center gap-2">
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
      </section>

      {/* Conversations */}
      <section id="conversations" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Conversations
        </h2>
        <div className="space-y-1">
          {/* Compaction model */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Compaction model</span>
              <p className="text-xs text-muted-foreground mt-0.5">Used for native compaction and fork summaries</p>
            </div>
            <select
              value={formData.conversations?.compaction_model || 'claude-haiku-4-5'}
              onChange={(e) => handleCompactionModelChange(e.target.value as ModelId)}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
            >
              {Object.entries(MODELS_BY_PROVIDER).flatMap(([, providerDef]) =>
                providerDef.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {providerDef.name} — {model.name}
                  </option>
                ))
              )}
              {openRouterFavoriteModels.map((model) => (
                <option key={model.id} value={model.id}>
                  OpenRouter — {model.name}
                </option>
              ))}
            </select>
          </div>

          {/* Title model */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Title generation model</span>
              <p className="text-xs text-muted-foreground mt-0.5">Generates conversation titles from first message</p>
            </div>
            <select
              value={formData.conversations?.title_model || 'claude-haiku-4-5'}
              onChange={(e) => handleTitleModelChange(e.target.value as ModelId)}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
            >
              {Object.entries(MODELS_BY_PROVIDER).flatMap(([, providerDef]) =>
                providerDef.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {providerDef.name} — {model.name}
                  </option>
                ))
              )}
              {openRouterFavoriteModels.map((model) => (
                <option key={model.id} value={model.id}>
                  OpenRouter — {model.name}
                </option>
              ))}
            </select>
          </div>

          {/* /compact handling */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">/compact handling</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(formData.conversations?.manual_compact_mode || 'claude-code') === 'claude-code'
                  ? 'Pass through to Claude Code'
                  : 'Panopticon-native compaction'}
              </p>
            </div>
            <select
              value={formData.conversations?.manual_compact_mode || 'claude-code'}
              onChange={(e) => handleManualCompactModeChange(e.target.value as 'claude-code' | 'panopticon-native')}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="claude-code">Pass through</option>
              <option value="panopticon-native">Native compaction</option>
            </select>
          </div>

          {/* Rich compaction */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Rich summaries</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                9-section verbose format (higher token usage)
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!formData.conversations?.rich_compaction}
              aria-label="Toggle rich compaction summaries"
              onClick={() => handleRichCompactionChange(!formData.conversations?.rich_compaction)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                formData.conversations?.rich_compaction ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                formData.conversations?.rich_compaction ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
        </div>
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
                  ? 'Using Panopticon-managed tmux socket and config'
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

      {/* Provider Models Modal */}
      {modelsModalProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                {(() => {
                  const Icon = PROVIDERS.find(p => p.id === modelsModalProvider)?.icon;
                  return Icon ? <Icon className="w-5 h-5 text-primary" /> : null;
                })()}
                <h3 className="text-foreground text-lg font-bold">
                  {PROVIDERS.find(p => p.id === modelsModalProvider)?.name} Models
                </h3>
              </div>
              <button
                onClick={() => setModelsModalProvider(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {(() => {
                const providerApiKey = formData?.api_keys[modelsModalProvider as keyof typeof formData.api_keys] || '';
                const isEnvVarRef = providerApiKey.startsWith('$');

                if (!providerApiKey) {
                  return (
                    <div className="text-center py-8">
                      <Key className="w-10 h-10 text-muted-foreground mb-2 mx-auto" />
                      <p className="text-muted-foreground">Enter an API key to test models</p>
                    </div>
                  );
                }

                if (isEnvVarRef) {
                  return (
                    <div className="text-center py-8">
                      <AlertTriangle className="w-10 h-10 text-warning mb-2 mx-auto" />
                      <p className="text-warning">API key configured via environment variable</p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <code className="font-mono bg-popover px-1 rounded">{providerApiKey}</code> is not set
                      </p>
                      <p className="text-muted-foreground text-xs mt-2">Set the environment variable or enter the key directly in Settings</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                  {(MODELS_BY_PROVIDER[modelsModalProvider]?.models || []).map((model) => {
                    const testKey = `${modelsModalProvider}:${model.id}`;
                    const testResult = modelTestResults[testKey];
                    const isTesting = testingModel === testKey;

                    return (
                      <div
                        key={model.id}
                        className="bg-card border border-border rounded-lg p-4 hover:border-border transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {/* Model icons are strings (Material Symbols names) - render as text fallback */}
                              <div className="w-4 h-4 flex items-center justify-center text-muted-foreground text-[10px]">
                                {typeof model.icon === 'string' ? model.icon[0] : '◆'}
                              </div>
                              <h4 className="text-foreground font-semibold">{model.name}</h4>
                              {model.tier && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  model.tier === 'premium' ? 'badge-bg-signal-review text-signal-review-foreground' :
                                  model.tier === 'balanced' ? 'badge-bg-primary text-primary' :
                                  'badge-bg-success text-success-foreground'
                                }`}>
                                  {model.tier}
                                </span>
                              )}
                            </div>
                            {model.description && (
                              <p className="text-xs text-muted-foreground mb-2">{model.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {model.capabilities.map((cap) => (
                                <span
                                  key={cap}
                                  className="text-[9px] px-1.5 py-0.5 bg-card text-muted-foreground rounded border border-border"
                                >
                                  {cap}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <button
                              onClick={() => handleTestModel(modelsModalProvider, model.id)}
                              disabled={isTesting}
                              className="flex items-center gap-1.5 px-3 py-1.5 badge-bg-success hover:bg-success/20 border badge-border-success rounded-lg text-xs text-success-foreground transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                              {isTesting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Zap className="w-3.5 h-3.5" />
                              )}
                              Test 2+3
                            </button>
                            {testResult && (
                              <div className={`flex items-center gap-1 text-xs ${testResult.success ? 'text-success' : 'text-destructive'}`}>
                                {testResult.success ? (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                ) : (
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                )}
                                {testResult.success
                                  ? `${testResult.latencyMs}ms`
                                  : (testResult.error?.slice(0, 30) || 'Failed')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border bg-card">
              <p className="text-xs text-muted-foreground text-center">
                Test verifies API key and model availability by asking "What is 2+3?"
              </p>
            </div>
          </div>
        </div>
      )}

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
              <span className="text-sm font-medium text-foreground">Claude Code Channels</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Route prompts via stdio MCP bridge instead of tmux send-keys (work agents only)
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(formData.experimental?.claudeCodeChannels)}
              aria-label="Use Claude Code Channels for prompt delivery (work agents only)"
              data-testid="experimental-claude-code-channels-toggle"
              onClick={() => handleClaudeCodeChannelsToggle(!formData.experimental?.claudeCodeChannels)}
              disabled={saveMutation.isPending}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                formData.experimental?.claudeCodeChannels ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                formData.experimental?.claudeCodeChannels ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
        </div>
      </section>

    </SettingsLayout>
  );
}
