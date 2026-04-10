/**
 * YAML Configuration Loader
 *
 * Loads and merges configuration from:
 * 1. Global config: ~/.panopticon/config.yaml
 * 2. Per-project config: .pan.yaml (project root, falls back to .panopticon.yaml with deprecation warning)
 *
 * Uses smart (capability-based) model selection - no legacy presets.
 */

import { readFileSync, existsSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';
import { ModelProvider } from './model-fallback.js';
import { MODEL_DEPRECATIONS, resolveModelId } from './model-capabilities.js';

/**
 * Provider configuration (enable/disable + API keys)
 */
export interface ProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** API key (optional, can use env var) */
  api_key?: string;
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
      kimi?: ProviderConfig | boolean;
      minimax?: ProviderConfig | boolean;
      openrouter?: ProviderConfig | boolean;
    };

    /** Per-work-type overrides (explicit model for specific tasks) */
    overrides?: Partial<Record<WorkTypeId, ModelId>>;

    /** Gemini thinking level (1-4) */
    gemini_thinking_level?: 1 | 2 | 3 | 4;
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
    kimi?: string;
    minimax?: string;
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

  /** Multi-tool sync configuration */
  tools?: {
    /**
     * Additional AI tools to sync skills to.
     * Supported: 'cursor' | 'codex' | 'windsurf' | 'cline' | 'copilot' | 'aider'
     * Per-project .pan.yaml values merge additively with global config.
     */
    also_sync?: string[];
  };
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
  /** Enabled providers */
  enabledProviders: Set<ModelProvider>;

  /** API keys by provider */
  apiKeys: {
    openai?: string;
    google?: string;
    zai?: string;
    kimi?: string;
    minimax?: string;
    openrouter?: string;
  };

  /** OpenRouter favorite model IDs (shown in ModelPicker) */
  openrouterFavorites: string[];

  /** Per-work-type overrides */
  overrides: Partial<Record<WorkTypeId, ModelId>>;

  /** Gemini thinking level */
  geminiThinkingLevel: 1 | 2 | 3 | 4;

  /** Tracker API keys */
  trackerKeys: {
    linear?: string;
    github?: string;
    gitlab?: string;
    rally?: string;
  };

  /** Shadow mode configuration */
  shadow: NormalizedShadowConfig;
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
  enabledProviders: new Set(['anthropic']), // Only Anthropic by default
  apiKeys: {},
  openrouterFavorites: [],
  overrides: {},
  geminiThinkingLevel: 3,
  trackerKeys: {},
  shadow: {
    enabled: false,
    trackers: {
      linear: false,
      github: false,
      gitlab: false,
      rally: false,
    },
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
): { enabled: boolean; api_key?: string } {
  if (providerConfig === undefined) {
    return { enabled: false };
  }

  if (typeof providerConfig === 'boolean') {
    return { enabled: providerConfig, api_key: fallbackKey };
  }

  return {
    enabled: providerConfig.enabled,
    api_key: providerConfig.api_key || fallbackKey,
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
 * Merge multiple configs with precedence: project > global > defaults
 */
function mergeConfigs(...configs: (YamlConfig | null)[]): NormalizedConfig {
  const result: NormalizedConfig = {
    ...DEFAULT_CONFIG,
    enabledProviders: new Set(DEFAULT_CONFIG.enabledProviders),
    shadow: {
      enabled: DEFAULT_CONFIG.shadow.enabled,
      trackers: { ...DEFAULT_CONFIG.shadow.trackers },
    },
  };

  // Filter out null configs
  const validConfigs = configs.filter((c): c is YamlConfig => c !== null);

  // Merge in reverse order (lowest precedence first)
  for (const config of validConfigs.reverse()) {
    // Merge providers
    if (config.models?.providers) {
      const providers = config.models.providers;
      const legacyKeys = config.api_keys || {};

      // Anthropic
      const anthropic = normalizeProviderConfig(providers.anthropic);
      if (anthropic.enabled) {
        result.enabledProviders.add('anthropic');
      }

      // OpenAI
      const openai = normalizeProviderConfig(providers.openai, legacyKeys.openai);
      if (openai.enabled) {
        result.enabledProviders.add('openai');
        if (openai.api_key) {
          result.apiKeys.openai = resolveEnvVar(openai.api_key);
        }
      }

      // Google
      const google = normalizeProviderConfig(providers.google, legacyKeys.google);
      if (google.enabled) {
        result.enabledProviders.add('google');
        if (google.api_key) {
          result.apiKeys.google = resolveEnvVar(google.api_key);
        }
      }

      // Kimi
      const kimi = normalizeProviderConfig(providers.kimi, legacyKeys.kimi);
      if (kimi.enabled) {
        result.enabledProviders.add('kimi');
        if (kimi.api_key) {
          result.apiKeys.kimi = resolveEnvVar(kimi.api_key);
        }
      }

      // MiniMax
      const minimax = normalizeProviderConfig(providers.minimax, legacyKeys.minimax);
      if (minimax.enabled) {
        result.enabledProviders.add('minimax');
        if (minimax.api_key) {
          result.apiKeys.minimax = resolveEnvVar(minimax.api_key);
        }
      }

      // OpenRouter
      const openrouter = normalizeProviderConfig(providers.openrouter);
      if (openrouter.enabled) {
        result.enabledProviders.add('openrouter');
        if (openrouter.api_key) {
          result.apiKeys.openrouter = resolveEnvVar(openrouter.api_key);
        }
      }
    }

    // Merge OpenRouter favorites
    if (config.openrouter?.favorites) {
      result.openrouterFavorites = config.openrouter.favorites;
    }

    // Merge legacy API keys (for backward compatibility)
    // If a `models.providers` section exists, the enabled state is already set above — don't
    // override it here. Only auto-enable from API keys when there's no explicit providers config.
    if (config.api_keys) {
      const hasProvidersConfig = !!config.models?.providers;
      if (config.api_keys.openai) {
        result.apiKeys.openai = resolveEnvVar(config.api_keys.openai);
        if (!hasProvidersConfig) result.enabledProviders.add('openai');
      }
      if (config.api_keys.google) {
        result.apiKeys.google = resolveEnvVar(config.api_keys.google);
        if (!hasProvidersConfig) result.enabledProviders.add('google');
      }
      if (config.api_keys.kimi) {
        result.apiKeys.kimi = resolveEnvVar(config.api_keys.kimi);
        if (!hasProvidersConfig) result.enabledProviders.add('kimi');
      }
      if (config.api_keys.minimax) {
        result.apiKeys.minimax = resolveEnvVar(config.api_keys.minimax);
        if (!hasProvidersConfig) result.enabledProviders.add('minimax');
      }
      if (config.api_keys.openrouter) {
        result.apiKeys.openrouter = resolveEnvVar(config.api_keys.openrouter);
        if (!hasProvidersConfig) result.enabledProviders.add('openrouter');
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
  }

  return result;
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

/**
 * Load complete configuration (global + project + defaults)
 * Also loads API keys from environment variables as fallback
 *
 * IMPORTANT: This function may modify config.yaml if deprecated model IDs
 * are detected. A backup is created before any modifications.
 */
export function loadConfig(): ConfigLoadResult {
  let globalConfig = loadGlobalConfig();
  const projectConfig = loadProjectConfig();

  // Check for deprecated models in global config
  let migrationResult: MigrationResult | undefined;
  if (globalConfig && hasGlobalConfig()) {
    const migrations = detectDeprecatedModels(globalConfig);

    if (migrations.length > 0) {
      // Create backup
      const backedUp = backupGlobalConfig();

      // Apply migrations to global config
      applyMigrations(globalConfig, migrations);

      // Write migrated config back to disk
      writeGlobalConfig(globalConfig);

      // Log migrations
      console.log('\n🔄 Model ID Migration:');
      for (const { workType, from, to } of migrations) {
        console.log(`  ${workType}: ${from} → ${to}`);
      }
      console.log('');

      migrationResult = { migrated: migrations, backedUp };
    }
  }

  const config = mergeConfigs(projectConfig, globalConfig);

  // Load API keys from environment variables as fallback
  // This allows using ~/.panopticon.env for API keys
  if (process.env.OPENAI_API_KEY && !config.apiKeys.openai) {
    config.apiKeys.openai = process.env.OPENAI_API_KEY;
    config.enabledProviders.add('openai');
  }
  if (process.env.GOOGLE_API_KEY && !config.apiKeys.google) {
    config.apiKeys.google = process.env.GOOGLE_API_KEY;
    config.enabledProviders.add('google');
  }
  if (process.env.KIMI_API_KEY && !config.apiKeys.kimi) {
    config.apiKeys.kimi = process.env.KIMI_API_KEY;
    config.enabledProviders.add('kimi');
  }
  if (process.env.OPENROUTER_API_KEY && !config.apiKeys.openrouter) {
    config.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
    config.enabledProviders.add('openrouter');
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

  return { config, migration: migrationResult };
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
