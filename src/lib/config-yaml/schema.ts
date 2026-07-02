import type { ModelId } from '../settings.js';
import type { ModelProvider } from '../model-fallback.js';
import type { EffortLevel } from '../model-capabilities.js';
import type { SubscriptionPlan, AuthMode } from '../subscription-types.js';
import type { Role } from '../agents.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { BackgroundAiFeature } from '../background-ai/registry.js';
import type { TieredExecutionConfig, TieredExecutionInput } from '../agents/tier-table.js';

export type { SubscriptionPlan, AuthMode };

/**
 * Provider configuration (enable/disable + API keys)
 */
export interface ProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** API key (optional, can use env var) */
  api_key?: string;
  /** Default harness for this provider's models. Role/request harnesses override this. */
  harness?: RuntimeName;
  /** Authentication mode: api-key (default) or subscription (OAuth) */
  auth?: AuthMode;
  /** Subscription plan tier (only used when auth is 'subscription') */
  plan?: SubscriptionPlan;
}

/**
 * Shadow mode configuration
 */
export interface ShadowConfig {
  /** Global shadow mode default */
  enabled?: boolean;

  /** Per-tracker overrides */
  trackers?: {
    linear?: boolean;
    github?: boolean;
    gitlab?: boolean;
    rally?: boolean;
  };
}

export type TmuxConfigMode = 'managed' | 'inherit-user';

export interface TmuxConfig {
  /** Whether Overdeck uses its own tmux server/config or inherits the user's tmux config */
  config_mode?: TmuxConfigMode;
}

export interface MemoryConfig {
  extraction?: {
    provider?: 'anthropic' | 'cliproxy';
    model?: string;
    per_day_cost_cap_usd?: number;
    fallback_chain?: Array<{ provider: 'anthropic' | 'cliproxy'; model: string }>;
  };
  features?: {
    observations?: boolean;
    prompt_time_injection?: boolean;
  };
  rollup_pending_threshold?: number;
  sidebar_refresh_interval_ms?: number;
  worker_concurrency?: number;
}

/**
 * Background AI configuration (PAN-1583).
 *
 * `cheap_mode` is the high-level low-cost master switch: when true, every
 * optional background AI feature is disabled in one click, regardless of its
 * individual `features.<key>` toggle. Individual toggles let the user enable or
 * disable each background AI feature independently when cheap mode is off.
 *
 * `cheap_mode` defaults ON (PAN-1589): background AI is off until the user
 * opts in. While it is on, the dashboard status bar shows a "Low-cost mode"
 * pill linking to this config section.
 */
export interface BackgroundAiConfig {
  cheap_mode?: boolean;
  features?: Partial<Record<BackgroundAiFeature, boolean>>;
}

export const COMPLIANCE_MODES = ['off', 'advisory', 'enforcing'] as const;
export type ComplianceMode = typeof COMPLIANCE_MODES[number];

export interface ComplianceConfig {
  mode?: ComplianceMode;
}

export interface NormalizedComplianceConfig {
  mode: ComplianceMode;
}

export type ResiliencyTier = 'ephemeral' | 'durable';

export interface RemoteConfig {
  /** Durability/resiliency tier for remote work agents. */
  resiliency_tier?: ResiliencyTier;
  /** Maximum concurrent remote work agents (0 = unlimited). */
  max_concurrent_agents?: number;
}

export interface NormalizedRemoteConfig {
  resiliencyTier: ResiliencyTier;
  maxConcurrentAgents: number;
}

export interface FeatureRegistryClassificationConfig {
  enabled?: boolean;
  provider?: 'anthropic' | 'cliproxy';
  model?: string;
  per_day_cost_cap_usd?: number;
}

export interface FeatureRegistryConfig {
  classification?: FeatureRegistryClassificationConfig;
}

export interface NormalizedFeatureRegistryConfig {
  classification: {
    enabled: boolean;
    provider: 'anthropic' | 'cliproxy';
    model: string;
    perDayCostCapUsd: number;
  };
}

