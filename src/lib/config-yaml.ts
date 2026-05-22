/**
 * YAML Configuration Loader
 *
 * Loads and merges configuration from:
 * 1. Global config: ~/.panopticon/config.yaml
 * 2. Per-project config: .pan.yaml (project root, falls back to .panopticon.yaml with deprecation warning)
 *
 * Uses smart (capability-based) model selection - no legacy presets.
 */

import { readFileSync, existsSync, writeFileSync, copyFileSync, statSync } from 'fs';
import { readFile as readFileAsync, writeFile as writeFileAsync, stat as statAsync, mkdir as mkdirAsync } from 'fs/promises';
import { Effect } from 'effect';
import { ConfigError, ConfigParseError } from './errors.js';
import { dirname, join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { parseDocument } from 'yaml';
import { ModelId } from './settings.js';
import { ModelProvider } from './model-fallback.js';
import { MODEL_DEPRECATIONS, resolveModelId } from './model-capabilities.js';
import type { SubscriptionPlan, AuthMode } from './subscription-types.js';
import type { Role } from './agents.js';
import type { RuntimeName } from './runtimes/types.js';
export type { SubscriptionPlan, AuthMode };

/**
 * Provider configuration (enable/disable + API keys)
 */
export interface ProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** API key (optional, can use env var) */
  api_key?: string;
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
  /** Whether Panopticon uses its own tmux server/config or inherits the user's tmux config */
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

export type ManualCompactMode = 'claude-code' | 'panopticon-native';

export interface ConversationsConfig {
  /** Model used for Panopticon-native conversation compaction */
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

/**
 * Canonical workhorse slot list. Anything outside this set is rejected by
 * config-load validation (PAN-1048 review feedback 003 / REQ-18).
 */
export const WORKHORSE_SLOTS: readonly WorkhorseSlot[] = ['expensive', 'mid', 'cheap'] as const;

export type WorkhorsesConfig = Partial<Record<WorkhorseSlot, ModelRef>>;

export interface RoleSubConfig {
  model: ModelRef;
}

export type RoleEffort = 'low' | 'medium' | 'high';
export type FlywheelScope = 'pan-only' | 'all-tracked-projects';

export interface RoleConfig {
  model: ModelRef;
  harness?: 'claude-code' | 'pi';
  effort?: RoleEffort;
  maxAgents?: number;
  scope?: FlywheelScope;
  sub?: Record<string, RoleSubConfig>;
}

export type RolesConfig = Partial<Record<Role, RoleConfig>>;

export const DEFAULT_MODEL_REFS: Record<Role, ModelRef> = {
  plan: 'workhorse:expensive',
  work: 'workhorse:mid',
  review: 'workhorse:expensive',
  test: 'workhorse:mid',
  ship: 'workhorse:mid',
  flywheel: 'claude-opus-4-7',
};

export const DEFAULT_WORKHORSES: Required<WorkhorsesConfig> = {
  expensive: 'claude-opus-4-7',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5',
};

export const DEFAULT_ROLES: Record<Role, RoleConfig> = {
  plan: { model: 'workhorse:expensive' },
  work: {
    model: 'workhorse:mid',
    sub: {
      inspect: { model: 'workhorse:cheap' },
      'inspect-deep': { model: 'workhorse:mid' },
    },
  },
  review: {
    model: 'workhorse:expensive',
    sub: {
      security: { model: 'workhorse:expensive' },
      correctness: { model: 'workhorse:mid' },
      performance: { model: 'workhorse:mid' },
      requirements: { model: 'workhorse:mid' },
      synthesis: { model: 'workhorse:expensive' },
    },
  },
  test: { model: 'workhorse:mid' },
  ship: { model: 'workhorse:mid' },
  flywheel: {
    harness: 'claude-code',
    model: 'claude-opus-4-7',
    effort: 'high',
    maxAgents: 8,
    scope: 'pan-only',
  },
};

function cloneRoles(roles: RolesConfig): RolesConfig {
  const cloned: RolesConfig = {};
  for (const [role, roleConfig] of Object.entries(roles) as Array<[Role, RoleConfig]>) {
    cloned[role] = {
      ...roleConfig,
      sub: roleConfig.sub ? { ...roleConfig.sub } : undefined,
    };
  }
  return cloned;
}

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

  /** Durable memory extraction and retrieval configuration */
  memory?: MemoryConfig;

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

  /** Experimental, opt-in features. Each flag is research-preview and may be removed. */
  experimental?: ExperimentalConfig;

  /**
   * Claude Code spawn behavior.
   *
   * `permissionMode: 'auto'` (default) emits `--permission-mode auto`; the classifier
   * blocks destructive ops while still running fully autonomously. `'bypass'` emits
   * `--dangerously-skip-permissions --permission-mode bypassPermissions` (legacy).
   * Override per-invocation with `--yolo` / `--no-yolo` / `PAN_YOLO`.
   */
  claude?: {
    permissionMode?: 'auto' | 'bypass';
  };
}

/**
 * Experimental, opt-in feature flags. All default to false.
 *
 * Flags here gate research-preview features that may break or be removed in future
 * releases. Code paths gated by these flags must always degrade silently to the
 * existing default behaviour when the flag is off.
 */
export interface ExperimentalConfig {
  /**
   * Use Claude Code Channels (research-preview MCP capability) for prompt delivery
   * to eligible work agents. When enabled, eligible agents receive prompts via a
   * per-agent MCP bridge over a Unix socket; ineligible agents and all non-work
   * delivery sites continue to use tmux send-keys. Default: false.
   */
  claudeCodeChannels?: boolean;
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
 * Example (~/.panopticon/config.yaml):
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
  };

  /** Provider auth mode (subscription vs api-key) by provider */
  providerAuth: Partial<Record<ModelProvider, AuthMode>>;

  /** Provider subscription plan by provider */
  providerPlan: Partial<Record<ModelProvider, SubscriptionPlan>>;

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

  /** Shadow mode configuration */
  shadow: NormalizedShadowConfig;

  /** Caveman compressed output configuration (normalised, never undefined) */
  caveman: NormalizedCavemanConfig;

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

  /** Experimental flag values, normalised (always defined, never undefined). */
  experimental: NormalizedExperimentalConfig;

  /** Permission-mode for spawned Claude Code agents. Always defined; defaults to 'auto'. */
  claude: {
    permissionMode: 'auto' | 'bypass';
  };
}

/**
 * Normalized experimental flags — every flag has a concrete boolean value.
 */
