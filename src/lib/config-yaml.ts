/**
 * YAML Configuration Loader
 *
 * Loads and merges configuration from:
 * 1. Global config: ~/.panopticon/config.yaml
 * 2. Per-project config: .panopticon.yaml (project root)
 *
 * Uses smart (capability-based) model selection - no legacy presets.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';
import { ModelProvider } from './model-fallback.js';

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
      zai?: ProviderConfig | boolean;
      kimi?: ProviderConfig | boolean;
    };

    /** Per-work-type overrides (explicit model for specific tasks) */
    overrides?: Partial<Record<WorkTypeId, ModelId>>;

    /** Gemini thinking level (1-4) */
    gemini_thinking_level?: 1 | 2 | 3 | 4;
  };

  /** Legacy API keys (for backward compatibility) */
  api_keys?: {
    openai?: string;
    google?: string;
    zai?: string;
    kimi?: string;
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
  };

  /** Per-work-type overrides */
  overrides: Partial<Record<WorkTypeId, ModelId>>;

  /** Gemini thinking level */
  geminiThinkingLevel: 1 | 2 | 3 | 4;
}

/**
 * Default configuration (used when no config files exist)
 */
const DEFAULT_CONFIG: NormalizedConfig = {
  enabledProviders: new Set(['anthropic']), // Only Anthropic by default
  apiKeys: {},
  overrides: {},
  geminiThinkingLevel: 3,
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
 * Load per-project config (.panopticon.yaml in project root)
 */
function loadProjectConfig(): YamlConfig | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    return null;
  }

  const projectConfigPath = join(projectRoot, '.panopticon.yaml');
  return loadYamlFile(projectConfigPath);
}

/**
 * Load global config (~/.panopticon/config.yaml)
 */
function loadGlobalConfig(): YamlConfig | null {
  return loadYamlFile(GLOBAL_CONFIG_PATH);
}

/**
 * Merge multiple configs with precedence: project > global > defaults
 */
function mergeConfigs(...configs: (YamlConfig | null)[]): NormalizedConfig {
  const result: NormalizedConfig = {
    ...DEFAULT_CONFIG,
    enabledProviders: new Set(DEFAULT_CONFIG.enabledProviders),
  };

  // Filter out null configs
  const validConfigs = configs.filter((c): c is YamlConfig => c !== null);

  // Merge in reverse order (lowest precedence first)
  for (const config of validConfigs.reverse()) {
    // Merge providers
    if (config.models?.providers) {
      const providers = config.models.providers;
      const legacyKeys = config.api_keys || {};

      // Anthropic (always enabled)
      result.enabledProviders.add('anthropic');

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

      // Z.AI
      const zai = normalizeProviderConfig(providers.zai, legacyKeys.zai);
      if (zai.enabled) {
        result.enabledProviders.add('zai');
        if (zai.api_key) {
          result.apiKeys.zai = resolveEnvVar(zai.api_key);
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
    }

    // Merge legacy API keys (for backward compatibility)
    if (config.api_keys) {
      if (config.api_keys.openai) {
        result.apiKeys.openai = resolveEnvVar(config.api_keys.openai);
        result.enabledProviders.add('openai');
      }
      if (config.api_keys.google) {
        result.apiKeys.google = resolveEnvVar(config.api_keys.google);
        result.enabledProviders.add('google');
      }
      if (config.api_keys.zai) {
        result.apiKeys.zai = resolveEnvVar(config.api_keys.zai);
        result.enabledProviders.add('zai');
      }
      if (config.api_keys.kimi) {
        result.apiKeys.kimi = resolveEnvVar(config.api_keys.kimi);
        result.enabledProviders.add('kimi');
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
  }

  return result;
}

/**
 * Load complete configuration (global + project + defaults)
 * Also loads API keys from environment variables as fallback
 */
export function loadConfig(): NormalizedConfig {
  const globalConfig = loadGlobalConfig();
  const projectConfig = loadProjectConfig();
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
  if (process.env.ZAI_API_KEY && !config.apiKeys.zai) {
    config.apiKeys.zai = process.env.ZAI_API_KEY;
    config.enabledProviders.add('zai');
  }
  if (process.env.KIMI_API_KEY && !config.apiKeys.kimi) {
    config.apiKeys.kimi = process.env.KIMI_API_KEY;
    config.enabledProviders.add('kimi');
  }

  return config;
}

/**
 * Check if a project-level config exists
 */
export function hasProjectConfig(): boolean {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return false;
  return existsSync(join(projectRoot, '.panopticon.yaml'));
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
 * Get path to project config file (null if not in a project)
 */
export function getProjectConfigPath(): string | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return null;
  return join(projectRoot, '.panopticon.yaml');
}