export type ManualCompactMode = 'claude-code' | 'overdeck-native';

export interface ConversationsConfig {
  /** Model used for Overdeck-native conversation compaction */
  compaction_model?: ModelId;
  /** How typed /compact in the conversation composer is handled */
  manual_compact_mode?: ManualCompactMode;
  /** Whether to use the richer 9-section summary format (more tokens, less efficient incremental updates) */
  rich_compaction?: boolean;
  /** Model used for AI-generated conversation titles (default: claude-haiku-4-5) */
  title_model?: ModelId;
  watch_dirs?: string[];
  scan_max_parallel?: number | null;
  embeddings?: boolean;
  embedding_provider?: 'openai' | 'voyage' | 'ollama';
  embedding_model?: string;
  embedding_auto_on_deep?: boolean;
  enrichment?: {
    quick_model?: string | null;
    deep_model?: string | null;
    max_parallel?: number;
    cost_confirm_threshold?: number;
  };
}

export type ConversationSearchProvider = 'openai';

export interface ConversationSearchConfig {
  /** Whether conversation semantic search is enabled. Default: false. */
  enabled?: boolean;
  /** Embedding provider. Default: 'openai'. */
  provider?: ConversationSearchProvider;
  /** Embedding model. Default: 'text-embedding-3-small'. */
  model?: string;
  /** Name of an env var or config key holding the API key. Default: provider's standard env var. */
  apiKeyRef?: string;
  /** Path to the sidecar embeddings DB. Default: ~/.overdeck/conversations/embeddings.db. */
  dbPath?: string;
}

export interface NormalizedConversationSearchConfig {
  enabled: boolean;
  provider: ConversationSearchProvider;
  model: string;
  apiKeyRef: string | undefined;
  dbPath: string;
}

export type DocsEmbeddingProvider = 'local' | 'openai';
export type DocsClassifierProvider = 'anthropic' | 'cliproxy';
export type DocsPrdStatus = 'active' | 'planned' | 'completed';

export interface DocsConfig {
  enabled?: boolean;
  prompt_injection?: boolean;
  cli?: boolean;
  trigger?: {
    regexes?: string[];
    case_sensitive?: boolean;
  };
  corpus?: {
    docs?: boolean;
    skills?: boolean;
    rules?: boolean;
    claude_md?: boolean;
    prds?: boolean;
    prd_statuses?: DocsPrdStatus[];
    max_chunk_tokens?: number;
  };
  budget?: {
    injection_rate?: number;
    turn_window?: number;
    max_tokens_per_injection?: number;
    max_chunks_per_injection?: number;
    bypass_classifier_threshold?: number;
  };
  embedding?: {
    provider?: DocsEmbeddingProvider;
    model?: string;
    dimensions?: number;
  };
  classifier?: {
    enabled?: boolean;
    provider?: DocsClassifierProvider;
    model?: string;
    threshold?: number;
    timeout_ms?: number;
  };
}

export interface NormalizedDocsConfig {
  enabled: boolean;
  promptInjectionEnabled: boolean;
  cliEnabled: boolean;
  trigger: {
    regexes: string[];
    caseSensitive: boolean;
  };
  corpus: {
    docs: boolean;
    skills: boolean;
    rules: boolean;
    claudeMd: boolean;
    prds: boolean;
    prdStatuses: DocsPrdStatus[];
    maxChunkTokens: number;
  };
  budget: {
    injectionRate: number;
    turnWindow: number;
    maxTokensPerInjection: number;
    maxChunksPerInjection: number;
    bypassClassifierThreshold: number;
  };
  embedding: {
    provider: DocsEmbeddingProvider;
    model: string;
    dimensions: number;
  };
  classifier: {
    enabled: boolean;
    provider: DocsClassifierProvider;
    model: string;
    threshold: number;
    timeoutMs: number;
  };
}

/**
 * TTS summarizer configuration
 */