export interface NormalizedExperimentalConfig {
  /** Whether Claude Code Channels prompt delivery is enabled for eligible work agents. */
  claudeCodeChannels: boolean;
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

export function resolveConversationWatchDirs(config: RuntimeConversationsConfig): RuntimeConversationsConfig {
  return {
    ...config,
    watchDirs: config.watchDirs.map((dir) =>
      dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir,
    ),
  };
}

export function getConversationsConfig(): RuntimeConversationsConfig {
  const { config } = loadConfig();
  return resolveConversationWatchDirs({
    ...config.conversations,
    apiKeys: config.apiKeys,
    enabledProviders: config.enabledProviders,
  });
}



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

/**
 * Default configuration (used when no config files exist)
 */
const DEFAULT_CONFIG: NormalizedConfig = {
  tmux: {
    configMode: 'managed',
  },
  enabledProviders: new Set(['anthropic']), // Only Anthropic by default
  apiKeys: {},
  providerAuth: {},
  providerPlan: {},
  openrouterFavorites: [],
  workhorses: { ...DEFAULT_WORKHORSES },
  roles: cloneRoles(DEFAULT_ROLES),
  overrides: {},
  geminiThinkingLevel: 3,
  trackerKeys: {},
  conversations: {
    compactionModel: 'claude-haiku-4-5',
    manualCompactMode: 'claude-code',
    richCompaction: true,
    titleModel: 'claude-haiku-4-5',
    watchDirs: ['~/Projects'],
    scanMaxParallel: null,
    embeddings: false,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingAutoOnDeep: true,
    enrichment: {
      quickModel: null,
      deepModel: null,
      maxParallel: 4,
      costConfirmThreshold: 1.00,
    },
  },
  memory: {
    extraction: {
      fallbackChain: [],
    },
    observationsEnabled: true,
    promptTimeInjectionEnabled: true,
    rollupPendingThreshold: 4,
    sidebarRefreshIntervalMs: 10_000,
    workerConcurrency: 4,
  },
  shadow: {
    enabled: false,
    trackers: {
      linear: false,
      github: false,
      gitlab: false,
      rally: false,
    },
  },
  caveman: {
    enabled: false,
    abTest: false,
    modes: {
      work: 'full',
      review: 'review',
      test: 'full',
      merge: 'full',
    },
  },
  tts: {
    enabled: false,
    voice: '',
    volume: 1,
    rate: 1,
    maxChars: 140,
    dropInfoWhenFull: true,
    daemonPort: 8787,
    daemonHost: '127.0.0.1',
    daemonAutoStart: false,
    voiceMap: {},
    mutedSources: [],
    utteranceTemplates: {},
    mutedIssues: [],
  },
  ttsSummarizer: {
    enabled: false,
    model: 'gpt-5.4-mini',
    batchWindowSeconds: 15,
  },
  resources: {
    memoryWarnGb: 4,
    memoryBlockGb: 2,
    agentWarnCount: 8,
    agentBlockCount: 10,
  },
  experimental: {
    claudeCodeChannels: false,
  },
  claude: {
    permissionMode: 'auto',
  },
};

/**
 * Path to global config file
 */
const GLOBAL_CONFIG_PATH = join(homedir(), '.panopticon', 'config.yaml');

/**
 * Normalize a provider config (handle both boolean and object forms)
 */
function normalizeProviderConfig(
  providerConfig: ProviderConfig | boolean | undefined,
  fallbackKey?: string
): { enabled: boolean; api_key?: string; auth?: AuthMode; plan?: SubscriptionPlan } {
  if (providerConfig === undefined) {
    return { enabled: false };
  }

  if (typeof providerConfig === 'boolean') {
    return { enabled: providerConfig, api_key: fallbackKey };
  }

  return {
    enabled: providerConfig.enabled,
    api_key: providerConfig.api_key || fallbackKey,
    auth: providerConfig.auth,
    plan: providerConfig.plan,
  };
}

/**
 * Resolve environment variables in config values.
 * If the env var is not set, returns the original reference (e.g., "$OPENAI_API_KEY")
 * so the UI can show that it's configured via env var but not resolved.
 */
function resolveEnvVar(value: string | undefined): string | undefined {
  if (!value) return undefined;

  // Replace $VAR_NAME or ${VAR_NAME} with environment variable
  // If env var is not set, keep the original reference
  return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (match, varName) => {
    const envValue = process.env[varName];
    return envValue !== undefined ? envValue : match; // Keep $VAR_NAME if not set
  });
}

/**
 * Load and parse a YAML config file
 */
function loadYamlFile(filePath: string): YamlConfig | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as YamlConfig;
    return parsed || {};
  } catch (error) {
    console.error(`Error loading YAML config from ${filePath}:`, error);
    return null;
  }
}

/**
 * Find project root by looking for .git directory
 */
function findProjectRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (true) {
    if (existsSync(join(currentDir, '.git'))) {
      return currentDir;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) return null;
    currentDir = parent;
  }
}

export function stripProjectTtsEndpoint(config: YamlConfig | null): YamlConfig | null {
  if (!config?.tts) return config;
  const { daemonHost: _daemonHost, daemonPort: _daemonPort, ...tts } = config.tts;
  return { ...config, tts };
}

/**
 * Load per-project config (.pan.yaml in project root, with fallback to .panopticon.yaml)
 */
function loadProjectConfig(): YamlConfig | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    return null;
  }

  const newConfigPath = join(projectRoot, '.pan.yaml');
  if (existsSync(newConfigPath)) {
    return stripProjectTtsEndpoint(loadYamlFile(newConfigPath));
  }

  const legacyConfigPath = join(projectRoot, '.panopticon.yaml');
  if (existsSync(legacyConfigPath)) {
    process.stderr.write(
      `[panopticon] Deprecation warning: .panopticon.yaml is deprecated. Rename it to .pan.yaml.\n`
    );
    return stripProjectTtsEndpoint(loadYamlFile(legacyConfigPath));
  }

  return null;
}

/**
 * Load global config (~/.panopticon/config.yaml)
 */
function loadGlobalConfig(): YamlConfig | null {
  return loadYamlFile(GLOBAL_CONFIG_PATH);
}

