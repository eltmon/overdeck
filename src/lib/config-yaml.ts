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
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';
import { ModelProvider } from './model-fallback.js';
import { MODEL_DEPRECATIONS, resolveModelId } from './model-capabilities.js';
import type { SubscriptionPlan, AuthMode } from './subscription-types.js';
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
}

/**
 * TTS summarizer configuration
 */
export interface TtsSummarizerConfig {
  /** Whether the TTS summarizer is active */
  enabled?: boolean;
  /** Model ID to use for summarization (default: gpt-5.5-nano) */
  model?: ModelId;
  /** Seconds to batch activity before summarizing (default: 15) */
  batch_window_seconds?: number;
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
    };

    /** Per-work-type overrides (explicit model for specific tasks) */
    overrides?: Partial<Record<WorkTypeId, ModelId>>;

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
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
    openrouter?: string;
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

  /** TTS summarizer configuration */
  tts?: {
    summarizer?: TtsSummarizerConfig;
  };

  /** Resource thresholds for dashboard health + spawn guardrails */
  resources?: ResourcesConfig;

  /** Experimental, opt-in features. Each flag is research-preview and may be removed. */
  experimental?: ExperimentalConfig;
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
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
    openrouter?: string;
  };

  /** Provider auth mode (subscription vs api-key) by provider */
  providerAuth: Partial<Record<ModelProvider, AuthMode>>;

  /** Provider subscription plan by provider */
  providerPlan: Partial<Record<ModelProvider, SubscriptionPlan>>;

  /** OpenRouter favorite model IDs (shown in ModelPicker) */
  openrouterFavorites: string[];

  /** Per-work-type overrides */
  overrides: Partial<Record<WorkTypeId, ModelId>>;

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
  };

  /** Shadow mode configuration */
  shadow: NormalizedShadowConfig;

  /** Caveman compressed output configuration (normalised, never undefined) */
  caveman: NormalizedCavemanConfig;

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
export interface MigrationResult {
  /** List of migrated model IDs */
  migrated: Array<{
    /** Work type that was migrated */
    workType: WorkTypeId;
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
  overrides: {},
  geminiThinkingLevel: 3,
  trackerKeys: {},
  conversations: {
    compactionModel: 'claude-haiku-4-5',
    manualCompactMode: 'claude-code',
    richCompaction: true,
    titleModel: 'claude-haiku-4-5',
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
  ttsSummarizer: {
    enabled: false,
    model: 'gpt-5.5-nano',
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

  while (currentDir !== '/') {
    if (existsSync(join(currentDir, '.git'))) {
      return currentDir;
    }
    currentDir = join(currentDir, '..');
  }

  return null;
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
    return loadYamlFile(newConfigPath);
  }

  const legacyConfigPath = join(projectRoot, '.panopticon.yaml');
  if (existsSync(legacyConfigPath)) {
    process.stderr.write(
      `[panopticon] Deprecation warning: .panopticon.yaml is deprecated. Rename it to .pan.yaml.\n`
    );
    return loadYamlFile(legacyConfigPath);
  }

  return null;
}

/**
 * Load global config (~/.panopticon/config.yaml)
 */
function loadGlobalConfig(): YamlConfig | null {
  return loadYamlFile(GLOBAL_CONFIG_PATH);
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

/**
 * Merge multiple configs with precedence: project > global > defaults
 */
function mergeConfigs(...configs: (YamlConfig | null)[]): { config: NormalizedConfig; explicitlyDisabled: Set<ModelProvider> } {
  const result: NormalizedConfig = {
    ...DEFAULT_CONFIG,
    tmux: {
      ...DEFAULT_CONFIG.tmux,
    },
    enabledProviders: new Set(DEFAULT_CONFIG.enabledProviders),
    shadow: {
      enabled: DEFAULT_CONFIG.shadow.enabled,
      trackers: { ...DEFAULT_CONFIG.shadow.trackers },
    },
    caveman: {
      enabled: DEFAULT_CONFIG.caveman.enabled,
      abTest: DEFAULT_CONFIG.caveman.abTest,
      modes: { ...DEFAULT_CONFIG.caveman.modes },
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

    // Merge OpenRouter favorites
    if (config.openrouter?.favorites) {
      result.openrouterFavorites = config.openrouter.favorites;
    }

    // Merge legacy API keys (for backward compatibility)
    // Only enable providers that weren't explicitly disabled in models.providers
    if (config.api_keys) {
      if (config.api_keys.openai) {
        result.apiKeys.openai = resolveEnvVar(config.api_keys.openai);
        if (!explicitlyDisabled.has('openai')) {
          result.enabledProviders.add('openai');
        }
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
  }

  return { config: result, explicitlyDisabled };
}

/** Renamed work-type keys from the convoy→review migration */
const CONVOY_KEY_MIGRATION: Record<string, WorkTypeId> = {
  'convoy:security-reviewer': 'review:security',
  'convoy:performance-reviewer': 'review:performance',
  'convoy:correctness-reviewer': 'review:correctness',
  'convoy:requirements-reviewer': 'review:requirements',
  'convoy:synthesis-agent': 'review:synthesis',
};

/**
 * Migrate legacy convoy:* override keys → review:* equivalents.
 * Mutates config in-place and returns true if any keys were migrated.
 */
function migrateConvoyKeys(config: YamlConfig): boolean {
  if (!config.models?.overrides) return false;

  let migrated = false;
  for (const [oldKey, newKey] of Object.entries(CONVOY_KEY_MIGRATION)) {
    if (oldKey in config.models.overrides) {
      const value = (config.models.overrides as Record<string, string>)[oldKey];
      delete (config.models.overrides as Record<string, string>)[oldKey];
      (config.models.overrides as Record<string, string>)[newKey] = value;
      migrated = true;
    }
  }
  return migrated;
}

/**
 * Detect deprecated model IDs in config overrides
 *
 * Returns array of migrations to perform, or empty array if none found.
 */
function detectDeprecatedModels(config: YamlConfig | null): Array<{
  workType: WorkTypeId;
  from: string;
  to: string;
}> {
  if (!config?.models?.overrides) {
    return [];
  }

  const migrations: Array<{ workType: WorkTypeId; from: string; to: string }> = [];

  for (const [workType, modelId] of Object.entries(config.models.overrides)) {
    if (modelId && MODEL_DEPRECATIONS[modelId]) {
      migrations.push({
        workType: workType as WorkTypeId,
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
  migrations: Array<{ workType: WorkTypeId; from: string; to: string }>
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

  // Check for deprecated models and legacy key names in global config
  let migrationResult: MigrationResult | undefined;
  if (globalConfig && hasGlobalConfig()) {
    const convoyMigrated = migrateConvoyKeys(globalConfig);
    const migrations = detectDeprecatedModels(globalConfig);

    if (convoyMigrated || migrations.length > 0) {
      const backedUp = backupGlobalConfig();

      if (migrations.length > 0) {
        applyMigrations(globalConfig, migrations);
      }

      writeGlobalConfig(globalConfig);

      if (convoyMigrated) {
        console.log('\n🔄 Work-type key migration: convoy:* → review:*');
      }
      if (migrations.length > 0) {
        console.log('\n🔄 Model ID Migration:');
        for (const { workType, from, to } of migrations) {
          console.log(`  ${workType}: ${from} → ${to}`);
        }
      }
      if (convoyMigrated || migrations.length > 0) {
        console.log('');
      }

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
  if (process.env.KIMI_API_KEY && !config.apiKeys.kimi) {
    config.apiKeys.kimi = process.env.KIMI_API_KEY;
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