export interface TtsSummarizerConfig {
  /** Whether the TTS summarizer is active */
  enabled?: boolean;
  /** Model ID to use for summarization (default: gpt-5.4-mini) */
  model?: ModelId;
  /** Seconds to batch activity before summarizing (default: 15) */
  batch_window_seconds?: number;
}

export interface TtsDaemonConfig {
  enabled?: boolean;
  /** Announce planning/work agent lifecycle (start + finish) via TTS. Default true. */
  lifecycle?: boolean;
  voice?: string;
  statusVoice?: string;
  volume?: number;
  rate?: number;
  maxChars?: number;
  dropInfoWhenFull?: boolean;
  daemonPort?: number;
  daemonHost?: string;
  daemon?: {
    autoStart?: boolean;
  };
  voiceMap?: Record<string, string>;
  mutedSources?: string[];
  utteranceTemplates?: Record<string, string>;
  mutedIssues?: string[];
}

export interface NormalizedTtsDaemonConfig {
  enabled: boolean;
  /**
   * Announce planning/work agent lifecycle events (start + finish) via TTS.
   * Default true. Set false to mute the substrate-breathing announcements
   * without disabling TTS overall.
   */
  lifecycle: boolean;
  voice: string;
  statusVoice?: string;
  volume: number;
  rate: number;
  maxChars: number;
  dropInfoWhenFull: boolean;
  daemonPort: number;
  daemonHost: string;
  daemonAutoStart: boolean;
  voiceMap: Record<string, string>;
  mutedSources: string[];
  utteranceTemplates: Record<string, string>;
  mutedIssues: string[];
}

export type WorkhorseSlot = 'expensive' | 'mid' | 'cheap';
export type ModelRef = string;
export const PARENT_MODEL_REF = 'parent';

export interface WeightedModelRef {
  model: ModelRef;
  weight: number;
}

/** Top-level role model: either a scalar model string or a weighted distribution list. */
export type RoleModelRef = ModelRef | WeightedModelRef[];


/**
 * Canonical workhorse slot list. Anything outside this set is rejected by
 * config-load validation (PAN-1048 review feedback 003 / REQ-18).
 */
export const WORKHORSE_SLOTS: readonly WorkhorseSlot[] = ['expensive', 'mid', 'cheap'] as const;

export type WorkhorsesConfig = Partial<Record<WorkhorseSlot, ModelRef>>;

export interface RoleSubConfig {
  model: ModelRef;
}

export type RoleEffort = EffortLevel;
export const ROLE_EFFORTS: readonly RoleEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReviewMode = 'quick' | 'full';
export type FlywheelScope = 'pan-only' | 'all-tracked-projects';

export interface RoleConfig {
  model: RoleModelRef;
  harness?: 'claude-code' | 'ohmypi' | 'codex';
  effort?: RoleEffort;
  mode?: ReviewMode;
  /**
   * Target minimum concurrent agents the role should keep launched. The
   * orchestrator MUST be aggressive about reaching this number — if the active
   * count is below `minAgents`, launching new agents is the tick's primary
   * action, not optional. For the flywheel role only.
   */
  minAgents?: number;
  /**
   * Hard ceiling on concurrent agents. The orchestrator never spawns past
   * this number, even if more work is queued.
   */
  maxAgents?: number;
  scope?: FlywheelScope;
  sub?: Record<string, RoleSubConfig>;
}

export type RolesConfig = Partial<Record<Role, RoleConfig>>;

export interface ResourcesConfig {
  /** Available RAM threshold that triggers a warning state/guardrail (GiB) */
  memory_warn_gb?: number;
  /** Available RAM threshold that blocks spawns / marks critical state (GiB) */
  memory_block_gb?: number;
  /** Work-agent count threshold that triggers a warning */
  agent_warn_count?: number;
  /** Work-agent count threshold that blocks new spawns */
  agent_block_count?: number;
}

/**
 * Complete configuration structure (YAML schema)
 */
