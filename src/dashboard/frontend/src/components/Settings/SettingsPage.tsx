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
  Terminal,
  Brain,
  SplitSquareVertical,
  BarChart3,
  Route,
  MessageCircle,
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
  Volume2,
  Mic,
  Gauge,
  Globe,
} from 'lucide-react';
import { SettingsConfig, Provider, ModelId, type Harness, type HarnessOverride, type TtsConfig, type BackgroundAiConfig, type BackgroundAiFeature, type ConversationSearchConfig, type VoiceHardwareSettings, type VoiceSettings, BACKGROUND_AI_FEATURE_META } from './types';
import { consumePendingSettingsSection, SETTINGS_SECTION_EVENT } from '../../lib/settingsSection';
import { useUIPreferences } from '../../hooks/useUIPreferences';
import { useDiffPreferences } from '../../hooks/useDiffPreferences';
import { useCodexAuthStatus } from '../../hooks/useCodexAuthStatus';
import { setReauthSession } from '../../lib/pending-codex-spawn';
import { OpenRouterPage } from './OpenRouterPage';
import { SensitiveText } from '../SensitiveText';
import { DesktopSettingsSection } from './DesktopSettingsSection';
import { WorkhorsePanel } from './WorkhorsePanel';
import { RolesPanel } from './RolesPanel';
import { VoiceSettingsSection } from './sections/VoiceSettingsSection';
import { SavedVoicesTab } from './SavedVoicesTab';
import { VoiceDesignTab } from './VoiceDesignTab';
import { VoicePresetsTab } from './VoicePresetsTab';
import { TtsSystemVoicePicker } from './TtsSystemVoicePicker';
import { MODELS_BY_PROVIDER, type OpenRouterFavoriteModel } from './modelCatalog';
import { ReindexConfirmDialog } from './ReindexConfirmDialog';
import { LegacyImportDialog } from './LegacyImportDialog';
import { HarnessLogo, ProviderLogo } from '../shared/branding';
import {
  SettingsLayout,
  SettingsHeader,
  SettingsSidebarNav,
  SettingsSection,
  SettingsRow,
  type NavItem,
} from './primitives';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../lib/wsTransport';
import { AUTOSAVE_DEBOUNCE_MS, useAutosavePipeline } from './hooks/useAutosavePipeline';

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

const HARNESS_LABELS: Record<Harness, string> = {
  'claude-code': 'Claude Code',
  ohmypi: 'oh-my-pi',
  codex: 'Codex',
};

function harnessLabel(harness: Harness): string {
  return HARNESS_LABELS[harness];
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

interface ConversationSearchStatusResponse {
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
  dbPath: string;
  chunkCount: number;
  indexedFileCount: number;
  lastIndexedAt: string | null;
}

async function fetchConversationSearchStatus(): Promise<ConversationSearchStatusResponse> {
  const res = await fetch('/api/settings/conversation-search/status', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch conversation search status');
  return res.json();
}

interface ConversationSearchCostEstimate {
  provider: 'openai';
  model: string;
  tokenCount: number;
  pricePerMillionTokens: number;
  estimatedUsd: number;
  filesScanned: number;
  chunksEstimated: number;
  disabled: boolean;
  unavailableReason?: string;
  confirmationNonce?: string;
}

async function estimateConversationSearchReindex(model?: string): Promise<ConversationSearchCostEstimate> {
  // Pass ?model= to price a prospective model switch before it's saved.
  const qs = model ? `?model=${encodeURIComponent(model)}` : '';
  const res = await fetch(`/api/settings/conversation-search/reindex-estimate${qs}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to estimate reindex cost (${res.status})`);
  }
  return res.json();
}

async function reindexConversationSearch(confirmationNonce?: string): Promise<{ filesScanned: number; chunksIndexed: number; disabled: boolean; unavailableReason?: string }> {
  const res = await fetch('/api/settings/conversation-search/reindex', {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ confirmationNonce }),
  });
  if (!res.ok) throw new Error('Failed to reindex conversations');
  return res.json();
}

interface TtsHealthResponse {
  ok: boolean;
  running: boolean;
  pid: number | null;
  daemonHost: string;
  daemonPort: number;
  phase?: 'stopped' | 'starting' | 'healthy' | 'unhealthy';
  initializing?: boolean;
  queueDepth?: number;
  model?: unknown;
  uptimeSeconds?: number;
  gpuMemoryUsedMb?: number;
  error?: string;
}

interface TtsVoiceListItem {
  id: string;
  name: string;
  kind: 'preset' | 'design' | 'clone';
  presetName?: string;
  description?: string;
  instruct?: string;
}

async function fetchTtsHealth(): Promise<TtsHealthResponse> {
  const res = await fetch('/api/tts/health');
  if (!res.ok) throw new Error('Failed to fetch TTS health');
  return res.json();
}

async function startTtsDaemonRequest(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/tts/start', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok !== true) throw new Error(body.error ?? body.status?.error ?? 'Failed to start TTS daemon');
  return body;
}

