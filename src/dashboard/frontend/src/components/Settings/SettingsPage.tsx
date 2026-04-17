import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  X,
  Search,
  Code,
  Beaker,
  FileText,
  MessageSquare,
  Eye,
  GitMerge,
  Shield,
  Zap,
  CheckCircle,
  Merge,
  Globe,
  Calendar,
  Terminal,
  Brain,
  SplitSquareVertical,
  BookMarked,
  BarChart3,
  Route,
  MessageCircle,
  Lightbulb,
  User,
  AlertTriangle,
  CheckSquare as VerifiedUser,
  Eye as PageView,
  ClipboardList,
  Key,
  GitBranch,
  Flag,
  Settings,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useAlert } from '../DialogProvider';
import { SettingsConfig, Provider, WorkTypeId, ModelId } from './types';
import { OpenRouterPage } from './OpenRouterPage';
import {
  ModelOverrideModal,
  getCapabilityMatchScore,
  getModelById,
  WORK_TYPE_CAPABILITIES,
  CAPABILITY_INFO,
  Capability,
  MODELS_BY_PROVIDER,
  OpenRouterFavoriteModel,
} from './AgentCards/ModelOverrideModal';
import { FALLBACK_DEFAULT_MODEL, getEffectiveModelId } from './modelDefaults';

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

interface ClaudeAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  expired: boolean;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
  hasAnthropicApiKey: boolean;
}

interface OpenAIAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  expired: boolean;
  authMode: string | null;
  accountId: string | null;
  lastRefresh: string | null;
  accessTokenExpiresAt: number | null;
  hasOpenAIApiKey: boolean;
  bridgedFromCodex: boolean;
}

async function saveSettings(settings: SettingsConfig): Promise<SaveSettingsResponse> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to save settings');
  }
  return res.json();
}

async function fetchOptimalDefaults(): Promise<SettingsConfig> {
  const res = await fetch('/api/settings/optimal-defaults');
  if (!res.ok) throw new Error('Failed to fetch optimal defaults');
  return res.json();
}

async function fetchClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  const res = await fetch('/api/settings/claude-auth');
  if (!res.ok) throw new Error('Failed to fetch Claude auth status');
  return res.json();
}