export interface YamlConfig {
  /** Model configuration */
  models?: {
    /** Provider enable/disable and API keys */
    providers?: {
      anthropic?: ProviderConfig | boolean;
      openai?: ProviderConfig | boolean;
      google?: ProviderConfig | boolean;
      minimax?: ProviderConfig | boolean;
      zai?: ProviderConfig | boolean;
      kimi?: ProviderConfig | boolean;
      mimo?: ProviderConfig | boolean;
      openrouter?: ProviderConfig | boolean;
      nous?: ProviderConfig | boolean;
      dashscope?: ProviderConfig | boolean;
    };

    /** Per-work-type overrides (explicit model for specific tasks) */
    overrides?: Partial<Record<string, ModelId>>;

    /** Gemini thinking level (1-4) */
    gemini_thinking_level?: 1 | 2 | 3 | 4;

    /** Persisted default conversation model (overrides dynamic provider-based selection) */
    default_conversation_model?: ModelId;
  };

  /** OpenRouter-specific configuration */
  openrouter?: {
    /** Favorite model IDs to show in ModelPicker */
    favorites?: string[];
  };

  /** Legacy API keys (for backward compatibility) */
  api_keys?: {
    openai?: string;
    voyage?: string;
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
    openrouter?: string;
    nous?: string;
    dashscope?: string;
  };

  /** Tracker API keys (override environment variables) */
  tracker_keys?: {
    linear?: string;
    github?: string;
    gitlab?: string;
    rally?: string;
  };

  /** Shadow mode configuration */
  shadow?: ShadowConfig;

  /** tmux runtime configuration */
  tmux?: TmuxConfig;

  /** Conversation-specific configuration */
  conversations?: ConversationsConfig;

  /** Overdeck docs RAG configuration */
  docs?: DocsConfig;

  /** Semantic conversation search configuration (Phase 2 palette) */
  conversationSearch?: ConversationSearchConfig;

  /** Durable memory extraction and retrieval configuration */
  memory?: MemoryConfig;

  /** Background AI feature toggles + low-cost master switch (PAN-1583) */
  background_ai?: BackgroundAiConfig;

  /** Memory-first compliance audit configuration */
  compliance?: ComplianceConfig;

  /** Knowledge registry population configuration */
  registry?: FeatureRegistryConfig;

  /** Multi-tool sync configuration */
  tools?: {
    /**
     * Additional AI tools to sync skills to.
     * Supported: 'cursor' | 'codex' | 'windsurf' | 'cline' | 'copilot' | 'aider'
     * Per-project .pan.yaml values merge additively with global config.
     */
    also_sync?: string[];
  };

  /** Agent behavior configuration */
  agents?: {
    /** Caveman compressed output mode configuration */
    caveman?: CavemanConfig;
    /** RTK Bash output compression configuration */
    rtk?: RtkConfig;
    /** TLDR token-efficient code-analysis configuration */
    tldr?: TldrConfig;
  };

  /** TTS configuration */
  tts?: TtsDaemonConfig & {
    summarizer?: TtsSummarizerConfig;
  };

  /** Workhorse model slots for role model indirection. */
  workhorses?: WorkhorsesConfig;

  /** Role-specific model and harness configuration. */
  roles?: RolesConfig;

  /** Resource thresholds for dashboard health + spawn guardrails */
  resources?: ResourcesConfig;

  /** Difficulty-routed standing tier agent configuration. Off by default. */
  tiered_execution?: TieredExecutionInput;

  /** Experimental, opt-in features. Each flag is research-preview and may be removed. */
  experimental?: ExperimentalConfig;

  /**
   * Claude Code spawn behavior.
   *
   * `permissionMode: 'auto'` (default) emits `--permission-mode auto`; the classifier
   * blocks destructive ops while still running fully autonomously. `'bypass'` emits
   * `--permission-mode bypassPermissions` (the standalone `--dangerously-skip-permissions`
   * flag was removed). Override per-invocation with `--yolo` / `--no-yolo` / `PAN_YOLO`.
   */
  claude?: {
    permissionMode?: 'auto' | 'bypass';
  };