async function loadYamlFileFromDisk(filePath: string): Promise<YamlConfig | null> {
  try {
    const content = await readFileAsync(filePath, 'utf-8');
    const parsed = yaml.load(content) as YamlConfig;
    return parsed || {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    console.error(`Error loading YAML config from ${filePath}:`, error);
    return null;
  }
}

async function findProjectRootFromDisk(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = startDir;

  while (currentDir !== '/') {
    try {
      await statAsync(join(currentDir, '.git'));
      return currentDir;
    } catch { /* keep walking */ }
    currentDir = join(currentDir, '..');
  }

  return null;
}

async function loadProjectConfigFromDisk(): Promise<YamlConfig | null> {
  const projectRoot = await findProjectRootFromDisk();
  if (!projectRoot) return null;

  const newConfigPath = join(projectRoot, '.pan.yaml');
  if (await pathExistsFromDisk(newConfigPath)) return stripProjectTtsEndpoint(await loadYamlFileFromDisk(newConfigPath));

  const legacyConfigPath = join(projectRoot, '.panopticon.yaml');
  if (await pathExistsFromDisk(legacyConfigPath)) {
    process.stderr.write(
      `[panopticon] Deprecation warning: .panopticon.yaml is deprecated. Rename it to .pan.yaml.\n`
    );
    return stripProjectTtsEndpoint(await loadYamlFileFromDisk(legacyConfigPath));
  }

  return null;
}

async function loadGlobalConfigFromDisk(): Promise<YamlConfig | null> {
  return loadYamlFileFromDisk(GLOBAL_CONFIG_PATH);
}

async function pathExistsFromDisk(filePath: string): Promise<boolean> {
  try {
    await statAsync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge shadow configuration from multiple sources
 */
function mergeShadowConfig(
  result: NormalizedShadowConfig,
  config: YamlConfig | null
): void {
  if (!config?.shadow) return;

  // Merge global enabled flag
  if (config.shadow.enabled !== undefined) {
    result.enabled = config.shadow.enabled;
  }

  // Merge per-tracker overrides
  if (config.shadow.trackers) {
    if (config.shadow.trackers.linear !== undefined) {
      result.trackers.linear = config.shadow.trackers.linear;
    }
    if (config.shadow.trackers.github !== undefined) {
      result.trackers.github = config.shadow.trackers.github;
    }
    if (config.shadow.trackers.gitlab !== undefined) {
      result.trackers.gitlab = config.shadow.trackers.gitlab;
    }
    if (config.shadow.trackers.rally !== undefined) {
      result.trackers.rally = config.shadow.trackers.rally;
    }
  }
}

/**
 * Merge caveman configuration from a single config source into the result.
 */
function mergeCavemanConfig(
  result: NormalizedCavemanConfig,
  config: YamlConfig | null
): void {
  const caveman = config?.agents?.caveman;
  if (!caveman) return;

  if (caveman.enabled !== undefined) {
    result.enabled = caveman.enabled;
  }
  if (caveman.ab_test !== undefined) {
    result.abTest = caveman.ab_test;
  }
  if (caveman.work !== undefined) {
    result.modes.work = caveman.work;
  }
  if (caveman.review !== undefined) {
    result.modes.review = caveman.review;
  }
  if (caveman.test !== undefined) {
    result.modes.test = caveman.test;
  }
  if (caveman.merge !== undefined) {
    result.modes.merge = caveman.merge;
  }
}

function mergeTtsConfig(result: NormalizedTtsDaemonConfig, config: YamlConfig | null): void {
  const tts = config?.tts;
  if (!tts) return;

  if (tts.enabled !== undefined) result.enabled = tts.enabled;
  if (tts.voice !== undefined) result.voice = tts.voice;
  if (tts.statusVoice !== undefined) result.statusVoice = tts.statusVoice;
  if (tts.volume !== undefined) result.volume = tts.volume;
  if (tts.rate !== undefined) result.rate = tts.rate;
  if (tts.maxChars !== undefined) result.maxChars = tts.maxChars;
  if (tts.dropInfoWhenFull !== undefined) result.dropInfoWhenFull = tts.dropInfoWhenFull;
  if (tts.daemonPort !== undefined) result.daemonPort = tts.daemonPort;
  if (tts.daemonHost !== undefined) result.daemonHost = tts.daemonHost;
  if (tts.daemon?.autoStart !== undefined) result.daemonAutoStart = tts.daemon.autoStart;
  if (tts.voiceMap !== undefined) result.voiceMap = { ...tts.voiceMap };
  if (tts.mutedSources !== undefined) result.mutedSources = [...tts.mutedSources];
  if (tts.utteranceTemplates !== undefined) result.utteranceTemplates = { ...tts.utteranceTemplates };
  if (tts.mutedIssues !== undefined) result.mutedIssues = [...tts.mutedIssues];
}

export function getDefaultTtsDaemonConfig(): NormalizedTtsDaemonConfig {
  return {
    enabled: DEFAULT_CONFIG.tts.enabled,
    voice: DEFAULT_CONFIG.tts.voice,
    statusVoice: DEFAULT_CONFIG.tts.statusVoice,
    volume: DEFAULT_CONFIG.tts.volume,
    rate: DEFAULT_CONFIG.tts.rate,
    maxChars: DEFAULT_CONFIG.tts.maxChars,
    dropInfoWhenFull: DEFAULT_CONFIG.tts.dropInfoWhenFull,
    daemonPort: DEFAULT_CONFIG.tts.daemonPort,
    daemonHost: DEFAULT_CONFIG.tts.daemonHost,
    daemonAutoStart: DEFAULT_CONFIG.tts.daemonAutoStart,
    voiceMap: { ...DEFAULT_CONFIG.tts.voiceMap },
    mutedSources: [...DEFAULT_CONFIG.tts.mutedSources],
    utteranceTemplates: { ...DEFAULT_CONFIG.tts.utteranceTemplates },
    mutedIssues: [...DEFAULT_CONFIG.tts.mutedIssues],
  };
}

export function mergeTtsDaemonConfigs(...configs: (YamlConfig | null)[]): NormalizedTtsDaemonConfig {
  const result = getDefaultTtsDaemonConfig();
  for (const config of configs) {
    mergeTtsConfig(result, config);
  }
  return result;
}

function isWorkhorseRef(ref: ModelRef): boolean {
  return ref.startsWith('workhorse:');
}

function workhorseSlotFromRef(ref: ModelRef): WorkhorseSlot | string {
  return ref.slice('workhorse:'.length);
}

export function derefWorkhorse(
  ref: ModelRef,
  config: Pick<NormalizedConfig, 'workhorses'>,
  fieldPath = 'model',
): ModelId {
  if (!isWorkhorseRef(ref)) return resolveModelId(ref) as ModelId;

  const slot = workhorseSlotFromRef(ref) as WorkhorseSlot;
  const resolved = config.workhorses?.[slot];
  if (!resolved) {
    throw new Error(`config.yaml: ${fieldPath} references ${ref} but workhorses.${slot} is not defined`);
  }
  if (isWorkhorseRef(resolved)) {
    throw new Error(`config.yaml: workhorses.${slot} cannot reference another workhorse`);
  }
  return resolveModelId(resolved) as ModelId;
}

export function resolveModel(
  role: Role,
  subRole?: string,
  config: Pick<NormalizedConfig, 'roles' | 'workhorses'> = {},
): ModelId {
  const roleConfig = config.roles?.[role];
  const subModel = subRole ? roleConfig?.sub?.[subRole]?.model : undefined;
  const roleModel = roleConfig?.model;
  const ref = subModel ?? roleModel ?? DEFAULT_MODEL_REFS[role];
  const fieldPath = subModel
    ? `roles.${role}.sub.${subRole}.model`
    : roleModel
      ? `roles.${role}.model`
      : `defaults.${role}.model`;
  return derefWorkhorse(ref, config, fieldPath);
}

function mergeRoleConfig(result: NormalizedConfig, config: YamlConfig | null): void {
  if (!config?.workhorses && !config?.roles) return;

  if (config.workhorses) {
    // PAN-1048 review feedback 003 (REQ-18): reject any workhorse key outside
    // the canonical three slots (expensive | mid | cheap). The Settings API
    // already gates this on the HTTP path; the config-load path was silently
    // accepting hand-edited config.yaml values like workhorses.tiny: claude-…
    // and propagating them into the merged registry, where derefWorkhorse()
    // would later miss because the role config only references the canonical
    // slots. Failing fast at load time gives a precise field error instead.
    const unknownSlots = Object.keys(config.workhorses).filter(
      (slot): slot is string => !(WORKHORSE_SLOTS as readonly string[]).includes(slot),
    );
    if (unknownSlots.length > 0) {
      throw new Error(
        `config.yaml: unknown workhorse slot${unknownSlots.length > 1 ? 's' : ''} ` +
          unknownSlots.map((s) => `workhorses.${s}`).join(', ') +
          `. Valid slots: ${WORKHORSE_SLOTS.join(', ')}.`,
      );
    }
    result.workhorses = {
      ...(result.workhorses ?? {}),
      ...config.workhorses,
    };
  }

  if (config.roles) {
    result.roles = { ...(result.roles ?? {}) };
    for (const [role, roleConfig] of Object.entries(config.roles) as Array<[Role, RoleConfig]>) {
      const existing = result.roles[role];
      const sub = {
        ...(existing?.sub ?? {}),
        ...(roleConfig.sub ?? {}),
      };
      result.roles[role] = {
        ...existing,
        ...roleConfig,
        sub: Object.keys(sub).length > 0 ? sub : undefined,
      };
    }
  }
}

function validateRoleFields(role: Role, roleConfig: RoleConfig): void {
  if (roleConfig.harness !== undefined && roleConfig.harness !== 'claude-code' && roleConfig.harness !== 'pi') {
    throw new Error(`config.yaml: roles.${role}.harness must be claude-code or pi`);
  }
  if (roleConfig.effort !== undefined && roleConfig.effort !== 'low' && roleConfig.effort !== 'medium' && roleConfig.effort !== 'high') {
    throw new Error(`config.yaml: roles.${role}.effort must be low, medium, or high`);
  }
  if (roleConfig.maxAgents !== undefined && (!Number.isInteger(roleConfig.maxAgents) || roleConfig.maxAgents < 1)) {
    throw new Error(`config.yaml: roles.${role}.maxAgents must be a positive integer`);
  }
  if (roleConfig.scope !== undefined && roleConfig.scope !== 'pan-only' && roleConfig.scope !== 'all-tracked-projects') {
    throw new Error(`config.yaml: roles.${role}.scope must be pan-only or all-tracked-projects`);
  }
}

function validateRoleModelRefs(config: NormalizedConfig): void {
  for (const [slot, ref] of Object.entries(config.workhorses ?? {}) as Array<[WorkhorseSlot, ModelRef]>) {
    if (isWorkhorseRef(ref)) {
      throw new Error(`config.yaml: workhorses.${slot} cannot reference another workhorse`);
    }
    resolveModelId(ref);
  }

  for (const [role, roleConfig] of Object.entries(config.roles ?? {}) as Array<[Role, RoleConfig]>) {
    validateRoleFields(role, roleConfig);
    if (roleConfig.model) {
      derefWorkhorse(roleConfig.model, config, `roles.${role}.model`);
    }
    for (const [subRole, subConfig] of Object.entries(roleConfig.sub ?? {})) {
      if (subConfig.model) {
        derefWorkhorse(subConfig.model, config, `roles.${role}.sub.${subRole}.model`);
      }
    }
  }
}

/**
 * Merge multiple configs with precedence: project > global > defaults
 */
export function mergeConfigs(...configs: (YamlConfig | null)[]): { config: NormalizedConfig; explicitlyDisabled: Set<ModelProvider> } {
  const result: NormalizedConfig = {
    ...DEFAULT_CONFIG,
    tmux: {
      ...DEFAULT_CONFIG.tmux,
    },
    enabledProviders: new Set(DEFAULT_CONFIG.enabledProviders),
    workhorses: { ...DEFAULT_WORKHORSES },
    roles: cloneRoles(DEFAULT_ROLES),
    memory: {
      extraction: {
        ...DEFAULT_CONFIG.memory.extraction,
        fallbackChain: [...DEFAULT_CONFIG.memory.extraction.fallbackChain],
      },
      observationsEnabled: DEFAULT_CONFIG.memory.observationsEnabled,
      promptTimeInjectionEnabled: DEFAULT_CONFIG.memory.promptTimeInjectionEnabled,
      rollupPendingThreshold: DEFAULT_CONFIG.memory.rollupPendingThreshold,
      sidebarRefreshIntervalMs: DEFAULT_CONFIG.memory.sidebarRefreshIntervalMs,
      workerConcurrency: DEFAULT_CONFIG.memory.workerConcurrency,
    },
    shadow: {
      enabled: DEFAULT_CONFIG.shadow.enabled,
      trackers: { ...DEFAULT_CONFIG.shadow.trackers },
    },
    caveman: {
      enabled: DEFAULT_CONFIG.caveman.enabled,
      abTest: DEFAULT_CONFIG.caveman.abTest,
      modes: { ...DEFAULT_CONFIG.caveman.modes },
    },
    tts: {
      enabled: DEFAULT_CONFIG.tts.enabled,
      voice: DEFAULT_CONFIG.tts.voice,
      volume: DEFAULT_CONFIG.tts.volume,
      rate: DEFAULT_CONFIG.tts.rate,
      maxChars: DEFAULT_CONFIG.tts.maxChars,
      dropInfoWhenFull: DEFAULT_CONFIG.tts.dropInfoWhenFull,
      daemonPort: DEFAULT_CONFIG.tts.daemonPort,
      daemonHost: DEFAULT_CONFIG.tts.daemonHost,
      daemonAutoStart: DEFAULT_CONFIG.tts.daemonAutoStart,
      voiceMap: { ...DEFAULT_CONFIG.tts.voiceMap },
      mutedSources: [...DEFAULT_CONFIG.tts.mutedSources],
      utteranceTemplates: { ...DEFAULT_CONFIG.tts.utteranceTemplates },
      mutedIssues: [...DEFAULT_CONFIG.tts.mutedIssues],
    },
    ttsSummarizer: {
      enabled: DEFAULT_CONFIG.ttsSummarizer.enabled,
      model: DEFAULT_CONFIG.ttsSummarizer.model,
      batchWindowSeconds: DEFAULT_CONFIG.ttsSummarizer.batchWindowSeconds,
    },
    resources: {
      memoryWarnGb: DEFAULT_CONFIG.resources.memoryWarnGb,
      memoryBlockGb: DEFAULT_CONFIG.resources.memoryBlockGb,
      agentWarnCount: DEFAULT_CONFIG.resources.agentWarnCount,
      agentBlockCount: DEFAULT_CONFIG.resources.agentBlockCount,
    },
    experimental: {
      claudeCodeChannels: DEFAULT_CONFIG.experimental.claudeCodeChannels,
    },
    claude: {
      permissionMode: DEFAULT_CONFIG.claude.permissionMode,
    },
  };

  // Track providers explicitly disabled in models.providers so that legacy
  // api_keys and env var fallbacks don't re-enable them.
  const explicitlyDisabled = new Set<ModelProvider>();

  // Filter out null configs
  const validConfigs = configs.filter((c): c is YamlConfig => c !== null);

  // Merge in reverse order (lowest precedence first)
  for (const config of validConfigs.reverse()) {
    // Merge providers
    if (config.models?.providers) {
      const providers = config.models.providers;
      const legacyKeys = config.api_keys || {};

      // Anthropic
      const anthropic = normalizeProviderConfig(providers.anthropic, undefined);
      if (anthropic.enabled) {
        result.enabledProviders.add('anthropic');
      } else if (providers.anthropic !== undefined) {
        explicitlyDisabled.add('anthropic');
        result.enabledProviders.delete('anthropic');
      }

      // OpenAI
      const openai = normalizeProviderConfig(providers.openai, legacyKeys.openai);
      if (openai.enabled) {
        result.enabledProviders.add('openai');
        if (openai.api_key) {
          result.apiKeys.openai = resolveEnvVar(openai.api_key);
        }
        if (openai.auth) result.providerAuth.openai = openai.auth;
        if (openai.plan) result.providerPlan.openai = openai.plan;
      } else if (providers.openai !== undefined) {
        explicitlyDisabled.add('openai');
      }

      // Google
      const google = normalizeProviderConfig(providers.google, legacyKeys.google);
      if (google.enabled) {
        result.enabledProviders.add('google');
        if (google.api_key) {
          result.apiKeys.google = resolveEnvVar(google.api_key);
        }
        if (google.auth) result.providerAuth.google = google.auth;
        if (google.plan) result.providerPlan.google = google.plan;
      } else if (providers.google !== undefined) {
        explicitlyDisabled.add('google');
      }

      // MiniMax
      const minimax = normalizeProviderConfig(providers.minimax, legacyKeys.minimax);
      if (minimax.enabled) {
        result.enabledProviders.add('minimax');
        if (minimax.api_key) {
          result.apiKeys.minimax = resolveEnvVar(minimax.api_key);
        }
      } else if (providers.minimax !== undefined) {
        explicitlyDisabled.add('minimax');
      }

      // Z.AI
      const zai = normalizeProviderConfig(providers.zai, legacyKeys.zai);
      if (zai.enabled) {
        result.enabledProviders.add('zai');
        if (zai.api_key) {
          result.apiKeys.zai = resolveEnvVar(zai.api_key);
        }
      } else if (providers.zai !== undefined) {
        explicitlyDisabled.add('zai');
      }

      // Kimi
      const kimi = normalizeProviderConfig(providers.kimi, legacyKeys.kimi);
      if (kimi.enabled) {
        result.enabledProviders.add('kimi');
        if (kimi.api_key) {
          result.apiKeys.kimi = resolveEnvVar(kimi.api_key);
        }
      } else if (providers.kimi !== undefined) {
        explicitlyDisabled.add('kimi');
      }

      // OpenRouter
      const openrouter = normalizeProviderConfig(providers.openrouter, legacyKeys.openrouter);
      if (openrouter.enabled) {
        result.enabledProviders.add('openrouter');
        if (openrouter.api_key) {
          result.apiKeys.openrouter = resolveEnvVar(openrouter.api_key);
        }
      } else if (providers.openrouter !== undefined) {
        explicitlyDisabled.add('openrouter');
      }

      // MiMo
      const mimo = normalizeProviderConfig(providers.mimo, legacyKeys.mimo);
      if (mimo.enabled) {
        result.enabledProviders.add('mimo');
        if (mimo.api_key) {
          result.apiKeys.mimo = resolveEnvVar(mimo.api_key);
        }
      } else if (providers.mimo !== undefined) {
        explicitlyDisabled.add('mimo');
      }

      // Nous Portal
      const nous = normalizeProviderConfig(providers.nous, legacyKeys.nous);
      if (nous.enabled) {
        result.enabledProviders.add('nous');
        if (nous.api_key) {
          result.apiKeys.nous = resolveEnvVar(nous.api_key);
        }
      } else if (providers.nous !== undefined) {
        explicitlyDisabled.add('nous');
      }
    }

    // Merge tmux configuration
    if (config.tmux?.config_mode) {
      result.tmux.configMode = config.tmux.config_mode;
    }

    // Merge conversation configuration
    if (config.conversations?.compaction_model) {
      result.conversations.compactionModel = resolveModelId(config.conversations.compaction_model);
    }
    if (config.conversations?.manual_compact_mode) {
      result.conversations.manualCompactMode = config.conversations.manual_compact_mode;
    }
    if (config.conversations?.rich_compaction !== undefined) {
      result.conversations.richCompaction = config.conversations.rich_compaction;
    }
    if (config.conversations?.title_model) {
      result.conversations.titleModel = resolveModelId(config.conversations.title_model);
    }
    if (config.conversations?.watch_dirs) {
      result.conversations.watchDirs = config.conversations.watch_dirs;
    }
    if (config.conversations?.scan_max_parallel !== undefined) {
      result.conversations.scanMaxParallel = config.conversations.scan_max_parallel;
    }
    if (config.conversations?.embeddings !== undefined) {
      result.conversations.embeddings = config.conversations.embeddings;
    }
    if (config.conversations?.embedding_provider) {
      result.conversations.embeddingProvider = config.conversations.embedding_provider;
      if (config.conversations.embedding_provider === 'ollama' && !config.conversations.embedding_model) {
        result.conversations.embeddingModel = 'nomic-embed-text';
      }
    }
    if (config.conversations?.embedding_model) {
      result.conversations.embeddingModel = config.conversations.embedding_model;
    }
    if (config.conversations?.embedding_auto_on_deep !== undefined) {
      result.conversations.embeddingAutoOnDeep = config.conversations.embedding_auto_on_deep;
    }
    if (config.conversations?.enrichment?.quick_model !== undefined) {
      result.conversations.enrichment.quickModel = config.conversations.enrichment.quick_model;
    }
    if (config.conversations?.enrichment?.deep_model !== undefined) {
      result.conversations.enrichment.deepModel = config.conversations.enrichment.deep_model;
    }
    if (config.conversations?.enrichment?.max_parallel !== undefined) {
      result.conversations.enrichment.maxParallel = config.conversations.enrichment.max_parallel;
    }
    if (config.conversations?.enrichment?.cost_confirm_threshold !== undefined) {
      result.conversations.enrichment.costConfirmThreshold = config.conversations.enrichment.cost_confirm_threshold;
    }

    if (config.memory) {
      if (config.memory.extraction) {
        result.memory.extraction = {
          ...result.memory.extraction,
          ...(config.memory.extraction.provider !== undefined ? { provider: config.memory.extraction.provider } : {}),
          ...(config.memory.extraction.model !== undefined ? { model: config.memory.extraction.model } : {}),
          ...(config.memory.extraction.per_day_cost_cap_usd !== undefined ? { perDayCostCapUsd: config.memory.extraction.per_day_cost_cap_usd } : {}),
          ...(config.memory.extraction.fallback_chain !== undefined ? { fallbackChain: config.memory.extraction.fallback_chain } : {}),
        };
      }
      if (config.memory.features?.observations !== undefined) {
        result.memory.observationsEnabled = config.memory.features.observations;
      }
      if (config.memory.features?.prompt_time_injection !== undefined) {
        result.memory.promptTimeInjectionEnabled = config.memory.features.prompt_time_injection;
      }
      if (config.memory.rollup_pending_threshold !== undefined) {
        result.memory.rollupPendingThreshold = config.memory.rollup_pending_threshold;
      }
      if (config.memory.sidebar_refresh_interval_ms !== undefined) {
        result.memory.sidebarRefreshIntervalMs = config.memory.sidebar_refresh_interval_ms;
      }
      if (config.memory.worker_concurrency !== undefined) {
        result.memory.workerConcurrency = config.memory.worker_concurrency;
      }
    }

    // Merge OpenRouter favorites
    if (config.openrouter?.favorites) {
      result.openrouterFavorites = config.openrouter.favorites;
    }

    // Merge role/workhorse model configuration
    mergeRoleConfig(result, config);

    // Merge legacy API keys (for backward compatibility)
    // Only enable providers that weren't explicitly disabled in models.providers
    if (config.api_keys) {
      if (config.api_keys.openai) {
        result.apiKeys.openai = resolveEnvVar(config.api_keys.openai);
        if (!explicitlyDisabled.has('openai')) {
          result.enabledProviders.add('openai');
        }
      }
      if (config.api_keys.voyage) {
        result.apiKeys.voyage = resolveEnvVar(config.api_keys.voyage);
      }
      if (config.api_keys.google) {
        result.apiKeys.google = resolveEnvVar(config.api_keys.google);
        if (!explicitlyDisabled.has('google')) {
          result.enabledProviders.add('google');
        }
      }
      if (config.api_keys.minimax) {
        result.apiKeys.minimax = resolveEnvVar(config.api_keys.minimax);
        if (!explicitlyDisabled.has('minimax')) {
          result.enabledProviders.add('minimax');
        }
      }
      if (config.api_keys.zai) {
        result.apiKeys.zai = resolveEnvVar(config.api_keys.zai);
        if (!explicitlyDisabled.has('zai')) {
          result.enabledProviders.add('zai');
        }
      }
      if (config.api_keys.kimi) {
        result.apiKeys.kimi = resolveEnvVar(config.api_keys.kimi);
        if (!explicitlyDisabled.has('kimi')) {
          result.enabledProviders.add('kimi');
        }
      }
      if (config.api_keys.openrouter) {
        result.apiKeys.openrouter = resolveEnvVar(config.api_keys.openrouter);
        if (!explicitlyDisabled.has('openrouter')) {
          result.enabledProviders.add('openrouter');
        }
      }
      if (config.api_keys.mimo) {
        result.apiKeys.mimo = resolveEnvVar(config.api_keys.mimo);
        if (!explicitlyDisabled.has('mimo')) {
          result.enabledProviders.add('mimo');
        }
      }
      if (config.api_keys.nous) {
        result.apiKeys.nous = resolveEnvVar(config.api_keys.nous);
        if (!explicitlyDisabled.has('nous')) {
          result.enabledProviders.add('nous');
        }
      }
    }

    // Merge overrides
    if (config.models?.overrides) {
      result.overrides = {
        ...result.overrides,
        ...config.models.overrides,
      };
    }

    // Merge Gemini thinking level
    if (config.models?.gemini_thinking_level) {
      result.geminiThinkingLevel = config.models.gemini_thinking_level;
    }

    // Merge default conversation model
    if (config.models?.default_conversation_model) {
      result.defaultConversationModel = config.models.default_conversation_model;
    }

    // Merge tracker keys
    if (config.tracker_keys) {
      if (config.tracker_keys.linear) {
        result.trackerKeys.linear = resolveEnvVar(config.tracker_keys.linear);
      }
      if (config.tracker_keys.github) {
        result.trackerKeys.github = resolveEnvVar(config.tracker_keys.github);
      }
      if (config.tracker_keys.gitlab) {
        result.trackerKeys.gitlab = resolveEnvVar(config.tracker_keys.gitlab);
      }
      if (config.tracker_keys.rally) {
        result.trackerKeys.rally = resolveEnvVar(config.tracker_keys.rally);
      }
    }

    // Merge shadow configuration
    mergeShadowConfig(result.shadow, config);

    // Merge caveman configuration
    mergeCavemanConfig(result.caveman, config);

    // Merge TTS daemon configuration
    mergeTtsConfig(result.tts, config);

    // Merge TTS summarizer configuration
    if (config.tts?.summarizer) {
      const s = config.tts.summarizer;
      if (s.enabled !== undefined) {
        result.ttsSummarizer.enabled = s.enabled;
      }
      if (s.model) {
        result.ttsSummarizer.model = resolveModelId(s.model) as ModelId;
      }
      if (s.batch_window_seconds !== undefined) {
        result.ttsSummarizer.batchWindowSeconds = s.batch_window_seconds;
      }
    }

    if (config.resources) {
      if (typeof config.resources.memory_warn_gb === 'number') {
        result.resources.memoryWarnGb = config.resources.memory_warn_gb;
      }
      if (typeof config.resources.memory_block_gb === 'number') {
        result.resources.memoryBlockGb = config.resources.memory_block_gb;
      }
      if (typeof config.resources.agent_warn_count === 'number') {
        result.resources.agentWarnCount = config.resources.agent_warn_count;
      }
      if (typeof config.resources.agent_block_count === 'number') {
        result.resources.agentBlockCount = config.resources.agent_block_count;
      }
    }

    if (config.experimental) {
      if (typeof config.experimental.claudeCodeChannels === 'boolean') {
        result.experimental.claudeCodeChannels = config.experimental.claudeCodeChannels;
      }
    }

    if (config.claude && (config.claude.permissionMode === 'auto' || config.claude.permissionMode === 'bypass')) {
      result.claude.permissionMode = config.claude.permissionMode;
    }
  }

  validateRoleModelRefs(result);

  return { config: result, explicitlyDisabled };
}

/**
 * Detect deprecated model IDs in config overrides
 *
 * Returns array of migrations to perform, or empty array if none found.
 */
function detectDeprecatedModels(config: YamlConfig | null): Array<{
  workType: string;
  from: string;
  to: string;
}> {
  if (!config?.models?.overrides) {
    return [];
  }

  const migrations: Array<{ workType: string; from: string; to: string }> = [];

  for (const [workType, modelId] of Object.entries(config.models.overrides)) {
    if (modelId && MODEL_DEPRECATIONS[modelId]) {
      migrations.push({
        workType,
        from: modelId,
        to: MODEL_DEPRECATIONS[modelId],
      });
    }
  }

  return migrations;
}

/**
 * Apply deprecation migrations to a YamlConfig (in-place)
 */
function applyMigrations(
  config: YamlConfig,
  migrations: Array<{ workType: string; from: string; to: string }>
): void {
  if (!config.models) {
    config.models = {};
  }
  if (!config.models.overrides) {
    config.models.overrides = {};
  }

  for (const { workType, to } of migrations) {
    config.models.overrides[workType] = to as ModelId;
  }
}

/**
 * Create backup of global config file
 */
function backupGlobalConfig(): boolean {
  try {
    const backupPath = `${GLOBAL_CONFIG_PATH}.bak`;
    copyFileSync(GLOBAL_CONFIG_PATH, backupPath);
    console.log(`✓ Backed up config.yaml → config.yaml.bak`);
    return true;
  } catch (error) {
    console.error(`Failed to create config backup:`, error);
    return false;
  }
}

/**
 * Write YamlConfig back to global config file
 */
function writeGlobalConfig(config: YamlConfig): void {
  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
  });

  writeFileSync(GLOBAL_CONFIG_PATH, yamlContent, 'utf-8');
}

// ─── In-memory config cache (invalidated on file mtime change) ───────────────

interface ConfigCache {
  globalMtime: number;
  projectMtime: number;
  result: ConfigLoadResult;
}

let configCache: ConfigCache | null = null;

/**
 * Explicitly clear the in-memory config cache.
 *
 * The mtime-based cache invalidation in loadConfig() can miss rapid writes
 * (same-millisecond save → spawn) or coarse filesystem mtime resolution.
 * Call this after writing config.yaml to guarantee the next loadConfig()
 * reads from disk rather than returning stale cached data.
 */
export function clearConfigCache(): void {
  configCache = null;
}

function applyEnvironmentFallbacks(config: NormalizedConfig, explicitlyDisabled: Set<ModelProvider>): void {
  if (process.env.OPENAI_API_KEY && !config.apiKeys.openai) {
    config.apiKeys.openai = process.env.OPENAI_API_KEY;
    if (!explicitlyDisabled.has('openai')) config.enabledProviders.add('openai');
  }
  if (process.env.VOYAGE_API_KEY && !config.apiKeys.voyage) {
    config.apiKeys.voyage = process.env.VOYAGE_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY && !config.apiKeys.google) {
    config.apiKeys.google = process.env.GOOGLE_API_KEY;
    if (!explicitlyDisabled.has('google')) config.enabledProviders.add('google');
  }
  if (process.env.MINIMAX_API_KEY && !config.apiKeys.minimax) {
    config.apiKeys.minimax = process.env.MINIMAX_API_KEY;
    if (!explicitlyDisabled.has('minimax')) config.enabledProviders.add('minimax');
  }
  if (process.env.ZAI_API_KEY && !config.apiKeys.zai) {
    config.apiKeys.zai = process.env.ZAI_API_KEY;
    if (!explicitlyDisabled.has('zai')) config.enabledProviders.add('zai');
  }
  const kimiKey = process.env.KIMI_CODING_API_KEY || process.env.KIMI_API_KEY;
  if (kimiKey && !config.apiKeys.kimi) {
    config.apiKeys.kimi = kimiKey;
    if (!explicitlyDisabled.has('kimi')) config.enabledProviders.add('kimi');
  }
  if (process.env.OPENROUTER_API_KEY && !config.apiKeys.openrouter) {
    config.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
    if (!explicitlyDisabled.has('openrouter')) config.enabledProviders.add('openrouter');
  }
  if (process.env.MIMO_API_KEY && !config.apiKeys.mimo) {
    config.apiKeys.mimo = process.env.MIMO_API_KEY;
    if (!explicitlyDisabled.has('mimo')) config.enabledProviders.add('mimo');
  }
  if (process.env.NOUS_API_KEY && !config.apiKeys.nous) {
    config.apiKeys.nous = process.env.NOUS_API_KEY;
    if (!explicitlyDisabled.has('nous')) config.enabledProviders.add('nous');
  }
  if (process.env.LINEAR_API_KEY && !config.trackerKeys.linear) config.trackerKeys.linear = process.env.LINEAR_API_KEY;
  if (process.env.GITHUB_TOKEN && !config.trackerKeys.github) config.trackerKeys.github = process.env.GITHUB_TOKEN;
  if (process.env.GITLAB_TOKEN && !config.trackerKeys.gitlab) config.trackerKeys.gitlab = process.env.GITLAB_TOKEN;
  if (process.env.RALLY_API_KEY && !config.trackerKeys.rally) config.trackerKeys.rally = process.env.RALLY_API_KEY;
  if (process.env.SHADOW_MODE !== undefined) {
    config.shadow.enabled = ['true', '1', 'yes'].includes(process.env.SHADOW_MODE.toLowerCase());
  }
}

function getConfigMtimes(): { global: number; project: number } {
  let globalMtime = 0;
  let projectMtime = 0;

  try {
    if (existsSync(GLOBAL_CONFIG_PATH)) {
      globalMtime = statSync(GLOBAL_CONFIG_PATH).mtimeMs;
    }
  } catch { /* file may race */ }

  const projectRoot = findProjectRoot();
  if (projectRoot) {
    for (const name of ['.pan.yaml', '.panopticon.yaml']) {
      const path = join(projectRoot, name);
      try {
        if (existsSync(path)) {
          projectMtime = statSync(path).mtimeMs;
          break;
        }
      } catch { /* file may race */ }
    }
  }

  return { global: globalMtime, project: projectMtime };
}

async function getConfigMtimesFromDisk(): Promise<{ global: number; project: number }> {
  const globalMtime = await getMtimeFromDisk(GLOBAL_CONFIG_PATH);
  let projectMtime = 0;

  const projectRoot = await findProjectRootFromDisk();
  if (projectRoot) {
    for (const name of ['.pan.yaml', '.panopticon.yaml']) {
      projectMtime = await getMtimeFromDisk(join(projectRoot, name));
      if (projectMtime > 0) break;
    }
  }

  return { global: globalMtime, project: projectMtime };
}

async function getMtimeFromDisk(filePath: string): Promise<number> {
  try {
    return (await statAsync(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function loadConfigWithoutMigration(): Promise<ConfigLoadResult> {
  const mtimes = await getConfigMtimesFromDisk();
  if (
    configCache &&
    configCache.globalMtime === mtimes.global &&
    configCache.projectMtime === mtimes.project
  ) {
    return configCache.result;
  }

  const [globalConfig, projectConfig] = await Promise.all([
    loadGlobalConfigFromDisk(),
    loadProjectConfigFromDisk(),
  ]);
  const { config, explicitlyDisabled } = mergeConfigs(projectConfig, globalConfig);
  applyEnvironmentFallbacks(config, explicitlyDisabled);

  const result: ConfigLoadResult = { config };
  const freshMtimes = await getConfigMtimesFromDisk();
  configCache = {
    globalMtime: freshMtimes.global,
    projectMtime: freshMtimes.project,
    result,
  };
  return result;
}

/**
 * Load complete configuration (global + project + defaults)
 * Also loads API keys from environment variables as fallback
 *
 * IMPORTANT: This function may modify config.yaml if deprecated model IDs
 * are detected. A backup is created before any modifications.
 *
 * Results are cached in memory and invalidated when the underlying config
 * files change (checked via mtime).
 */
export function loadConfig(): ConfigLoadResult {
  const mtimes = getConfigMtimes();
  if (
    configCache &&
    configCache.globalMtime === mtimes.global &&
    configCache.projectMtime === mtimes.project
  ) {
    return configCache.result;
  }

  let globalConfig = loadGlobalConfig();
  const projectConfig = loadProjectConfig();

  // Check for deprecated models in global config
  let migrationResult: MigrationResult | undefined;
  if (globalConfig && hasGlobalConfig()) {
    const migrations = detectDeprecatedModels(globalConfig);

    if (migrations.length > 0) {
      const backedUp = backupGlobalConfig();

      applyMigrations(globalConfig, migrations);
      writeGlobalConfig(globalConfig);

      if (migrations.length > 0) {
        console.log('\n🔄 Model ID Migration:');
        for (const { workType, from, to } of migrations) {
          console.log(`  ${workType}: ${from} → ${to}`);
        }
      }
      console.log('');

      migrationResult = { migrated: migrations, backedUp };
    }
  }

  const { config, explicitlyDisabled } = mergeConfigs(projectConfig, globalConfig);

  // Load API keys from environment variables as fallback
  // This allows using ~/.panopticon.env for API keys
  // Only enable providers that weren't explicitly disabled in models.providers
  if (process.env.OPENAI_API_KEY && !config.apiKeys.openai) {
    config.apiKeys.openai = process.env.OPENAI_API_KEY;
    if (!explicitlyDisabled.has('openai')) {
      config.enabledProviders.add('openai');
    }
  }
  if (process.env.VOYAGE_API_KEY && !config.apiKeys.voyage) {
    config.apiKeys.voyage = process.env.VOYAGE_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY && !config.apiKeys.google) {
    config.apiKeys.google = process.env.GOOGLE_API_KEY;
    if (!explicitlyDisabled.has('google')) {
      config.enabledProviders.add('google');
    }
  }
  if (process.env.MINIMAX_API_KEY && !config.apiKeys.minimax) {
    config.apiKeys.minimax = process.env.MINIMAX_API_KEY;
    if (!explicitlyDisabled.has('minimax')) {
      config.enabledProviders.add('minimax');
    }
  }
  if (process.env.ZAI_API_KEY && !config.apiKeys.zai) {
    config.apiKeys.zai = process.env.ZAI_API_KEY;
    if (!explicitlyDisabled.has('zai')) {
      config.enabledProviders.add('zai');
    }
  }
  const kimiKey = process.env.KIMI_CODING_API_KEY || process.env.KIMI_API_KEY;
  if (kimiKey && !config.apiKeys.kimi) {
    config.apiKeys.kimi = kimiKey;
    if (!explicitlyDisabled.has('kimi')) {
      config.enabledProviders.add('kimi');
    }
  }
  if (process.env.OPENROUTER_API_KEY && !config.apiKeys.openrouter) {
    config.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
    if (!explicitlyDisabled.has('openrouter')) {
      config.enabledProviders.add('openrouter');
    }
  }
  if (process.env.MIMO_API_KEY && !config.apiKeys.mimo) {
    config.apiKeys.mimo = process.env.MIMO_API_KEY;
    if (!explicitlyDisabled.has('mimo')) {
      config.enabledProviders.add('mimo');
    }
  }
  if (process.env.NOUS_API_KEY && !config.apiKeys.nous) {
    config.apiKeys.nous = process.env.NOUS_API_KEY;
    if (!explicitlyDisabled.has('nous')) {
      config.enabledProviders.add('nous');
    }
  }

  // Load tracker API keys from environment variables as fallback
  if (process.env.LINEAR_API_KEY && !config.trackerKeys.linear) {
    config.trackerKeys.linear = process.env.LINEAR_API_KEY;
  }
  if (process.env.GITHUB_TOKEN && !config.trackerKeys.github) {
    config.trackerKeys.github = process.env.GITHUB_TOKEN;
  }
  if (process.env.GITLAB_TOKEN && !config.trackerKeys.gitlab) {
    config.trackerKeys.gitlab = process.env.GITLAB_TOKEN;
  }
  if (process.env.RALLY_API_KEY && !config.trackerKeys.rally) {
    config.trackerKeys.rally = process.env.RALLY_API_KEY;
  }

  // Load shadow mode from environment as fallback
  // Environment variable takes precedence over config file
  if (process.env.SHADOW_MODE !== undefined) {
    const envShadowMode = ['true', '1', 'yes'].includes(process.env.SHADOW_MODE.toLowerCase());
    config.shadow.enabled = envShadowMode;
  }

  const result: ConfigLoadResult = { config, migration: migrationResult };

  // Update cache with fresh mtimes (migration may have written global config)
  const freshMtimes = getConfigMtimes();
  configCache = {
    globalMtime: freshMtimes.global,
    projectMtime: freshMtimes.project,
    result,
  };

  return result;
}

/**
 * Check if a project-level config exists (.pan.yaml or .panopticon.yaml)
 */
export function hasProjectConfig(): boolean {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return false;
  return existsSync(join(projectRoot, '.pan.yaml')) || existsSync(join(projectRoot, '.panopticon.yaml'));
}

/**
 * Check if global config exists
 */
export function hasGlobalConfig(): boolean {
  return existsSync(GLOBAL_CONFIG_PATH);
}

/**
 * Get path to global config file
 */
export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}

/**
 * Get path to project config file (null if not in a project).
 * Returns .pan.yaml if it exists, falls back to .panopticon.yaml, otherwise returns .pan.yaml as default.
 */
export function getProjectConfigPath(): string | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return null;
  if (existsSync(join(projectRoot, '.pan.yaml'))) {
    return join(projectRoot, '.pan.yaml');
  }
  if (existsSync(join(projectRoot, '.panopticon.yaml'))) {
    return join(projectRoot, '.panopticon.yaml');
  }
  return join(projectRoot, '.pan.yaml');
}

/**
 * Returns whether the experimental Claude Code Channels prompt-delivery flag
 * is enabled. Resolves via loadConfig() so the value reflects merged global,
 * project, and env-var sources at the moment of the call.
 */
export function isClaudeCodeChannelsEnabled(): boolean {
  return loadConfig().config.experimental.claudeCodeChannels;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native loadConfigWithoutMigration. Reads global + project config,
 * merges with defaults, applies env fallbacks. Fails with ConfigParseError
 * for malformed YAML or ConfigError for other I/O failures.
 */
export const loadConfigAsyncNoMigrationEffect = (): Effect.Effect<
  ConfigLoadResult,
  ConfigError | ConfigParseError
> =>
  Effect.tryPromise({
    try: () => loadConfigWithoutMigration(),
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const getConversationsConfigAsyncEffect = (): Effect.Effect<
  RuntimeConversationsConfig,
  ConfigError | ConfigParseError
> =>
  Effect.gen(function* () {
    const { config } = yield* loadConfigAsyncNoMigrationEffect();
    return resolveConversationWatchDirs({
      ...config.conversations,
      apiKeys: config.apiKeys,
      enabledProviders: config.enabledProviders,
    });
  });

/**
 * Effect-native loadConfig — sync read, wraps any failure (parse / fs) as
 * ConfigError. Use this from Effect contexts that need merged config without
 * forcing the codebase to migrate every loadConfig call site.
 */
export const loadConfigEffect = (): Effect.Effect<ConfigLoadResult, ConfigError> =>
  Effect.try({
    try: () => loadConfig(),
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/**
 * Effect-native updateConversationsConfig. Persists the supplied
 * ConversationsConfig overrides into config.yaml. Fails with ConfigError on
 * write failure.
 */
export const updateConversationsConfigAsyncEffect = (
  updates: ConversationsConfig,
): Effect.Effect<void, ConfigError | ConfigParseError> =>
  Effect.tryPromise({
    try: async () => {
      await loadConfigWithoutMigration();
      let existingContent = '{}\n';
      try {
        const content = await readFileAsync(GLOBAL_CONFIG_PATH, 'utf-8');
        existingContent = content.trim().length > 0 ? content : '{}\n';
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
      }

      const doc = parseDocument(existingContent);
      if (doc.contents === null) {
        doc.contents = parseDocument('{}\n').contents;
      }

      for (const [key, value] of Object.entries(updates) as Array<[keyof ConversationsConfig, unknown]>) {
        if (value !== undefined) doc.setIn(['conversations', key], value);
      }

      await mkdirAsync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
      await writeFileAsync(GLOBAL_CONFIG_PATH, doc.toString({ lineWidth: 120 }), 'utf-8');
      clearConfigCache();
    },
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