async function fetchOpenAIAuthStatus(): Promise<OpenAIAuthStatus> {
  const res = await fetch('/api/settings/openai-auth');
  if (!res.ok) throw new Error('Failed to fetch OpenAI auth status');
  return res.json();
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

function formatAuthTimestamp(value?: number | string | null): string | null {
  if (!value) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

// Provider definitions
const PROVIDERS: { id: Provider; name: string; icon: any; placeholder: string }[] = [
  { id: 'anthropic', name: 'Anthropic', icon: Code, placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', icon: Lightbulb, placeholder: 'sk-...' },
  { id: 'google', name: 'Google', icon: Globe, placeholder: 'AIza...' },
  { id: 'kimi', name: 'Kimi (Moonshot)', icon: Zap, placeholder: 'sk-kimi-...' },
  { id: 'minimax', name: 'MiniMax', icon: Brain, placeholder: 'minimax-...' },
  { id: 'zai', name: 'Z.AI', icon: Brain, placeholder: '... or $ZAI_API_KEY' },
];

// Tracker definitions
type TrackerType = 'linear' | 'github' | 'gitlab' | 'rally';
const TRACKERS: { id: TrackerType; name: string; icon: any; envVar: string; placeholder: string }[] = [
  { id: 'linear', name: 'Linear', icon: BarChart3, envVar: 'LINEAR_API_KEY', placeholder: 'lin_api_...' },
  { id: 'github', name: 'GitHub', icon: Code, envVar: 'GITHUB_TOKEN', placeholder: 'ghp_...' },
  { id: 'gitlab', name: 'GitLab', icon: GitBranch, envVar: 'GITLAB_TOKEN', placeholder: 'glpat-...' },
  { id: 'rally', name: 'Rally', icon: Flag, envVar: 'RALLY_API_KEY', placeholder: '_abc123...' },
];

// Agent definitions organized by category
interface AgentDef { id: WorkTypeId; name: string; icon: any; description: string; implemented: boolean }
interface AgentCategory { name: string; icon: any; agents: AgentDef[] }

const AGENT_CATEGORIES: AgentCategory[] = [
  {
    name: 'Issue Agent Phases',
    icon: ClipboardList,
    agents: [
      { id: 'issue-agent:exploration' as WorkTypeId, name: 'Exploration', icon: Search, description: 'Codebase discovery', implemented: true },
      { id: 'issue-agent:implementation' as WorkTypeId, name: 'Implementation', icon: Code, description: 'Write the code', implemented: true },
      { id: 'issue-agent:testing' as WorkTypeId, name: 'Testing', icon: Beaker, description: 'Write & run tests', implemented: true },
      { id: 'issue-agent:documentation' as WorkTypeId, name: 'Documentation', icon: FileText, description: 'Update docs', implemented: true },
      { id: 'issue-agent:review-response' as WorkTypeId, name: 'Review Response', icon: MessageSquare, description: 'Address PR feedback', implemented: true },
    ],
  },
  {
    name: 'Specialist Agents',
    icon: Brain,
    agents: [
      { id: 'specialist-review-agent' as WorkTypeId, name: 'Review Agent', icon: Eye, description: 'Automated code reviews', implemented: true },
      { id: 'specialist-test-agent' as WorkTypeId, name: 'Test Agent', icon: Beaker, description: 'Test generation', implemented: true },
      { id: 'specialist-merge-agent' as WorkTypeId, name: 'Merge Agent', icon: GitMerge, description: 'Merge conflict resolution', implemented: true },
      { id: 'specialist-inspect-agent' as WorkTypeId, name: 'Inspect Agent', icon: PageView, description: 'Per-bead diff inspection', implemented: true },
      { id: 'specialist-uat-agent' as WorkTypeId, name: 'UAT Agent', icon: VerifiedUser, description: 'User acceptance testing', implemented: true },
    ],
  },
  {
    name: 'Convoy Reviewers',
    icon: SplitSquareVertical,
    agents: [
      { id: 'convoy:security-reviewer' as WorkTypeId, name: 'Security', icon: Shield, description: 'Security analysis', implemented: true },
      { id: 'convoy:performance-reviewer' as WorkTypeId, name: 'Performance', icon: Zap, description: 'Performance review', implemented: true },
      { id: 'convoy:correctness-reviewer' as WorkTypeId, name: 'Correctness', icon: CheckCircle, description: 'Logic validation', implemented: true },
      { id: 'convoy:synthesis-agent' as WorkTypeId, name: 'Synthesis', icon: Merge, description: 'Combine reviews', implemented: true },
    ],
  },
  {
    name: 'Subagents',
    icon: User,
    agents: [
      { id: 'subagent:explore' as WorkTypeId, name: 'Explore', icon: Globe, description: 'Codebase exploration', implemented: true },
      { id: 'subagent:plan' as WorkTypeId, name: 'Plan', icon: Calendar, description: 'Task breakdown', implemented: true },
      { id: 'subagent:bash' as WorkTypeId, name: 'Bash', icon: Terminal, description: 'CLI commands', implemented: true },
      { id: 'subagent:general-purpose' as WorkTypeId, name: 'General', icon: Lightbulb, description: 'General tasks', implemented: true },
    ],
  },
  {
    name: 'Workflow Agents',
    icon: Route,
    agents: [
      { id: 'status-review' as WorkTypeId, name: 'Status Review', icon: BarChart3, description: 'AI status reviews (executive-facing)', implemented: true },
    ],
  },
  {
    name: 'Planning',
    icon: Brain,
    agents: [
      { id: 'planning-agent' as WorkTypeId, name: 'Planning Agent', icon: BookMarked, description: 'vBRIEF plan generation', implemented: true },
    ],
  },
  {
    name: 'CLI Modes',
    icon: Terminal,
    agents: [
      { id: 'cli:interactive' as WorkTypeId, name: 'Interactive', icon: MessageCircle, description: 'Conversation mode', implemented: true },
      { id: 'cli:quick-command' as WorkTypeId, name: 'Quick Command', icon: Zap, description: 'One-shot queries', implemented: true },
    ],
  },
];

// Section navigation definitions
const SETTINGS_SECTIONS = [
  { id: 'smart-selection', label: 'Smart Selection', icon: Route },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'openrouter', label: 'OpenRouter', icon: Globe },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'tmux', label: 'Terminal', icon: Terminal },
  { id: 'trackers', label: 'Tracker Keys', icon: GitBranch },
  { id: 'model-assignments', label: 'Model Assignments', icon: Brain },
  { id: 'maintenance', label: 'Maintenance', icon: Settings },
] as const;

function getModelDisplay(modelId?: string): string {
  if (!modelId) return 'Default';
  const model = getModelById(modelId as ModelId);
  if (model) return model.name;
  // Fallback for unknown models
  const id = modelId.toLowerCase();
  if (id.includes('claude')) return id.includes('opus') ? 'Claude Opus 4.6' : id.includes('haiku') ? 'Claude Haiku 4.5' : 'Claude Sonnet 4.6';
  if (id.includes('gpt-5.4-pro')) return 'GPT-5.4 Pro';
  if (id.includes('gpt-5.4') && id.includes('mini')) return 'GPT-5.4 Mini';
  if (id.includes('gpt-5.4') && id.includes('nano')) return 'GPT-5.4 Nano';
  if (id.includes('gpt-5.4') || id.includes('gpt-5.2-codex')) return 'GPT-5.4';
  if (id.includes('gpt-4o-mini')) return 'GPT-5.4 Nano';
  if (id.includes('gpt-4o')) return 'GPT-5.4 Mini';
  if (id.includes('o4') && id.includes('mini')) return 'O4 Mini';
  if (id.includes('o3')) return 'O3';
  if (id.includes('gemini') && id.includes('lite')) return 'Gemini 3.1 Flash Lite';
  if (id.includes('gemini') && id.includes('flash')) return 'Gemini 3 Flash';
  if (id.includes('gemini')) return 'Gemini 3.1 Pro';
  if (id.includes('kimi')) return 'Kimi K2.5';
  if (id.includes('glm')) return 'GLM 5.1';
  return modelId === FALLBACK_DEFAULT_MODEL ? 'Claude Sonnet 4.6' : modelId;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const showAlert = useAlert();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const [formData, setFormData] = useState<SettingsConfig | null>(null);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [showTrackerKey, setShowTrackerKey] = useState<Record<string, boolean>>({});
  const [modalWorkType, setModalWorkType] = useState<WorkTypeId | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [modelsModalProvider, setModelsModalProvider] = useState<Provider | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [orCatalog, setOrCatalog] = useState<OpenRouterCatalogResponse | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('smart-selection');
  const [claudeAuth, setClaudeAuth] = useState<ClaudeAuthStatus | null>(null);
  const [openaiAuth, setOpenAIAuth] = useState<OpenAIAuthStatus | null>(null);
  const [refreshingAuth, setRefreshingAuth] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const refreshProviderAuth = useCallback(async () => {
    setRefreshingAuth(true);
    try {
      const [claudeStatus, openaiStatus] = await Promise.all([
        fetchClaudeAuthStatus(),
        fetchOpenAIAuthStatus(),
      ]);
      setClaudeAuth(claudeStatus);
      setOpenAIAuth(openaiStatus);
    } catch (err) {
      console.error('Failed to refresh provider auth status:', err);
      toast.error('Failed to refresh provider login status');
    } finally {
      setRefreshingAuth(false);
    }
  }, []);

  // Track active section based on scroll position
  // The settings page lives inside an overflow-auto container, not the window
  useEffect(() => {
    const scrollContainer = contentRef.current?.closest('.overflow-auto') as HTMLElement | null;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const sectionIds = SETTINGS_SECTIONS.map(s => s.id);
      let current = sectionIds[0];
      const containerRect = scrollContainer.getBoundingClientRect();
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          // Section is "active" when its top has scrolled past the top of the container + offset
          if (rect.top <= containerRect.top + 120) {
            current = id;
          }
        }
      }
      setActiveSection(current);
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId);
    const scrollContainer = contentRef.current?.closest('.overflow-auto') as HTMLElement | null;
    if (el && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      scrollContainer.scrollTo({
        top: scrollContainer.scrollTop + elRect.top - containerRect.top - 16,
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    void refreshProviderAuth();
  }, [refreshProviderAuth]);

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
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error || !formData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error: {(error as Error)?.message || 'Failed to load settings'}</div>
      </div>
    );
  }

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(settings);

  const handleProviderToggle = (provider: Provider) => {
    if (provider === 'anthropic') return;
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

  const handleOpenRouterKeySaved = (key: string) => {
    setFormData((current) => current ? {
      ...current,
      api_keys: {
        ...current.api_keys,
        openrouter: key || undefined,
      },
    } : current);
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

  const handleSetOverride = (workType: WorkTypeId, model: ModelId) => {
    setFormData({
      ...formData,
      models: {
        ...formData.models,
        overrides: {
          ...formData.models.overrides,
          [workType]: model,
        },
      },
    });
  };

  const handleRemoveOverride = (workType: WorkTypeId) => {
    const { [workType]: _removed, ...remainingOverrides } = formData.models.overrides;
    setFormData({
      ...formData,
      models: {
        ...formData.models,
        overrides: remainingOverrides,
      },
    });
  };

  const handleSave = () => saveMutation.mutate(formData);
  const handleReset = () => setFormData(settings || null);

  const handleRestoreOptimalDefaults = async () => {
    try {
      const optimalDefaults = await fetchOptimalDefaults();
      // Deep clone to ensure React detects the change
      const newFormData: SettingsConfig = {
        models: {
          providers: { ...(formData?.models.providers || optimalDefaults.models.providers) },
          overrides: { ...optimalDefaults.models.overrides },
          gemini_thinking_level: optimalDefaults.models.gemini_thinking_level,
        },
        api_keys: { ...(formData?.api_keys || {}) },
        conversations: {
          ...(formData?.conversations || optimalDefaults.conversations || {}),
        },
        tracker_keys: { ...(formData?.tracker_keys || {}) },
        tmux: { ...(formData?.tmux || optimalDefaults.tmux || {}) },
        openrouter: { ...(formData?.openrouter || optimalDefaults.openrouter || {}) },
      };
      setFormData(newFormData);
    } catch (error) {
      console.error('Failed to fetch optimal defaults:', error);
      showAlert({ message: 'Failed to load optimal defaults: ' + (error as Error).message, variant: 'error' });
    }
  };

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
    <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 pb-32">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <Settings className="w-8 h-8 text-blue-400" />
            <h1 className="text-content text-4xl font-black tracking-tight">Settings</h1>
          </div>
          <p className="text-content-muted text-base">Configure AI model orchestration and agent permissions.</p>
        </div>
      </div>

      <div className="flex gap-8">
      {/* Main content */}
      <div className="flex-1 min-w-0" ref={contentRef}>

      {/* Deprecation Warning Banner */}
      {formData.deprecation_warnings && formData.deprecation_warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-400 font-semibold mb-2">
                Deprecated Model IDs Detected
              </p>
              <div className="space-y-1">
                {formData.deprecation_warnings.map((warning, idx) => (
                  <p key={idx} className="text-amber-400/90 text-sm">
                    <span className="font-mono text-xs bg-amber-500/20 px-1.5 py-0.5 rounded">{warning.workType}</span>
                    {': '}
                    <span className="font-mono text-xs bg-amber-500/20 px-1.5 py-0.5 rounded line-through">
                      {warning.from}
                    </span>
                    {' → '}
                    <span className="font-mono text-xs bg-amber-500/20 px-1.5 py-0.5 rounded">
                      {warning.to}
                    </span>
                  </p>
                ))}
              </div>
              <p className="text-amber-400/80 text-xs mt-3">
                Click <span className="font-semibold">Save</span> to automatically migrate to current model IDs. A backup will be created before migration.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Smart Model Selection Hero */}
      <section id="smart-selection" className="mb-10 scroll-mt-4">
        <div className="bg-surface-raised border border-divider rounded-xl overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            {/* Visualization */}
            <div className="lg:w-2/5 bg-surface p-8 flex flex-col justify-center items-center border-b lg:border-b-0 lg:border-r border-divider relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,#3b82f6_0%,transparent_70%)]" />
              <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-xs">
                <div className="flex items-center justify-between w-full">
                  <div className="size-12 rounded-lg bg-surface-emphasis border border-divider-strong flex items-center justify-center shadow-sm">
                    <Terminal className="w-5 h-5 text-content-subtle" />
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-r from-divider-strong via-blue-500 to-divider-strong mx-2" />
                  <div className="size-12 rounded-lg bg-surface-emphasis border border-divider-strong flex items-center justify-center shadow-sm">
                    <User className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-r from-divider via-blue-500 to-divider mx-2" />
                  <div className="size-12 rounded-lg bg-blue-500 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.4)]">
                    <Zap className="w-5 h-5 text-content" />
                  </div>
                </div>
                <div className="flex justify-between w-full px-2 text-[10px] uppercase tracking-widest font-bold text-content-muted">
                  <span>Task</span>
                  <span>Capability</span>
                  <span>Model</span>
                </div>
              </div>
            </div>
            {/* Content */}
            <div className="lg:w-3/5 p-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-wider rounded border border-blue-500/20">Active</span>
                <h3 className="text-content text-xl font-bold">Smart Model Selection</h3>
              </div>
              <p className="text-content-muted mb-6 leading-relaxed">
                Panopticon automatically routes tasks to the optimal model based on capabilities, token budget, and latency requirements.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-blue-400 mt-1" />
                  <div>
                    <p className="text-sm font-semibold text-content">Capability Matching</p>
                    <p className="text-xs text-content-muted">Best model for each task type</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-blue-400 mt-1" />
                  <div>
                    <p className="text-sm font-semibold text-content">Cost Optimization</p>
                    <p className="text-xs text-content-muted">Balance performance vs spend</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Provider Logins + Configuration */}
      <section id="providers" className="mb-12 scroll-mt-4">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-content text-2xl font-bold">Provider Logins</h2>
          <div className="h-px flex-1 bg-divider-strong" />
          <button
            onClick={() => void refreshProviderAuth()}
            disabled={refreshingAuth}
            className="shrink-0 p-2 rounded-lg border border-divider hover:border-divider-strong text-content-muted hover:text-content transition-colors disabled:opacity-50"
            title="Refresh provider login status"
          >
            <RefreshCw className={`w-4 h-4 ${refreshingAuth ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          <div className="bg-surface-raised border border-divider rounded-xl p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className={`mt-1 size-3 rounded-full shrink-0 ${
                claudeAuth?.loggedIn ? 'bg-emerald-400' :
                claudeAuth?.installed ? 'bg-amber-400' :
                'bg-surface-emphasis'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-content font-bold">Claude Code Login</h3>
                  {claudeAuth?.loggedIn && claudeAuth.subscriptionType && (
                    <span className="text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25">
                      {claudeAuth.subscriptionType.toUpperCase()}
                    </span>
                  )}
                </div>
                {claudeAuth === null ? (
                  <p className="text-content-muted text-sm mt-2">Checking local Claude auth…</p>
                ) : !claudeAuth.installed ? (
                  <p className="text-content-muted text-sm mt-2">
                    Claude Code is not installed on this machine.
                  </p>
                ) : claudeAuth.loggedIn ? (
                  <>
                    <p className="text-content-body text-sm mt-2">
                      Local Claude subscription login detected.
                    </p>
                    {claudeAuth.rateLimitTier && (
                      <p className="text-content-muted text-xs mt-1">
                        Rate tier: <code className="font-mono">{claudeAuth.rateLimitTier}</code>
                      </p>
                    )}
                    {formatAuthTimestamp(claudeAuth.expiresAt) && (
                      <p className="text-content-muted text-xs mt-1">
                        Token expiry: {formatAuthTimestamp(claudeAuth.expiresAt)}
                      </p>
                    )}
                    {claudeAuth.hasAnthropicApiKey && (
                      <p className="text-amber-400 text-xs mt-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span><code className="font-mono">ANTHROPIC_API_KEY</code> is also set and can override subscription auth for direct Anthropic calls.</span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-content-muted text-sm mt-2">
                    No active Claude Code login detected.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-surface-raised border border-divider rounded-xl p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className={`mt-1 size-3 rounded-full shrink-0 ${
                openaiAuth?.loggedIn ? 'bg-emerald-400' :
                openaiAuth?.installed ? 'bg-amber-400' :
                'bg-surface-emphasis'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-content font-bold">OpenAI / Codex Login</h3>
                  {openaiAuth?.loggedIn && (
                    <span className="text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25">
                      ChatGPT OAuth
                    </span>
                  )}
                </div>
                {openaiAuth === null ? (
                  <p className="text-content-muted text-sm mt-2">Checking local Codex auth…</p>
                ) : !openaiAuth.installed ? (
                  <p className="text-content-muted text-sm mt-2">
                    Codex is not installed or initialized on this machine.
                  </p>
                ) : openaiAuth.loggedIn ? (
                  <>
                    <p className="text-content-body text-sm mt-2">
                      Local Codex/ChatGPT login detected. GPT work agents route through the local CLIProxyAPI sidecar using your ChatGPT subscription — no API key required.
                    </p>
                    {openaiAuth.bridgedFromCodex && (
                      <p className="text-content-muted text-xs mt-2">
                        Panopticon synced the local Codex login into the CLIProxyAPI sidecar&apos;s credential store so GPT models can launch correctly.
                      </p>
                    )}
                    {openaiAuth.accountId && (
                      <p className="text-content-muted text-xs mt-1">
                        Account: <code className="font-mono">{openaiAuth.accountId}</code>
                      </p>
                    )}
                    {formatAuthTimestamp(openaiAuth.lastRefresh) && (
                      <p className="text-content-muted text-xs mt-1">
                        Last refresh: {formatAuthTimestamp(openaiAuth.lastRefresh)}
                      </p>
                    )}
                    {openaiAuth.expired && (
                      <p className="text-amber-400 text-xs mt-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>The cached access token is stale, but Codex may still refresh it automatically on next use.</span>
                      </p>
                    )}
                    {openaiAuth.hasOpenAIApiKey && (
                      <p className="text-blue-300 text-xs mt-2 flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>An OpenAI API key is also configured for direct key-based tools, but GPT agent launches stay on the local subscription login while it is active.</span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-content-muted text-sm mt-2">
                    No local Codex/ChatGPT login detected. Without that login, GPT models fall back to API-key auth.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <h2 className="text-content text-2xl font-bold mb-6 flex items-center gap-3">
          Provider Configuration
          <div className="h-px flex-1 bg-divider-strong" />
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PROVIDERS.map((provider) => {
            const isDefault = provider.id === 'anthropic';
            const isEnabled = isDefault || formData.models.providers[provider.id];
            const apiKey = formData.api_keys[provider.id as keyof typeof formData.api_keys] || '';
            const isEnvVarRef = apiKey.startsWith('$');
            const hasConfiguredValue = !!apiKey;
            const hasDirectApiKey = hasConfiguredValue && !isEnvVarRef;
            const canViewModels = provider.id === 'openai'
              ? hasConfiguredValue || !!openaiAuth?.loggedIn
              : hasDirectApiKey;

            return (
              <div
                key={provider.id}
                className={`bg-surface-raised border rounded-xl p-5 relative transition-colors shadow-sm ${
                  isDefault
                    ? 'border-blue-500/50 shadow-lg shadow-blue-500/5'
                    : 'border-divider hover:border-divider-strong'
                }`}
              >
                {isDefault && (
                  <div className="absolute -top-3 right-4">
                    <span className="bg-blue-500 text-content text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-tighter">
                      Default
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3 mb-5">
                  <div className="size-10 rounded-lg bg-surface-emphasis border border-divider flex items-center justify-center">
                    <provider.icon className="w-5 h-5 text-content-subtle" />
                  </div>
                  <span className="font-bold text-content">{provider.name}</span>
                  {isDefault && claudeAuth?.loggedIn && claudeAuth.subscriptionType && (
                    <span className="text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25">
                      {claudeAuth.subscriptionType.toUpperCase()}
                    </span>
                  )}
                  <div className="ml-auto">
                    <button
                      onClick={() => handleProviderToggle(provider.id)}
                      disabled={isDefault}
                      className={`w-10 h-5 rounded-full relative transition-colors ${
                        isEnabled ? 'bg-blue-500' : 'bg-surface-emphasis'
                      } ${isDefault ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div
                        className={`absolute top-0.5 size-4 bg-white rounded-full transition-all ${
                          isEnabled ? 'right-0.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {isDefault ? (
                    <div>
                      <label className="text-[10px] uppercase font-bold text-content-muted mb-1 block">Authentication</label>
                      {claudeAuth?.loggedIn ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="text-xs text-emerald-300 font-medium">
                            Using Claude Code subscription login
                          </span>
                        </div>
                      ) : claudeAuth?.hasAnthropicApiKey ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                          <Key className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="text-xs text-blue-300 font-medium">Using Anthropic API key from environment</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="text-xs text-amber-300">No Claude auth detected. See Provider Logins above.</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {provider.id === 'openai' && (
                        <div>
                          <label className="text-[10px] uppercase font-bold text-content-muted mb-1 block">Authentication</label>
                          {openaiAuth?.loggedIn ? (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="text-xs text-emerald-300 font-medium">
                                  Using Codex subscription login via CLIProxyAPI sidecar
                                </div>
                                {hasConfiguredValue && (
                                  <div className="text-[11px] text-emerald-200/80 mt-0.5">
                                    Any saved OpenAI API key is kept only as a fallback for direct key-based tools. GPT agent launches prefer the subscription login.
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                      <div className="relative">
                        <label className="text-[10px] uppercase font-bold text-content-muted mb-1 block">
                          {provider.id === 'openai' && openaiAuth?.loggedIn ? 'API Key Fallback (Optional)' : 'API Key'}
                        </label>
                        {isEnvVarRef ? (
                          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 text-amber-400 text-xs">
                              <AlertTriangle className="w-4 h-4" />
                              <span>Configured via <code className="font-mono bg-surface-overlay px-1 rounded">{apiKey}</code></span>
                            </div>
                            <p className="text-[10px] text-amber-400/70 mt-1">
                              Set this environment variable or enter the key directly below
                            </p>
                            <input
                              type="text"
                              placeholder={provider.placeholder}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                              autoComplete="off"
                              className="w-full bg-input-bg border border-divider-strong rounded-lg px-3 py-2 text-xs font-mono mt-2 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-content-body"
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
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              data-lpignore="true"
                              data-1p-ignore="true"
                              data-form-type="other"
                              className="w-full bg-input-bg border border-divider-strong rounded-lg px-3 py-2 pr-16 text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-content-body"
                            />
                            <button
                              onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })}
                              className="absolute right-8 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-body"
                            >
                              {showApiKey[provider.id] ? (
                                <Eye className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4 opacity-50" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {!isDefault && (
                    <div className="flex flex-col gap-2">
                      {canViewModels && (
                        <button
                          onClick={() => setModelsModalProvider(provider.id)}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg text-xs text-blue-400 transition-colors w-full"
                        >
                          <BarChart3 className="w-3.5 h-3.5" />
                          View Models
                        </button>
                      )}
                      {hasDirectApiKey && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTestApiKey(provider.id)}
                            disabled={testingProvider === provider.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-emphasis hover:bg-divider-strong border border-divider-strong rounded-lg text-xs text-content-body transition-colors disabled:opacity-50"
                          >
                            {testingProvider === provider.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Beaker className="w-3.5 h-3.5" />
                            )}
                            Test 2+3
                          </button>
                          {testResults[provider.id] && (
                            <div className={`flex items-center gap-1 text-xs ${testResults[provider.id]?.success ? 'text-green-400' : 'text-red-400'}`}>
                              {testResults[provider.id]?.success ? (
                                <CheckCircle className="w-3.5 h-3.5" />
                              ) : (
                                <AlertTriangle className="w-3.5 h-3.5" />
                              )}
                              {testResults[provider.id]?.success
                                ? `${testResults[provider.id]?.latencyMs}ms`
                                : testResults[provider.id]?.error}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* OpenRouter */}
      <section id="openrouter" className="mb-12 scroll-mt-4">
        <h2 className="text-content text-2xl font-bold mb-6 flex items-center gap-3">
          OpenRouter
          <div className="h-px flex-1 bg-divider-strong" />
        </h2>
        <OpenRouterPage
          apiKey={formData.api_keys.openrouter}
          enabled={!!formData.models.providers.openrouter}
          onApiKeyChange={(key) => handleApiKeyChange('openrouter', key)}
          onApiKeySaved={handleOpenRouterKeySaved}
          onToggleEnabled={() => handleProviderToggle('openrouter')}
        />
      </section>

      {/* Conversations */}
      <section id="conversations" className="mb-12 scroll-mt-4">
        <h2 className="text-content text-2xl font-bold mb-6 flex items-center gap-3">
          Conversations
          <div className="h-px flex-1 bg-divider-strong" />
        </h2>
        <p className="text-content-muted text-sm mb-6">
          Control how Panopticon handles compaction for dashboard-owned resume flows and for typed <code>/compact</code> commands in the conversation composer.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-surface-raised border border-divider rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-bold text-content">Compaction &amp; summary model</h3>
              <p className="text-sm text-content-muted mt-1">
                Used for native conversation compaction and as the default summary model when forking conversations. Does not affect Claude Code&apos;s built-in <code>/compact</code>.
              </p>
            </div>
            <select
              value={formData.conversations?.compaction_model || 'claude-haiku-4-5'}
              onChange={(e) => handleCompactionModelChange(e.target.value as ModelId)}
              className="w-full bg-input-bg border border-divider-strong rounded-lg px-3 py-2 text-sm text-content-body focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
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
            <p className="text-xs text-content-muted">
              Default: Claude Haiku 4.5 for fast, low-cost compaction.
            </p>
          </div>

          <div className="bg-surface-raised border border-divider rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-bold text-content">Typed /compact handling</h3>
              <p className="text-sm text-content-muted mt-1">
                Choose whether a user-typed <code>/compact</code> is passed through to Claude Code or intercepted and handled by Panopticon-native compaction.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => handleManualCompactModeChange('claude-code')}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  (formData.conversations?.manual_compact_mode || 'claude-code') === 'claude-code'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-divider bg-surface-raised hover:border-divider-strong'
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <div className="font-bold text-content">Pass through to Claude Code</div>
                    <div className="text-xs text-content-muted font-mono">Default</div>
                  </div>
                  {(formData.conversations?.manual_compact_mode || 'claude-code') === 'claude-code' && (
                    <div className="text-blue-400 text-xs font-semibold">Selected</div>
                  )}
                </div>
                <p className="text-sm text-content-muted">
                  Preserve today&apos;s behavior: sending <code>/compact</code> directly to the Claude Code session.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleManualCompactModeChange('panopticon-native')}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  formData.conversations?.manual_compact_mode === 'panopticon-native'
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-divider bg-surface-raised hover:border-divider-strong'
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <div className="font-bold text-content">Use Panopticon-native compaction</div>
                    <div className="text-xs text-content-muted font-mono">Opt-in override</div>
                  </div>
                  {formData.conversations?.manual_compact_mode === 'panopticon-native' && (
                    <div className="text-emerald-400 text-xs font-semibold">Selected</div>
                  )}
                </div>
                <p className="text-sm text-content-muted">
                  Intercept typed <code>/compact</code> in the dashboard and run Panopticon&apos;s native compaction instead of Claude Code&apos;s built-in command.
                </p>
              </button>
            </div>
          </div>

          <div className="bg-surface-raised border border-divider rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-bold text-content">Richer compaction / forking summaries</h3>
              <p className="text-sm text-content-muted mt-1">
                Use a more verbose 9-section summary format instead of the default 6-section format. Includes all user messages and fuller code snippets.
              </p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-content-body">
                <span className={formData.conversations?.rich_compaction ? 'text-content' : 'text-content-muted'}>
                  {formData.conversations?.rich_compaction ? 'Enabled' : 'Disabled'}
                </span>
                <span className="text-xs text-content-muted ml-2">(default: on)</span>
              </div>
              <button
                type="button"
                onClick={() => handleRichCompactionChange(!formData.conversations?.rich_compaction)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  formData.conversations?.rich_compaction ? 'bg-blue-500' : 'bg-gray-400'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formData.conversations?.rich_compaction ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-xs text-amber-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Higher token usage per summary. Less efficient incremental updates. May hit the context window sooner, requiring more frequent compaction.
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Terminal */}
      <section id="tmux" className="mb-12 scroll-mt-4">
        <h2 className="text-content text-2xl font-bold mb-6 flex items-center gap-3">
          Terminal
          <div className="h-px flex-1 bg-divider-strong" />
        </h2>
        <p className="text-content-muted text-sm mb-6">
          Control whether Panopticon launches tmux in its own managed server with a Panopticon-owned config, or intentionally inherits your user tmux config.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            type="button"
            onClick={() => handleTmuxConfigModeChange('managed')}
            className={`text-left rounded-xl border p-5 transition-colors ${
              (formData.tmux?.config_mode || 'managed') === 'managed'
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-divider bg-surface-raised hover:border-divider-strong'
            }`}
          >
            <div className="flex items-center justify-between gap-4 mb-2">
              <div>
                <div className="font-bold text-content">Managed tmux</div>
                <div className="text-xs text-content-muted font-mono">Default</div>
              </div>
              {(formData.tmux?.config_mode || 'managed') === 'managed' && (
                <div className="text-blue-400 text-xs font-semibold">Selected</div>
              )}
            </div>
            <p className="text-sm text-content-muted">
              Use Panopticon&apos;s own tmux socket and config file. This avoids depending on your dotfiles while preserving Panopticon&apos;s required mouse behavior.
            </p>
          </button>

          <button
            type="button"
            onClick={() => handleTmuxConfigModeChange('inherit-user')}
            className={`text-left rounded-xl border p-5 transition-colors ${
              formData.tmux?.config_mode === 'inherit-user'
                ? 'border-amber-500 bg-amber-500/10'
                : 'border-divider bg-surface-raised hover:border-divider-strong'
            }`}
          >
            <div className="flex items-center justify-between gap-4 mb-2">
              <div>
                <div className="font-bold text-content">Inherit user tmux</div>
                <div className="text-xs text-content-muted font-mono">Advanced opt-out</div>
              </div>
              {formData.tmux?.config_mode === 'inherit-user' && (
                <div className="text-amber-400 text-xs font-semibold">Selected</div>
              )}
            </div>
            <p className="text-sm text-content-muted">
              Use your existing tmux server/config behavior instead of Panopticon-managed tmux. Choose this only if you specifically want Panopticon to follow your personal tmux setup.
            </p>
          </button>
        </div>
      </section>

      {/* Tracker API Keys */}
      <section id="trackers" className="mb-12 scroll-mt-4">
        <h2 className="text-content text-2xl font-bold mb-6 flex items-center gap-3">
          Tracker API Keys
          <div className="h-px flex-1 bg-divider-strong" />
        </h2>
        <p className="text-content-muted text-sm mb-6">
          Configure API keys for your issue trackers. These override environment variables ({TRACKERS.map(t => t.envVar).join(', ')}).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {TRACKERS.map((tracker) => {
            const trackerKey = formData.tracker_keys?.[tracker.id] || '';

            return (
              <div
                key={tracker.id}
                className="bg-surface-raised border border-divider rounded-xl p-5 relative transition-colors shadow-sm hover:border-divider-strong"
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="size-10 rounded-lg bg-surface-emphasis border border-divider flex items-center justify-center">
                    <tracker.icon className="w-5 h-5 text-content-subtle" />
                  </div>
                  <div>
                    <span className="font-bold text-content">{tracker.name}</span>
                    <p className="text-[10px] text-content-muted font-mono">{tracker.envVar}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <label className="text-[10px] uppercase font-bold text-content-muted mb-1 block">API Key / Token</label>
                    {trackerKey.startsWith('$') ? (
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 text-amber-400 text-xs">
                          <AlertTriangle className="w-4 h-4" />
                          <span>Configured via <code className="font-mono bg-surface-overlay px-1 rounded">{trackerKey}</code></span>
                        </div>
                        <input
                          type="text"
                          placeholder={tracker.placeholder}
                          onChange={(e) => handleTrackerKeyChange(tracker.id, e.target.value)}
                          autoComplete="off"
                          className="w-full bg-input-bg border border-divider-strong rounded-lg px-3 py-2 text-xs font-mono mt-2 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-content-body"
                        />
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type={showTrackerKey[tracker.id] ? 'text' : 'password'}
                          value={trackerKey}
                          onChange={(e) => handleTrackerKeyChange(tracker.id, e.target.value)}
                          placeholder={tracker.placeholder}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          className="w-full bg-input-bg border border-divider-strong rounded-lg px-3 py-2 pr-10 text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-content-body"
                        />
                        <button
                          onClick={() => setShowTrackerKey({ ...showTrackerKey, [tracker.id]: !showTrackerKey[tracker.id] })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-body"
                        >
                          {showTrackerKey[tracker.id] ? (
                            <Eye className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4 opacity-50" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Agent Configuration by Category */}
      <section id="model-assignments" className="mb-12 scroll-mt-4">
        <h2 className="text-content text-2xl font-bold mb-2 flex items-center gap-3">
          Model Assignments
          <div className="h-px flex-1 bg-divider-strong" />
        </h2>
        <p className="text-content-muted text-sm mb-5 leading-relaxed">
          Assign models to specific <strong className="text-content-body">work types</strong> — the internal routing identifiers that Panopticon uses to resolve which model an agent or workflow step should use. Click any card to change its model.
        </p>

        <div className="space-y-8">
          {AGENT_CATEGORIES.map((category) => (
            <div key={category.name}>
              <div className="flex items-center gap-2 mb-4">
                <category.icon className="w-5 h-5 text-content-muted" />
                <h3 className="text-content-body font-semibold text-sm uppercase tracking-wider">{category.name}</h3>
                <div className="h-px flex-1 bg-divider" />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {category.agents.map((agent) => {
                  const currentModelId = getEffectiveModelId(agent.id, formData.models.overrides);
                  const modelDisplay = getModelDisplay(currentModelId);
                  const { score, matched, missing } = getCapabilityMatchScore(currentModelId, agent.id);
                  const requiredCaps = WORK_TYPE_CAPABILITIES[agent.id] || [];

                  // Check if this model is deprecated
                  const isDeprecated = formData.deprecation_warnings?.some(
                    (w) => w.workType === agent.id && w.from === currentModelId
                  );

                  // Determine fit quality (poor fit is implicit else case)
                  const isGoodFit = score >= 1 && !isDeprecated;
                  const isOkFit = score >= 0.5 && score < 1 && !isDeprecated;

                  // Build hover text
                  const hoverText = [
                    `${agent.name}: ${agent.description}`,
                    !agent.implemented ? '⚠️ NOT YET IMPLEMENTED' : '',
                    `Model: ${modelDisplay}`,
                    isDeprecated ? '⚠️ DEPRECATED: Click to update to current model' : '',
                    `Needs: ${requiredCaps.map(c => CAPABILITY_INFO[c].name).join(', ')}`,
                    matched.length > 0 ? `✓ Has: ${matched.map(c => CAPABILITY_INFO[c].name).join(', ')}` : '',
                    missing.length > 0 ? `✗ Missing: ${missing.map(c => CAPABILITY_INFO[c].name).join(', ')}` : '',
                  ].filter(Boolean).join('\n');

                  return (
                    <div
                      key={agent.id}
                      onClick={() => agent.implemented && setModalWorkType(agent.id)}
                      title={hoverText}
                      className={`p-3 border rounded-lg transition-all group relative ${
                        !agent.implemented
                          ? 'opacity-50 bg-surface-emphasis border-divider cursor-not-allowed'
                          : `cursor-pointer ${
                            isDeprecated
                              ? 'bg-amber-500/10 border-amber-500/50 hover:border-amber-500/70 hover:bg-amber-500/15'
                              : isGoodFit
                                ? 'bg-emerald-500/5 border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/10'
                                : isOkFit
                                  ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/10'
                                  : 'bg-rose-500/5 border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/10'
                            }`
                      }`}
                    >
                      {isDeprecated && (
                        <div className="absolute top-1 right-1">
                          <span className="bg-amber-500 text-content text-[8px] font-black px-1 py-0.5 rounded uppercase tracking-tighter">
                            DEPRECATED
                          </span>
                        </div>
                      )}
                      {!agent.implemented && (
                        <div className="absolute top-1 right-1">
                          <span className="bg-gray-500 text-content text-[8px] font-black px-1 py-0.5 rounded uppercase tracking-tighter">
                            NOT YET IMPLEMENTED
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <agent.icon className={`w-4 h-4 ${
                          isDeprecated ? 'text-amber-400' : isGoodFit ? 'text-emerald-400' : isOkFit ? 'text-amber-400' : 'text-rose-400'
                        }`} />
                        {agent.implemented && (
                          <span className={`text-[9px] font-bold ${
                            isDeprecated ? 'text-amber-400' : isGoodFit ? 'text-emerald-400' : isOkFit ? 'text-amber-400' : 'text-rose-400'
                          }`}>
                            {Math.round(score * 100)}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-content truncate">{agent.name}</p>
                      {agent.implemented && <p className="text-[10px] text-content-muted truncate mb-2">{modelDisplay}</p>}

                      {/* Capability indicators */}
                      <div className="flex gap-1 flex-wrap">
                        {requiredCaps.slice(0, 3).map((cap: Capability) => {
                          const hasIt = matched.includes(cap);
                          return (
                            <span
                              key={cap}
                              title={`${CAPABILITY_INFO[cap].name}: ${hasIt ? 'Model has this' : 'Model missing this'}`}
                              className={`text-[8px] px-1 py-0.5 rounded ${
                                hasIt
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {CAPABILITY_INFO[cap].name}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Maintenance */}
      <section id="maintenance" className="space-y-3 pb-20 scroll-mt-4">
        <h2 className="text-xl font-black text-content">Maintenance</h2>
        <div className="bg-surface-emphasis rounded-xl border border-divider p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-content flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-content-subtle" />
                Issue Cache
              </h3>
              <p className="text-xs text-content-muted mt-1">
                Clear cached issue data and re-fetch from all trackers. Use this if issue identifiers or data appear stale.
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
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-divider hover:border-amber-500/50 hover:bg-amber-500/10 text-content-muted hover:text-amber-400 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {clearingCache ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {clearingCache ? 'Clearing...' : 'Clear & Refresh'}
            </button>
          </div>
        </div>
      </section>
      </div>{/* end main content */}

      {/* Section Sub-Navigation */}
      <nav className="hidden xl:block w-44 shrink-0">
        <div className="sticky top-8">
          <p className="text-[10px] uppercase font-bold text-content-muted tracking-widest mb-3 px-2">On this page</p>
          <div className="space-y-0.5">
            {SETTINGS_SECTIONS.map((section) => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                    isActive
                      ? 'text-blue-400 bg-blue-500/10 font-semibold'
                      : 'text-content-muted hover:text-content-body hover:bg-surface-emphasis'
                  }`}
                >
                  <section.icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-content-subtle'}`} />
                  <span className="truncate">{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
      </div>{/* end flex container */}

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-surface backdrop-blur-md border-t border-divider-strong shadow-[0_-2px_10px_rgba(0,0,0,0.05)] px-6 py-4 z-40">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-content-muted text-sm">
            {saveMutation.isSuccess && (
              <>
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-green-400">Settings saved!</span>
              </>
            )}
            {saveMutation.isError && (
              <>
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-red-400">Error saving settings</span>
              </>
            )}
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleRestoreOptimalDefaults}
              className="px-6 py-2 text-amber-400 hover:text-amber-300 font-semibold text-sm transition-colors flex items-center gap-1.5"
              title="Set all model assignments to research-based optimal defaults"
            >
              <Zap className="w-4 h-4" />
              Optimal Defaults
            </button>
            <button
              onClick={handleReset}
              disabled={!hasChanges}
              className="px-6 py-2 text-content-muted hover:text-content font-semibold text-sm transition-colors disabled:opacity-50"
            >
              Undo Changes
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
              className="px-8 py-2 bg-blue-500 hover:bg-blue-400 text-content font-black rounded-lg transition-all shadow-lg shadow-blue-500/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </footer>

      {/* Model Override Modal */}
      {modalWorkType && (
        <ModelOverrideModal
          workType={modalWorkType}
          currentModel={getEffectiveModelId(modalWorkType, formData.models.overrides)}
          isOverride={!!formData.models.overrides[modalWorkType]}
          enabledProviders={Object.entries(formData.models.providers)
            .filter(([_, enabled]) => enabled)
            .map(([provider]) => provider)}
          openRouterFavorites={openRouterFavoriteModels}
          onApply={(model) => handleSetOverride(modalWorkType, model)}
          onRemove={() => handleRemoveOverride(modalWorkType)}
          onClose={() => setModalWorkType(null)}
        />
      )}

      {/* Provider Models Modal */}
      {modelsModalProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-raised border border-divider-strong rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-divider">
              <div className="flex items-center gap-3">
                {(() => {
                  const Icon = PROVIDERS.find(p => p.id === modelsModalProvider)?.icon;
                  return Icon ? <Icon className="w-5 h-5 text-blue-400" /> : null;
                })()}
                <h3 className="text-content text-lg font-bold">
                  {PROVIDERS.find(p => p.id === modelsModalProvider)?.name} Models
                </h3>
              </div>
              <button
                onClick={() => setModelsModalProvider(null)}
                className="text-content-muted hover:text-content transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {(() => {
                const providerApiKey = formData?.api_keys[modelsModalProvider as keyof typeof formData.api_keys] || '';
                const isEnvVarRef = providerApiKey.startsWith('$');
                const canUseSubscriptionLogin = modelsModalProvider === 'openai' && !!openaiAuth?.loggedIn;

                if (!providerApiKey && !canUseSubscriptionLogin) {
                  return (
                    <div className="text-center py-8">
                      <Key className="w-10 h-10 text-content-muted mb-2 mx-auto" />
                      <p className="text-content-muted">Enter an API key to test models</p>
                    </div>
                  );
                }

                if (isEnvVarRef) {
                  return (
                    <div className="text-center py-8">
                      <AlertTriangle className="w-10 h-10 text-amber-500 mb-2 mx-auto" />
                      <p className="text-amber-400">API key configured via environment variable</p>
                      <p className="text-content-muted text-sm mt-1">
                        <code className="font-mono bg-surface-overlay px-1 rounded">{providerApiKey}</code> is not set
                      </p>
                      <p className="text-content-muted text-xs mt-2">Set the environment variable or enter the key directly in Settings</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                  {canUseSubscriptionLogin && !providerApiKey && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <p className="text-emerald-300 text-xs">
                        GPT agents use the local Codex subscription login. Model testing in this dialog still requires a direct API key.
                      </p>
                    </div>
                  )}
                  {(MODELS_BY_PROVIDER[modelsModalProvider]?.models || []).map((model) => {
                    const testKey = `${modelsModalProvider}:${model.id}`;
                    const testResult = modelTestResults[testKey];
                    const isTesting = testingModel === testKey;
                    const canTestModel = !!providerApiKey && !isEnvVarRef;

                    return (
                      <div
                        key={model.id}
                        className="bg-surface border border-divider rounded-lg p-4 hover:border-divider-strong transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {/* Model icons are strings (Material Symbols names) - render as text fallback */}
                              <div className="w-4 h-4 flex items-center justify-center text-content-muted text-[10px]">
                                {typeof model.icon === 'string' ? model.icon[0] : '◆'}
                              </div>
                              <h4 className="text-content font-semibold">{model.name}</h4>
                              {model.tier && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  model.tier === 'premium' ? 'bg-purple-500/20 text-purple-400' :
                                  model.tier === 'balanced' ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-emerald-500/20 text-emerald-400'
                                }`}>
                                  {model.tier}
                                </span>
                              )}
                            </div>
                            {model.description && (
                              <p className="text-xs text-content-muted mb-2">{model.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {model.capabilities.map((cap) => (
                                <span
                                  key={cap}
                                  className="text-[9px] px-1.5 py-0.5 bg-surface-emphasis text-content-subtle rounded border border-divider"
                                >
                                  {cap}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <button
                              onClick={() => handleTestModel(modelsModalProvider, model.id)}
                              disabled={!canTestModel || isTesting}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-xs text-emerald-400 transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                              {isTesting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Zap className="w-3.5 h-3.5" />
                              )}
                              Test 2+3
                            </button>
                            {testResult && (
                              <div className={`flex items-center gap-1 text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
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
            <div className="p-4 border-t border-divider bg-surface">
              <p className="text-xs text-content-muted text-center">
                Test verifies API key and model availability by asking "What is 2+3?"
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