  /**
   * Codex spawn behavior for conversation sessions (TUI mode).
   *
   * 'read-only'   — approval_policy=on-request + sandbox_mode=read-only:
   *                 Codex can browse files but asks before any write or command.
   * 'workspace'   — approval_policy=on-request + sandbox_mode=workspace-write (default):
   *                 Codex works freely inside the cwd, asks before going outside or using the network.
   * 'auto-review' — approval_policy=on-request + approvals_reviewer=auto_review + sandbox_mode=workspace-write:
   *                 A sub-agent reviews and auto-answers approval requests instead of prompting the user.
   * 'full-access' — approval_policy=never + sandbox_mode=danger-full-access:
   *                 No approval prompts; full filesystem and network access.
   */
  codex?: {
    permissionMode?: 'read-only' | 'workspace' | 'auto-review' | 'full-access';
  };

  /** Remote work-agent provisioning settings (dashboard-editable subset). */
  remote?: RemoteConfig;
}

/**
 * Experimental, opt-in feature flags. All default to false.
 *
 * Flags here gate research-preview features that may break or be removed in future
 * releases. Code paths gated by these flags must always degrade silently to the
 * existing default behaviour when the flag is off.
 */
export interface ExperimentalConfig {
  /** Show experimental dashboard surfaces in navigation and direct routes. */
  experimentalFeatures?: boolean;
  /**
   * Use Claude Code Channels (research-preview MCP capability) for prompt delivery
   * to eligible work agents. When enabled, eligible agents receive prompts via a
   * per-agent MCP bridge over a Unix socket; ineligible agents and all non-work
   * delivery sites continue to use tmux send-keys. Default: false.
   */
  claudeCodeChannels?: boolean;
  claudeCodeChannelsMcp?: boolean;
  /** Render dashboard chat markdown with Streamdown instead of ReactMarkdown. */
  streamdownRenderer?: boolean;
  /**
   * Show the advanced harness selector and all explicit harness/model choices in
   * dashboard model pickers. Default false: pickers use each provider's default
   * harness and hide the permutation matrix.
   */
  showHarnessModelPermutations?: boolean;
}

/**
 * Valid caveman intensity modes for agents.
 * Maps to CAVEMAN_DEFAULT_MODE env var values recognised by caveman-config.js.
 */
export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra' | 'review' | 'disabled';

/**
 * Caveman hook configuration.
 *
 * Controls whether autonomous agents use the caveman compressed-output hooks to
 * reduce output tokens ~65-75% without losing technical accuracy.
 *
 * Example (~/.overdeck/config.yaml):
 *   agents:
 *     caveman:
 *       enabled: true
 *       ab_test: false
 *       work: full
 *       review: review
 *       test: full
 *       merge: full
 */
export interface CavemanConfig {
  /** Master switch — set to false to disable caveman globally with zero workspace changes */
  enabled?: boolean;
  /**
   * A/B testing mode — randomly assigns new workspaces to enabled/disabled at creation.
   * The variant is stored in workspace metadata and propagated to cost events.
   */
  ab_test?: boolean;
  /** Intensity for work agents (default: 'full') */
  work?: CavemanMode;
  /** Intensity for review agents (default: 'review') */
  review?: CavemanMode;
  /** Intensity for test agents (default: 'full') */
  test?: CavemanMode;
  /** Intensity for merge agents (default: 'full') */
  merge?: CavemanMode;
}

export interface RtkConfig {
  enabled?: boolean;
}

/**
 * TLDR (token-efficient code analysis) configuration.
 *
 * When enabled, work/planning agents whose workspace has a TLDR `.venv` get the
 * TLDR MCP tools wired in and their prompt advertises TLDR as available; the
 * per-workspace TLDR daemon is started at spawn. When disabled, agents fall back
 * to direct file reads regardless of whether a `.venv` is present. Default ON to
 * preserve historical behaviour (TLDR was implicitly on whenever a `.venv`
 * existed). Changing this only affects sessions launched/resumed AFTER the
 * change — running agents must be resumed to pick it up.
 */