function formatTtsUptime(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatTtsGpuMemory(mb: number | undefined): string | undefined {
  if (mb === undefined) return undefined;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB VRAM` : `${mb}MB VRAM`;
}

async function fetchTtsVoices(): Promise<TtsVoiceListItem[]> {
  const res = await fetch('/api/tts/voices');
  if (!res.ok) throw new Error('Failed to fetch TTS voices');
  return res.json();
}

interface SaveSettingsResponse {
  success: boolean;
  message: string;
  warnings?: string[];
}

interface CloisterConfig {
  concurrency?: {
    max_work_agents?: number;
    reserved_advancing_slots?: number;
    exempt_operator_started?: boolean;
  };
  [key: string]: unknown;
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

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stt: {
    provider: 'moonshine',
    moonshine: { model: 'base' },
    googleCloud: { apiKey: '', model: 'latest_long' },
  },
  autopreso: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
};

const DEFAULT_VOICE_HARDWARE_SETTINGS: VoiceHardwareSettings = {
  inputDevice: '',
  outputDevice: '',
  volume: 1,
};

const VOICE_HARDWARE_STORAGE_KEY = 'overdeck.voice.hardwareSettings';

function loadVoiceHardwareSettings(): VoiceHardwareSettings {
  try {
    const raw = window.localStorage.getItem(VOICE_HARDWARE_STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_HARDWARE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VoiceHardwareSettings>;
    return {
      inputDevice: typeof parsed.inputDevice === 'string' ? parsed.inputDevice : '',
      outputDevice: typeof parsed.outputDevice === 'string' ? parsed.outputDevice : '',
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 1,
    };
  } catch {
    return DEFAULT_VOICE_HARDWARE_SETTINGS;
  }
}

function normalizeVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  return {
    stt: settings.stt ?? DEFAULT_VOICE_SETTINGS.stt,
    autopreso: settings.autopreso ?? DEFAULT_VOICE_SETTINGS.autopreso,
  };
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
    agents: { ...(formData?.agents || miniMaxDefaults.agents || {}) },
    tracker_keys: { ...(formData?.tracker_keys || {}) },
    conversationSearch: { ...(formData?.conversationSearch || miniMaxDefaults.conversationSearch || {}) },
    conversations: { ...(formData?.conversations || miniMaxDefaults.conversations || {}) },
    memory: { ...(formData?.memory || miniMaxDefaults.memory || {}) },
    tmux: { ...(formData?.tmux || miniMaxDefaults.tmux || {}) },
    openrouter: { ...(formData?.openrouter || miniMaxDefaults.openrouter || {}) },
    tts: { ...(formData?.tts || miniMaxDefaults.tts || {}) },
    remote: { ...(formData?.remote || miniMaxDefaults.remote || {}) },
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
const PROVIDERS: { id: Provider; name: string; placeholder: string }[] = [
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
  { id: 'google', name: 'Google', placeholder: 'AIza...' },
  { id: 'kimi', name: 'Kimi (Moonshot)', placeholder: 'sk-kimi-...' },
  { id: 'zai', name: 'Zhipu (GLM)', placeholder: 'sk-zai-...' },
  { id: 'minimax', name: 'MiniMax', placeholder: 'eyJ...' },
  { id: 'mimo', name: 'Xiaomi MiMo', placeholder: 'sk-... or tp-...' },
  { id: 'nous', name: 'Nous Portal', placeholder: 'ns-...' },
  { id: 'dashscope', name: 'Alibaba DashScope', placeholder: 'sk-...' },
];

const TTS_EVENT_KEYS = [
  'reviewStatus.passed',
  'reviewStatus.failed',
  'reviewStatus.blocked',
  'testStatus.testing',
  'testStatus.passed',
  'testStatus.failed',
  'testStatus.skipped',
  'testStatus.dispatch_failed',
  'verificationStatus.passed',
  'verificationStatus.failed',
  'verificationStatus.skipped',
  'mergeStatus.queued',
  'mergeStatus.merging',
  'mergeStatus.verifying',
  'mergeStatus.merged',
  'mergeStatus.failed',
  'readyForMerge',
] as const;

const ACTIVITY_SOURCE_OPTIONS = [
  'merge-agent',
  'review-specialist',
  'test-specialist',
  'cloister',
  'work-agent',
  'planning-agent',
  'dashboard',
  'deploy-script',
] as const;

// Tracker definitions
type TrackerType = 'linear' | 'github' | 'gitlab' | 'rally';
const TRACKERS: { id: TrackerType; name: string; icon: any; envVar: string; placeholder: string }[] = [
  { id: 'linear', name: 'Linear', icon: BarChart3, envVar: 'LINEAR_API_KEY', placeholder: 'lin_api_...' },
  { id: 'github', name: 'GitHub', icon: Code, envVar: 'GITHUB_TOKEN', placeholder: 'ghp_...' },
  { id: 'gitlab', name: 'GitLab', icon: GitBranch, envVar: 'GITLAB_TOKEN', placeholder: 'glpat-...' },
  { id: 'rally', name: 'Rally', icon: Flag, envVar: 'RALLY_API_KEY', placeholder: '_abc123...' },
];

/** Cost-ledger source tag per background feature (matches the backend tags). */
const BG_FEATURE_COST_SOURCE: Record<BackgroundAiFeature, string> = {
  conversationTitles: 'background:conversationTitles',
  titleRefinement: 'background:titleRefinement',
  memoryExtraction: 'memory-extraction',
  memoryQueryExpansion: 'background:memoryQueryExpansion',
  conversationEnrichment: 'background:conversationEnrichment',
  sessionEmbeddings: 'background:sessionEmbeddings',
  summaryFork: 'background:summaryFork',
  ttsSummarizer: 'background:ttsSummarizer',
};

/** Known embedding models per provider for the embeddings picker (PAN-1589). */
interface EmbeddingModelOption {
  id: string;
  label: string;
  description: string;
}

const EMBEDDING_MODELS_BY_PROVIDER: Record<string, EmbeddingModelOption[]> = {
  openai: [
    { id: 'text-embedding-3-small', label: 'text-embedding-3-small', description: 'Recommended · 1536-dim · $0.02 / 1M tokens — cheap & fast' },
    { id: 'text-embedding-3-large', label: 'text-embedding-3-large', description: 'Higher quality · 3072-dim · $0.13 / 1M tokens' },
    { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002', description: 'Legacy · 1536-dim — prefer 3-small' },
  ],
  voyage: [
    { id: 'voyage-code-3', label: 'voyage-code-3', description: 'Code-optimized · $0.18 / 1M tokens' },
    { id: 'voyage-3', label: 'voyage-3', description: 'General-purpose semantic embeddings' },
  ],
  ollama: [
    { id: 'nomic-embed-text', label: 'nomic-embed-text', description: 'Local via Ollama · free · nothing leaves your machine' },
    { id: 'mxbai-embed-large', label: 'mxbai-embed-large', description: 'Local via Ollama · free · larger, higher quality' },
  ],
};

const SETTINGS_NAV_ITEMS: NavItem[] = [
  { id: 'model-routing', label: 'Model Routing', icon: Route },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'cloister', label: 'Cloister', icon: Flag },
  { id: 'remote', label: 'Remote', icon: Globe },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'background-ai', label: 'Background AI', icon: Gauge },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'tts', label: 'TTS', icon: Volume2 },
  { id: 'tracker-keys', label: 'Tracker Keys', icon: GitBranch },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'diff', label: 'Diff', icon: SplitSquareVertical },
  { id: 'desktop', label: 'Desktop App', icon: Monitor },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'experimental', label: 'Experimental', icon: Beaker },
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
  const { data: ttsHealth } = useQuery({
    queryKey: ['tts-health'],
    queryFn: fetchTtsHealth,
    refetchInterval: 10_000,
  });
  const { data: conversationSearchStatus } = useQuery({
    queryKey: ['conversation-search-status'],
    queryFn: fetchConversationSearchStatus,
    refetchInterval: 30_000,
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
  const ttsVoicesQuery = useQuery({
    queryKey: ['tts-voices'],
    queryFn: fetchTtsVoices,
    staleTime: 60_000,
  });
  const ttsVoices = ttsVoicesQuery.data ?? [];
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
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [showTrackerKey, setShowTrackerKey] = useState<Record<string, boolean>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [modelsModalProvider, setModelsModalProvider] = useState<Provider | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
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
  const [activeTtsVoiceTab, setActiveTtsVoiceTab] = useState<'presets' | 'design'>('presets');
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
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

  // ── Conversations & Search (embedding) config ──────────────────────────────
  const [convConfig, setConvConfig] = useState<{
    embeddings: boolean;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingAutoOnDeep: boolean;
  } | null>(null);
  const [convConfigDirty, setConvConfigDirty] = useState(false);
  const [convConfigSaving, setConvConfigSaving] = useState(false);
  const [convConfigLoading, setConvConfigLoading] = useState(true);
  const [convConfigError, setConvConfigError] = useState<string | null>(null);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [conversationSearchEstimate, setConversationSearchEstimate] = useState<ConversationSearchCostEstimate | null>(null);
  const [estimatingConversationSearch, setEstimatingConversationSearch] = useState(false);
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);
  const [reindexConfirm, setReindexConfirm] = useState<{
    kind: 'manual' | 'model';
    newModel?: string;
    estimate: ConversationSearchCostEstimate | null;
  } | null>(null);
  const [reindexConfirmBusy, setReindexConfirmBusy] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<{
    active: boolean;
    filesScanned: number;
    filesIndexed: number;
    chunksIndexed: number;
    currentFile?: string;
  } | null>(null);

  const fetchClaudeAuth = async () => {
    try {
      const res = await fetch('/api/settings/claude-auth');
      if (res.ok) setClaudeAuth(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { void fetchClaudeAuth(); }, []);

  const loadConvConfig = useCallback(() => {
    setConvConfigLoading(true);
    setConvConfigError(null);
    ensureDashboardSession()
      .then(() => fetch('/api/discovered-sessions/config', { credentials: 'include' }))
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load embedding settings (HTTP ${r.status})`);
        return r.json();
      })
      .then((d) => setConvConfig(d))
      .catch((e) => setConvConfigError(e instanceof Error ? e.message : String(e)))
      .finally(() => setConvConfigLoading(false));
  }, []);

  useEffect(() => { loadConvConfig(); }, [loadConvConfig]);

  const handleConvConfigChange = (patch: Partial<typeof convConfig>) => {
    setConvConfig((prev) => prev ? { ...prev, ...patch } : null);
    setConvConfigDirty(true);
    setEmbeddingTestResult(null);
  };

  const handleSaveConvConfig = async () => {
    if (!convConfig) return;
    setConvConfigSaving(true);
    try {
      await ensureDashboardSession();
      const res = await fetch('/api/discovered-sessions/config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(convConfig),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setFormData((prev) => prev ? {
        ...prev,
        conversations: {
          ...prev.conversations,
          embeddings: convConfig.embeddings,
          embedding_provider: convConfig.embeddingProvider as 'openai' | 'voyage' | 'ollama',
          embedding_model: convConfig.embeddingModel,
          embedding_auto_on_deep: convConfig.embeddingAutoOnDeep,
        },
      } : prev);
      setConvConfigDirty(false);
      toast.success('Embedding settings saved');
    } catch (err) {
      toast.error(`Failed to save embedding settings: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConvConfigSaving(false);
    }
  };

  const handleTestEmbeddingConnection = async () => {
    if (!convConfig) return;
    setTestingEmbedding(true);
    setEmbeddingTestResult(null);
    try {
      await ensureDashboardSession();
      const res = await fetch('/api/discovered-sessions/test-connection', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: convConfig.embeddingProvider,
          model: convConfig.embeddingModel,
        }),
      });
      const result = await res.json();
      setEmbeddingTestResult(result);
    } catch (err) {
      setEmbeddingTestResult({ ok: false, error: String(err) });
    } finally {
      setTestingEmbedding(false);
    }
  };

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

  const conversationSearchReindexMutation = useMutation({
    mutationFn: reindexConversationSearch,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['conversation-search-status'] });
      if (result.disabled) {
        toast.warning(result.unavailableReason ?? 'Conversation search is disabled');
      } else {
        toast.success(`Reindexed ${result.chunksIndexed} chunk${result.chunksIndexed === 1 ? '' : 's'} from ${result.filesScanned} file${result.filesScanned === 1 ? '' : 's'}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to reindex conversations: ${error.message}`);
    },
  });

  // Poll live reindex progress while a reindex is running so the UI can show a real bar.
  const conversationSearchReindexPending = conversationSearchReindexMutation.isPending;
  useEffect(() => {
    if (!conversationSearchReindexPending) {
      setReindexProgress(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/settings/conversation-search/reindex-progress', { credentials: 'include' });
        if (res.ok && !cancelled) setReindexProgress(await res.json());
      } catch { /* ignore transient poll errors */ }
    };
    void poll();
    const id = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [conversationSearchReindexPending]);

  // Open the confirm modal immediately, then fill in the cost estimate (scanning every
  // transcript can take a few seconds). `model` prices a prospective switch.
  const openReindexConfirm = async (kind: 'manual' | 'model', newModel?: string) => {
    setReindexConfirm({ kind, newModel, estimate: null });
    setEstimatingConversationSearch(true);
    try {
      const estimate = await estimateConversationSearchReindex(newModel);
      setConversationSearchEstimate(estimate);
      setReindexConfirm((prev) => (prev && prev.kind === kind && prev.newModel === newModel ? { ...prev, estimate } : prev));
    } catch (error) {
      toast.error(`Failed to estimate reindex cost: ${error instanceof Error ? error.message : String(error)}`);
      setReindexConfirm(null);
    } finally {
      setEstimatingConversationSearch(false);
    }
  };

  const handleConversationSearchReindex = () => { void openReindexConfirm('manual'); };

  // Switching the embedding model invalidates every cached vector (they're model-specific)
  // and forces a paid full reindex, so confirm before applying.
  const handleEmbeddingModelChange = (newModel: string) => {
    if (newModel === conversationSearchModel) return;
    void openReindexConfirm('model', newModel);
  };

  const cancelReindexConfirm = () => { if (!reindexConfirmBusy) setReindexConfirm(null); };

  const confirmReindex = async () => {
    if (!reindexConfirm || !reindexConfirm.estimate || reindexConfirm.estimate.disabled) return;
    const { kind, newModel, estimate } = reindexConfirm;
    if (kind === 'model' && newModel) {
      if (!formData || !voiceFormData) return;
      setReindexConfirmBusy(true);
      const next: SettingsConfig = {
        ...formData,
        conversationSearch: { ...(formData.conversationSearch ?? {}), model: newModel },
      };
      setFormData(next);
      scheduleAutosave({ settings: next, voiceSettings: voiceFormData });
      const saved = await flushAutosave();
      if (!saved) {
        // The autosave pipeline surfaces its own error toast; leave the modal open to retry.
        setReindexConfirmBusy(false);
        return;
      }
      conversationSearchReindexMutation.mutate(estimate.confirmationNonce);
      setReindexConfirmBusy(false);
      setReindexConfirm(null);
      return;
    }
    conversationSearchReindexMutation.mutate(estimate.confirmationNonce);
    setReindexConfirm(null);
  };

  const ttsStartMutation = useMutation({
    mutationFn: startTtsDaemonRequest,
    onSuccess: () => {
      toast.success('TTS daemon started');
      queryClient.invalidateQueries({ queryKey: ['tts-health'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to start TTS daemon: ${error.message}`);
      queryClient.invalidateQueries({ queryKey: ['tts-health'] });
    },
  });

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

  const conversationSearch = formData.conversationSearch ?? {};
  const conversationSearchEnabled = conversationSearch.enabled ?? false;
  const conversationSearchModel = conversationSearch.model ?? 'text-embedding-3-small';

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

  const handleProviderToggle = (provider: Provider) => {
    applySettings({
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
    applySettings({
      ...formData,
      api_keys: {
        ...formData.api_keys,
        [provider]: key || undefined,
      },
    }, { debounce: true });
  };

  const handleProviderHarnessChange = (provider: Provider, harness: HarnessOverride) => {
    const nextProviderHarnesses = { ...formData.models.provider_harnesses };
    if (harness === '') {
      delete nextProviderHarnesses[provider];
    } else {
      nextProviderHarnesses[provider] = harness;
    }

    applySettings({
      ...formData,
      models: {
        ...formData.models,
        provider_harnesses: nextProviderHarnesses,
      },
    });
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

  const handleTtsConfigChange = (patch: Partial<TtsConfig>, options: { debounce?: boolean } = {}) => {
    const nextTts = {
      ...formData.tts,
      ...patch,
    };
    applySettings({
      ...formData,
      tts: nextTts,
    }, { debounce: options.debounce === true });
  };

  const handleTtsVoiceMapChange = (eventKey: string, voiceId: string) => {
    const nextVoiceMap = { ...(ttsConfig.voiceMap ?? {}) };
    if (voiceId) nextVoiceMap[eventKey] = voiceId;
    else delete nextVoiceMap[eventKey];
    handleTtsConfigChange({ voiceMap: nextVoiceMap });
  };

  const handleTtsMutedSourceChange = (source: string, muted: boolean) => {
    const current = ttsConfig.mutedSources ?? [];
    const nextMutedSources = muted
      ? Array.from(new Set([...current, source]))
      : current.filter((value) => value !== source);
    handleTtsConfigChange({ mutedSources: nextMutedSources });
  };

  const handleTtsTemplateChange = (eventKey: string, text: string) => {
    handleTtsConfigChange({
      utteranceTemplates: {
        ...(ttsConfig.utteranceTemplates ?? {}),
        [eventKey]: text,
      },
    });
  };

  const handleTtsTemplateKeyChange = (oldKey: string, newKey: string) => {
    const nextTemplates = { ...(ttsConfig.utteranceTemplates ?? {}) };
    const text = nextTemplates[oldKey] ?? '';
    delete nextTemplates[oldKey];
    nextTemplates[newKey] = text;
    handleTtsConfigChange({ utteranceTemplates: nextTemplates });
  };

  const handleRemoveTtsTemplate = (eventKey: string) => {
    const nextTemplates = { ...(ttsConfig.utteranceTemplates ?? {}) };
    delete nextTemplates[eventKey];
    handleTtsConfigChange({ utteranceTemplates: nextTemplates });
  };

  const handleAddTtsTemplate = () => {
    const templates = ttsConfig.utteranceTemplates ?? {};
    const eventKey = TTS_EVENT_KEYS.find((key) => templates[key] === undefined);
    if (!eventKey) return;
    handleTtsConfigChange({
      utteranceTemplates: {
        ...templates,
        [eventKey]: '',
      },
    });
  };

  const handleCompactionModelChange = (modelId: ModelId) => {
    applySettings({
      ...formData,
      conversations: {
        ...formData.conversations,
        compaction_model: modelId,
      },
    });
  };

  const handleTitleModelChange = (modelId: ModelId) => {
    applySettings({
      ...formData,
      conversations: {
        ...formData.conversations,
        title_model: modelId,
      },
    });
  };

  const handleManualCompactModeChange = (mode: 'claude-code' | 'overdeck-native') => {
    applySettings({
      ...formData,
      conversations: {
        ...formData.conversations,
        manual_compact_mode: mode,
      },
    });
  };

  const handleRichCompactionChange = (enabled: boolean) => {
    applySettings({
      ...formData,
      conversations: {
        ...formData.conversations,
        rich_compaction: enabled,
      },
    });
  };

  const handleConversationSearchChange = (patch: Partial<ConversationSearchConfig>) => {
    applySettings({
      ...formData,
      conversationSearch: {
        ...(formData.conversationSearch ?? {}),
        ...patch,
      },
    });
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

  const ttsConfig = formData.tts ?? {};
  const ttsVolume = ttsConfig.volume ?? 1;
  const ttsRate = ttsConfig.rate ?? 1;
  const ttsMaxChars = ttsConfig.maxChars ?? 140;
  const ttsDaemonOnline = ttsHealth?.ok === true;
  const ttsDaemonStarting = ttsHealth?.phase === 'starting' || ttsHealth?.initializing === true;
  const ttsDaemonStatus = ttsHealth === undefined ? 'checking' : ttsDaemonOnline ? 'online' : ttsDaemonStarting ? 'starting' : ttsHealth.running ? 'unhealthy' : 'offline';
  const ttsDaemonModel = typeof ttsHealth?.model === 'string' ? ttsHealth.model : undefined;
  const ttsDaemonUptime = formatTtsUptime(ttsHealth?.uptimeSeconds);
  const ttsDaemonGpuMemory = formatTtsGpuMemory(ttsHealth?.gpuMemoryUsedMb);
  const ttsDaemonDetails = [
    ttsHealth ? `${ttsHealth.daemonHost}:${ttsHealth.daemonPort}` : undefined,
    ttsHealth?.pid ? `pid ${ttsHealth.pid}` : undefined,
    ttsHealth?.queueDepth !== undefined ? `queue ${ttsHealth.queueDepth}` : undefined,
    ttsDaemonGpuMemory,
    ttsDaemonUptime ? `uptime ${ttsDaemonUptime}` : undefined,
  ].filter(Boolean).join(' | ');
  const ttsTemplateEntries = Object.entries(ttsConfig.utteranceTemplates ?? {});
  const canAddTtsTemplate = ttsTemplateEntries.length < TTS_EVENT_KEYS.length;

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

      {/* Providers */}
      <section id="providers" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Providers
        </h2>
        <div className="mb-3 flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-border/70 bg-card/40">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Show all harness/model permutations</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Off by default. When off, model pickers use each provider&apos;s default harness and hide explicit Claude Code, Pi, and Codex combinations.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(formData.experimental?.showHarnessModelPermutations)}
            aria-label="Show all harness/model permutations"
            data-testid="show-harness-model-permutations-toggle"
            onClick={() => handleHarnessModelPermutationsToggle(!formData.experimental?.showHarnessModelPermutations)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              formData.experimental?.showHarnessModelPermutations ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              formData.experimental?.showHarnessModelPermutations ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
        <div className="space-y-1">
          {PROVIDERS.map((provider) => {
            const isDefault = provider.id === 'anthropic';
            const isEnabled = formData.models.providers[provider.id];
            const apiKey = formData.api_keys[provider.id as keyof typeof formData.api_keys] || '';
            const isExpanded = expandedProviders[provider.id] || false;
            const providerHarness = formData.models.provider_harnesses?.[provider.id] ?? '';
            const builtInHarness = formData.models.provider_default_harnesses?.[provider.id] ?? 'claude-code';

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
                  <ProviderLogo provider={provider.id} label={provider.name} className="w-4 h-4 text-muted-foreground shrink-0" />
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
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-foreground">Default harness</span>
                      <div className="flex items-center gap-2">
                        <HarnessLogo harness={(providerHarness || builtInHarness) as Harness} className="w-4 h-4 shrink-0" />
                        <select
                          value={providerHarness}
                          onChange={(event) => handleProviderHarnessChange(provider.id, event.target.value as HarnessOverride)}
                          className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
                        >
                          <option value="">Default ({harnessLabel(builtInHarness)})</option>
                          <option value="claude-code">Claude Code</option>
                          <option value="pi">Pi</option>
                          <option value="codex">Codex</option>
                        </select>
                      </div>
                    </label>
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
              <ProviderLogo provider="openrouter" label="OpenRouter" className="w-4 h-4 text-muted-foreground shrink-0" />
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
              <div className="px-3 pb-3 pt-0 ml-7 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Default harness</span>
                  <div className="flex items-center gap-2">
                    <HarnessLogo
                      harness={(formData.models.provider_harnesses?.openrouter || formData.models.provider_default_harnesses?.openrouter || 'claude-code') as Harness}
                      className="w-4 h-4 shrink-0"
                    />
                    <select
                      value={formData.models.provider_harnesses?.openrouter ?? ''}
                      onChange={(event) => handleProviderHarnessChange('openrouter', event.target.value as HarnessOverride)}
                      className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
                    >
                      <option value="">Default ({harnessLabel(formData.models.provider_default_harnesses?.openrouter ?? 'claude-code')})</option>
                      <option value="claude-code">Claude Code</option>
                      <option value="pi">Pi</option>
                      <option value="codex">Codex</option>
                    </select>
                  </div>
                </label>
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
                  : 'Overdeck-native compaction'}
              </p>
            </div>
            <select
              value={formData.conversations?.manual_compact_mode || 'claude-code'}
              onChange={(e) => handleManualCompactModeChange(e.target.value as 'claude-code' | 'overdeck-native')}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="claude-code">Pass through</option>
              <option value="overdeck-native">Native compaction</option>
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

          <div className="border-t border-border my-2" />

          <div className="px-4 py-3 rounded-lg bg-muted/15 border border-border/50">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">Conversation Search</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Index Claude JSONL transcripts for Ctrl+K semantic search. Disabled by default; enabling sends transcript chunks to the configured embedding provider.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={conversationSearchEnabled}
                aria-label="Toggle conversation search"
                onClick={() => handleConversationSearchChange({ enabled: !conversationSearchEnabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  conversationSearchEnabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  conversationSearchEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`} />
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="text-xs text-muted-foreground">
                Provider
                <select
                  value={conversationSearch.provider ?? 'openai'}
                  onChange={(e) => handleConversationSearchChange({ provider: e.target.value as 'openai' })}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                >
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Model
                <select
                  value={conversationSearchModel}
                  onChange={(e) => handleEmbeddingModelChange(e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                >
                  {(EMBEDDING_MODELS_BY_PROVIDER[conversationSearch.provider ?? 'openai'] ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{m.label} — {m.description}</option>
                  ))}
                </select>
                {(() => {
                  const desc = (EMBEDDING_MODELS_BY_PROVIDER[conversationSearch.provider ?? 'openai'] ?? [])
                    .find((m) => m.id === conversationSearchModel)?.description;
                  return desc ? <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/80">{desc}</span> : null;
                })()}
              </label>
              <div className="flex items-end text-xs">
                {formData?.api_keys?.openai ? (
                  <span className="text-success">✓ Using OpenAI key from API Keys section</span>
                ) : (
                  <span className="text-warning">No OpenAI key set — configure in API Keys above</span>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <div>
                <span>Last indexed: </span>
                <span className="text-foreground">
                  {conversationSearchStatus?.lastIndexedAt
                    ? conversationSearchStatus.lastIndexedAt.slice(0, 19).replace('T', ' ')
                    : 'Never'}
                </span>
                {conversationSearchStatus && (
                  <span className="ml-2">
                    ({conversationSearchStatus.chunkCount} chunks · {conversationSearchStatus.indexedFileCount} files)
                  </span>
                )}
                {conversationSearchStatus && !conversationSearchStatus.available && (
                  <span className="ml-2 text-destructive">{conversationSearchStatus.unavailableReason}</span>
                )}
                {conversationSearchEstimate && !conversationSearchEstimate.disabled && (
                  <span className="block mt-1">
                    Estimated reindex cost: <span className="text-foreground">${conversationSearchEstimate.estimatedUsd.toFixed(4)}</span>
                    {' '}({conversationSearchEstimate.tokenCount.toLocaleString()} tokens · {conversationSearchEstimate.chunksEstimated} chunks)
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleConversationSearchReindex()}
                disabled={!conversationSearchEnabled || estimatingConversationSearch || conversationSearchReindexMutation.isPending}
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/30 text-foreground transition-colors disabled:opacity-50"
              >
                {estimatingConversationSearch || conversationSearchReindexMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Estimate & reindex all conversations
              </button>
            </div>

            <p className="mt-2 text-[11px] leading-snug text-muted-foreground/80">
              <span className="text-foreground">Estimate &amp; reindex</span> rebuilds the entire semantic-search index from your conversation transcripts: it shows the one-time embedding-API cost, asks you to confirm, then re-embeds every conversation. Run it after switching the model, or to pick up transcripts created before search was enabled.
            </p>

            {conversationSearchReindexMutation.isPending && reindexProgress && (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1">
                  <span className="truncate">
                    {reindexProgress.currentFile ? `Indexing ${reindexProgress.currentFile}…` : 'Finishing up…'}
                  </span>
                  <span className="text-foreground tabular-nums shrink-0">
                    {reindexProgress.filesIndexed}/{reindexProgress.filesScanned || '—'} files · {reindexProgress.chunksIndexed.toLocaleString()} chunks
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${reindexProgress.filesScanned > 0 ? Math.min(100, Math.round((reindexProgress.filesIndexed / reindexProgress.filesScanned) * 100)) : 5}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border my-2" />

          {convConfigLoading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading embedding settings…
            </div>
          ) : convConfigError ? (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="text-muted-foreground">{convConfigError}</span>
              <button
                type="button"
                onClick={loadConvConfig}
                className="ml-1 inline-flex items-center gap-1 text-foreground hover:underline"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          ) : convConfig ? (
            <>
              <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">Semantic embeddings</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Store vector embeddings for semantic conversation search. Non-local providers receive session-derived summaries, tags, workspace paths, and tool names.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={convConfig.embeddings}
                  aria-label="Toggle semantic embeddings"
                  onClick={() => handleConvConfigChange({ embeddings: !convConfig.embeddings })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    convConfig.embeddings ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    convConfig.embeddings ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`} />
                </button>
              </div>

              {convConfig.embeddings && (
                <>
                  <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground">Embedding provider</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Which API generates embeddings</p>
                    </div>
                    <select
                      value={convConfig.embeddingProvider}
                      onChange={(e) => {
                        const provider = e.target.value;
                        const defaultModel = provider === 'openai'
                          ? 'text-embedding-3-small'
                          : provider === 'voyage'
                            ? 'voyage-code-3'
                            : 'nomic-embed-text';
                        handleConvConfigChange({ embeddingProvider: provider, embeddingModel: defaultModel });
                      }}
                      className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="voyage">Voyage AI</option>
                      <option value="ollama">Ollama (local)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground">Embedding model</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Model name for the selected provider</p>
                    </div>
                    <input
                      type="text"
                      value={convConfig.embeddingModel}
                      onChange={(e) => handleConvConfigChange({ embeddingModel: e.target.value })}
                      className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary w-[220px]"
                      placeholder="text-embedding-3-small"
                    />
                  </div>

                  {convConfig.embeddingProvider !== 'ollama' && (
                    <div className="px-4 py-3 rounded-lg bg-muted/20">
                      <p className="text-xs text-muted-foreground">
                        API key is read from{' '}
                        <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">
                          {convConfig.embeddingProvider === 'openai' ? 'OPENAI_API_KEY' : 'VOYAGE_API_KEY'}
                        </code>{' '}
                        or <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">~/.overdeck.env</code>.
                        Session-derived summaries, tags, workspace paths, and tool names are sent to this provider.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground">Auto-embed after deep enrichment</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Generate embeddings when a session is enriched at tier 2 or 3
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={convConfig.embeddingAutoOnDeep}
                      aria-label="Toggle auto-embed after deep enrichment"
                      onClick={() => handleConvConfigChange({ embeddingAutoOnDeep: !convConfig.embeddingAutoOnDeep })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                        convConfig.embeddingAutoOnDeep ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        convConfig.embeddingAutoOnDeep ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleTestEmbeddingConnection}
                        disabled={testingEmbedding}
                        className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/30 text-foreground transition-colors disabled:opacity-50"
                      >
                        {testingEmbedding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        Test connection
                      </button>
                      {embeddingTestResult && (
                        <span className={`text-xs flex items-center gap-1 ${embeddingTestResult.ok ? 'text-success' : 'text-destructive'}`}>
                          {embeddingTestResult.ok
                            ? <><CheckCircle className="w-3.5 h-3.5" /> Connected ({embeddingTestResult.latencyMs}ms)</>
                            : <><AlertTriangle className="w-3.5 h-3.5" /> {embeddingTestResult.error}</>}
                        </span>
                      )}
                    </div>
                    {convConfigDirty && (
                      <button
                        type="button"
                        onClick={() => void handleSaveConvConfig()}
                        disabled={convConfigSaving}
                        className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {convConfigSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Save embeddings
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      </section>

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

      <SettingsSection
        id="tts"
        title="TTS"
        description="Built-in voice playback"
        actions={
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${
            ttsHealth === undefined
              ? 'bg-muted/50 text-muted-foreground'
              : ttsDaemonOnline
                ? 'bg-success/10 text-success'
                : ttsDaemonStarting
                  ? 'bg-warning/10 text-warning'
                  : 'bg-destructive/10 text-destructive'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${ttsDaemonOnline ? 'bg-success' : 'bg-current'}`} />
            Daemon status: {ttsDaemonStatus}
          </span>
        }
      >
        <SettingsRow
          label="Enable TTS"
          description="Speak activity events through the local Qwen3-TTS daemon"
        >
          <button
            type="button"
            role="switch"
            aria-checked={!!ttsConfig.enabled}
            aria-label="Toggle TTS"
            onClick={() => handleTtsConfigChange({ enabled: !ttsConfig.enabled })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              ttsConfig.enabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              ttsConfig.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </SettingsRow>

        <SettingsRow
          label="Daemon"
          description={ttsDaemonDetails || ttsHealth?.error || 'Live Qwen TTS daemon status'}
        >
          <div className="flex flex-col items-end gap-1.5 text-right">
            <span className={`text-sm font-medium ${ttsDaemonOnline ? 'text-success' : ttsDaemonStarting ? 'text-warning' : 'text-muted-foreground'}`}>
              {ttsDaemonOnline ? 'running' : ttsDaemonStatus}
            </span>
            {ttsDaemonModel && (
              <span className="max-w-xs truncate text-xs text-muted-foreground">{ttsDaemonModel}</span>
            )}
            {!ttsDaemonOnline && !ttsDaemonStarting && (
              <button
                type="button"
                onClick={() => ttsStartMutation.mutate()}
                disabled={ttsStartMutation.isPending}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {ttsStartMutation.isPending ? 'Starting…' : 'Start daemon'}
              </button>
            )}
          </div>
        </SettingsRow>

        <SettingsRow
          label="Volume"
          description={`${Math.round(ttsVolume * 100)}% output volume`}
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={ttsVolume}
            onChange={(e) => handleTtsConfigChange({ volume: Number(e.target.value) }, { debounce: true })}
            className="w-40 accent-primary disabled:opacity-50"
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(ttsVolume * 100)}%
          </span>
        </SettingsRow>

        <SettingsRow
          label="Rate"
          description="Speech speed multiplier"
        >
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={ttsRate}
            onChange={(e) => handleTtsConfigChange({ rate: Number(e.target.value) }, { debounce: true })}
            className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
        </SettingsRow>

        <SettingsRow
          label="Max chars"
          description="Maximum text length per spoken utterance"
        >
          <input
            type="number"
            min={1}
            step={1}
            value={ttsMaxChars}
            onChange={(e) => handleTtsConfigChange({ maxChars: Number(e.target.value) }, { debounce: true })}
            className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
        </SettingsRow>

        <SettingsRow
          label="Drop info when queue full"
          description="Skip low-priority speech when the daemon queue is saturated"
        >
          <button
            type="button"
            role="switch"
            aria-checked={ttsConfig.dropInfoWhenFull ?? true}
            aria-label="Toggle dropping low-priority TTS when queue is full"
            onClick={() => handleTtsConfigChange({ dropInfoWhenFull: !(ttsConfig.dropInfoWhenFull ?? true) })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              (ttsConfig.dropInfoWhenFull ?? true) ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              (ttsConfig.dropInfoWhenFull ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </SettingsRow>

        <TtsSystemVoicePicker
          voices={ttsVoices}
          isLoading={ttsVoicesQuery.isLoading}
          systemVoiceId={ttsConfig.voice}
          statusVoiceId={ttsConfig.statusVoice}
          onSetSystemVoice={(voiceId) => handleTtsConfigChange({ voice: voiceId })}
          onSetStatusVoice={(voiceId) => handleTtsConfigChange({ statusVoice: voiceId })}
        />

        <div className="mt-6" data-testid="tts-voice-library-tabs">
          <div className="rounded-t-xl border border-border/70 bg-card/40 p-2">
            <div className="inline-flex rounded-lg bg-background/60 p-1">
              {([
                ['presets', 'CustomVoice Presets'],
                ['design', 'VoiceDesign'],
              ] as const).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setActiveTtsVoiceTab(tabId)}
                  aria-pressed={activeTtsVoiceTab === tabId}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTtsVoiceTab === tabId
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-popover'
                  }`}
                  data-testid={`tts-voice-library-tab-${tabId}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {activeTtsVoiceTab === 'presets' ? <VoicePresetsTab /> : <VoiceDesignTab />}
        </div>

        <SavedVoicesTab />

        <div className="mt-6 rounded-xl border border-border/70 bg-card/40 p-4" data-testid="tts-advanced-settings">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-foreground">Advanced</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Route event types to specific voices, silence noisy activity sources, and override spoken text.
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Voice Map</h4>
                  <p className="text-xs text-muted-foreground mt-1">Use default falls back to the configured TTS voice.</p>
                </div>
                <span className="text-[10px] text-muted-foreground">{ttsVoices.length} saved voices</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>Event key</span>
                  <span>Voice</span>
                </div>
                {TTS_EVENT_KEYS.map((eventKey) => (
                  <div key={eventKey} className="grid grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] items-center gap-3 border-t border-border px-3 py-2">
                    <code className="truncate text-xs text-foreground">{eventKey}</code>
                    <select
                      value={ttsConfig.voiceMap?.[eventKey] ?? ''}
                      onChange={(e) => handleTtsVoiceMapChange(eventKey, e.target.value)}
                      aria-label={`Voice for ${eventKey}`}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
                    >
                      <option value="">Use default</option>
                      {ttsVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.name} ({voice.kind})</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Muted Sources</h4>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {ACTIVITY_SOURCE_OPTIONS.map((source) => (
                  <label key={source} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={ttsConfig.mutedSources?.includes(source) ?? false}
                      onChange={(e) => handleTtsMutedSourceChange(source, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                    />
                    <span>{source}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Utterance Templates</h4>
                  <p className="text-xs text-muted-foreground mt-1">Templates may include {'{issueId}'}.</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddTtsTemplate}
                  disabled={!canAddTtsTemplate}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-popover disabled:opacity-50"
                >
                  Add template
                </button>
              </div>
              <div className="space-y-2">
                {ttsTemplateEntries.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    No utterance templates configured.
                  </p>
                )}
                {ttsTemplateEntries.map(([eventKey, template]) => (
                  <div key={eventKey} className="grid gap-2 rounded-lg border border-border bg-background/60 p-2 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)_auto]">
                    <select
                      value={eventKey}
                      onChange={(e) => handleTtsTemplateKeyChange(eventKey, e.target.value)}
                      aria-label="Template event key"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
                    >
                      {TTS_EVENT_KEYS.map((key) => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={template}
                      onChange={(e) => handleTtsTemplateChange(eventKey, e.target.value)}
                      placeholder="e.g. {issueId} passed review"
                      aria-label={`Template text for ${eventKey}`}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveTtsTemplate(eventKey)}
                      className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      aria-label={`Remove template for ${eventKey}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>

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
                <ProviderLogo
                  provider={modelsModalProvider}
                  label={PROVIDERS.find(p => p.id === modelsModalProvider)?.name}
                  className="w-5 h-5 shrink-0"
                />
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

      <ReindexConfirmDialog
        open={reindexConfirm !== null}
        title={reindexConfirm?.kind === 'model' ? 'Switch embedding model?' : 'Reindex all conversations?'}
        intro={reindexConfirm?.kind === 'model' ? (
          <>
            Switching to <span className="text-foreground font-medium">{reindexConfirm?.newModel}</span> invalidates
            every cached embedding — vectors can&apos;t be reused across models — and runs a full reindex with the new
            model. This is a one-time embedding-API cost:
          </>
        ) : (
          <>This re-embeds every conversation transcript from scratch and replaces the existing index, calling the OpenAI embeddings API once for your whole history:</>
        )}
        estimate={reindexConfirm?.estimate ?? null}
        estimating={estimatingConversationSearch && !reindexConfirm?.estimate}
        confirmLabel={reindexConfirm?.kind === 'model' ? 'Switch & reindex' : 'Reindex now'}
        busy={reindexConfirmBusy}
        onConfirm={() => void confirmReindex()}
        onCancel={cancelReindexConfirm}
      />

    </SettingsLayout>
  );
}