export interface TldrConfig {
  enabled?: boolean;
}

/**
 * Normalized shadow configuration
 */
export interface NormalizedShadowConfig {
  /** Global shadow mode enabled */
  enabled: boolean;

  /** Per-tracker overrides */
  trackers: {
    linear: boolean;
    github: boolean;
    gitlab: boolean;
    rally: boolean;
  };
}

/**
 * Normalized configuration (after loading and merging)
 */
export interface NormalizedConfig {
  /** tmux runtime configuration */
  tmux: {
    configMode: TmuxConfigMode;
  };

  /** Enabled providers */
  enabledProviders: Set<ModelProvider>;

  /** API keys by provider */
  apiKeys: {
    openai?: string;
    voyage?: string;
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
    openrouter?: string;
    nous?: string;
    dashscope?: string;
  };

  /** Provider auth mode (subscription vs api-key) by provider */
  providerAuth: Partial<Record<ModelProvider, AuthMode>>;

  /** Provider subscription plan by provider */
  providerPlan: Partial<Record<ModelProvider, SubscriptionPlan>>;

  /** Default harness by provider. Role/request harnesses override these defaults. */
  providerHarnesses: Partial<Record<ModelProvider, RuntimeName>>;

  /** OpenRouter favorite model IDs (shown in ModelPicker) */
  openrouterFavorites: string[];

  /** Optional workhorse model slots used by role model references. */
  workhorses?: WorkhorsesConfig;

  /** Optional role model/harness configuration. */
  roles?: RolesConfig;

  /** Per-work-type overrides */
  overrides: Partial<Record<string, ModelId>>;

  /** Gemini thinking level */
  geminiThinkingLevel: 1 | 2 | 3 | 4;

  /** Persisted default conversation model (overrides dynamic provider-based selection) */
  defaultConversationModel?: ModelId;

  /** Tracker API keys */
  trackerKeys: {
    linear?: string;
    github?: string;
    gitlab?: string;
    rally?: string;
  };

  /** Conversation-specific behavior */
  conversations: {
    compactionModel: ModelId;
    manualCompactMode: ManualCompactMode;
    richCompaction: boolean;
    titleModel: ModelId;
    watchDirs: string[];
    scanMaxParallel: number | null;
    embeddings: boolean;
    embeddingProvider: 'openai' | 'voyage' | 'ollama';
    embeddingModel: string;
    embeddingAutoOnDeep: boolean;
    enrichment: {
      quickModel: string | null;
      deepModel: string | null;
      maxParallel: number;
      costConfirmThreshold: number;
    };
  };

  /** Overdeck docs RAG behavior */
  docs: NormalizedDocsConfig;

  /** Semantic conversation search configuration (Phase 2 palette) */
  conversationSearch: NormalizedConversationSearchConfig;

  /** Durable memory extraction and retrieval configuration */
  memory: {
    extraction: {
      provider?: 'anthropic' | 'cliproxy';
      model?: string;
      perDayCostCapUsd?: number;
      fallbackChain: Array<{ provider: 'anthropic' | 'cliproxy'; model: string }>;
    };
    observationsEnabled: boolean;
    promptTimeInjectionEnabled: boolean;
    rollupPendingThreshold: number;
    sidebarRefreshIntervalMs: number;
    workerConcurrency: number;
  };

  /** Background AI feature toggles + low-cost master switch (PAN-1583) */
  backgroundAi: {
    /** Low-cost master switch: when true, all optional background AI is off. */
    cheapMode: boolean;
    /** Per-feature enablement, consulted by `isBackgroundFeatureEnabled`. */
    features: Record<BackgroundAiFeature, boolean>;
  };

  /** Memory-first compliance audit configuration */
  compliance: NormalizedComplianceConfig;

  /** Knowledge registry population configuration */
  registry: NormalizedFeatureRegistryConfig;

  /** Shadow mode configuration */
  shadow: NormalizedShadowConfig;

  /** Caveman compressed output configuration (normalised, never undefined) */
  caveman: NormalizedCavemanConfig;

  /** RTK Bash output compression configuration (normalised, never undefined) */
  rtk: NormalizedRtkConfig;

  /** TLDR token-efficient code-analysis configuration (normalised, never undefined) */
  tldr: NormalizedTldrConfig;

  /** TTS daemon configuration (normalised, never undefined) */
  tts: NormalizedTtsDaemonConfig;

  /** TTS summarizer configuration (normalised, never undefined) */
  ttsSummarizer: {
    enabled: boolean;
    model: ModelId;
    batchWindowSeconds: number;
  };

  /** Resource thresholds (normalised, never undefined) */
  resources: {
    memoryWarnGb: number;
    memoryBlockGb: number;
    agentWarnCount: number;
    agentBlockCount: number;
  };

  /** Difficulty-routed standing tier agent configuration. Off by default. */
  tieredExecution: TieredExecutionConfig;

  /** Experimental flag values, normalised (always defined, never undefined). */
  experimental: NormalizedExperimentalConfig;

  /** Permission-mode for spawned Claude Code agents. Always defined; defaults to 'auto'. */
  claude: {
    permissionMode: 'auto' | 'bypass';
  };

  /** Permission-mode for Codex TUI conversation sessions. Always defined; defaults to 'workspace'. */
  codex: {
    permissionMode: 'read-only' | 'workspace' | 'auto-review' | 'full-access';
  };

  /** Remote work-agent provisioning settings surfaced by the dashboard. */
  remote?: NormalizedRemoteConfig;
}

/**
 * Normalized experimental flags — every flag has a concrete boolean value.
 */
export interface NormalizedExperimentalConfig {
  /** Whether experimental dashboard surfaces are visible. */
  experimentalFeatures: boolean;
  /** Whether Claude Code Channels prompt delivery is enabled for eligible work agents. */
  claudeCodeChannels: boolean;
  /** Whether legacy Claude Code Channels MCP wiring is enabled for new spawns. */
  claudeCodeChannelsMcp: boolean;
  /** Whether dashboard chat markdown renders through Streamdown. */
  streamdownRenderer: boolean;
  /** Whether model pickers expose explicit harness/model permutations. */
  showHarnessModelPermutations: boolean;
}

/**
 * Normalized caveman configuration — all fields resolved to their effective values.
 */
export interface NormalizedCavemanConfig {
  /** Whether caveman hooks are active for new workspaces */
  enabled: boolean;
  /** A/B testing mode active */
  abTest: boolean;
  /** Per-agent-type intensity (already resolved, never undefined) */
  modes: {
    work: CavemanMode;
    review: CavemanMode;
    test: CavemanMode;
    merge: CavemanMode;
  };
}

export interface NormalizedRtkConfig {
  enabled: boolean;
}

/** Normalized TLDR configuration (never undefined). */
export interface NormalizedTldrConfig {
  enabled: boolean;
}

/**
 * Model ID migration result
 *
 * Returned when deprecated model IDs are automatically migrated
 * during config load.
 */
export type RuntimeConversationsConfig = NormalizedConfig['conversations'] & {
  apiKeys?: NormalizedConfig['apiKeys'];
  enabledProviders?: NormalizedConfig['enabledProviders'];
};

export interface MigrationResult {
  /** List of migrated model IDs */
  migrated: Array<{
    /** Work type that was migrated */
    workType: string;
    /** Old (deprecated) model ID */
    from: string;
    /** New (current) model ID */
    to: string;
  }>;
  /** Whether config.yaml was backed up before migration */
  backedUp: boolean;
}

/**
 * Config load result (config + optional migration info)
 */
export interface ConfigLoadResult {
  /** Normalized configuration */
  config: NormalizedConfig;
  /** Migration result (if any deprecated models were migrated) */
  migration?: MigrationResult;
}
