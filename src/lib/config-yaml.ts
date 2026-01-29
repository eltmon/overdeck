/**
 * YAML Configuration Loader
 *
 * Loads and merges configuration from:
 * 1. Global config: ~/.panopticon/config.yaml
 * 2. Per-project config: .panopticon.yaml (project root)
 *
 * Precedence: project > global > preset defaults
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';
import { PresetName, DEFAULT_PRESET } from './model-presets.js';
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
    /** Selected preset (premium, balanced, budget) */
    preset?: PresetName;

    /** Provider enable/disable and API keys */
    providers?: {
      anthropic?: ProviderConfig | boolean; // Can be just boolean for backward compat
      openai?: ProviderConfig | boolean;
      google?: ProviderConfig | boolean;
      zai?: ProviderConfig | boolean;
      kimi?: ProviderConfig | boolean;
    };

    /** Per-work-type overrides */
    overrides?: Partial<Record<WorkTypeId, ModelId>>;

    /** Gemini thinking level (1-4) */
    gemini_thinking_level?: 1 | 2 | 3 | 4;
  };

  /** Legacy API keys (for backward compatibility with settings.json) */
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
  /** Selected preset */
  preset: PresetName;

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
  preset: DEFAULT_PRESET,
  enabledProviders: new Set(['anthropic']), // Only Anthropic by default
  apiKeys: {},
  overrides: {},
  geminiThinkingLevel: 3, // Medium by default
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
 * Resolve environment variables in config values
 */
function resolveEnvVar(value: string | undefined): string | undefined {
  if (!value) return undefined;

  // Replace $VAR_NAME or ${VAR_NAME} with environment variable
  return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

/**
 * Load and parse a YAML config file
 *
 * @param filePath Path to YAML file
 * @returns Parsed config or null if file doesn't exist
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
 *
 * @param startDir Directory to start searching from
 * @returns Project root path or null if not in a git repo
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
 *
 * @returns Parsed config or null if not in a project or no config exists
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
 *
 * @returns Parsed config or null if file doesn't exist
 */
function loadGlobalConfig(): YamlConfig | null {
  return loadYamlFile(GLOBAL_CONFIG_PATH);
}

/**
 * Merge multiple configs with precedence: project > global > defaults
 *
 * @param configs Configs to merge (in order of precedence, highest first)
 * @returns Merged and normalized config
 */
function mergeConfigs(...configs: (YamlConfig | null)[]): NormalizedConfig {
  const result: NormalizedConfig = { ...DEFAULT_CONFIG };

  // Filter out null configs
  const validConfigs = configs.filter((c): c is YamlConfig => c !== null);

  // Merge in reverse order (lowest precedence first)
  for (const config of validConfigs.reverse()) {
    // Merge preset
    if (config.models?.preset) {
      result.preset = config.models.preset;
    }

    // Merge providers
    if (config.models?.providers) {
      const providers = config.models.providers;

      // Legacy API keys as fallback
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
 *
 * This is the main entry point for loading configuration.
 *
 * @returns Merged and normalized configuration
 */
export function loadConfig(): NormalizedConfig {
  const globalConfig = loadGlobalConfig();
  const projectConfig = loadProjectConfig();

  // Merge with precedence: project > global > defaults
  return mergeConfigs(projectConfig, globalConfig);
}

/**
 * Check if a project-level config exists
 */
export function hasProjectConfig(): boolean {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return false;

  const projectConfigPath = join(projectRoot, '.panopticon.yaml');
  return existsSync(projectConfigPath);
}

/**
 * Check if global config exists
 */
export function hasGlobalConfig(): boolean {
  return existsSync(GLOBAL_CONFIG_PATH);
}

/**
 * Get path to global config file (for editing/display)
 */
export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}

/**
 * Get path to project config file (for editing/display)
 * Returns null if not in a project
 */
export function getProjectConfigPath(): string | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return null;

  return join(projectRoot, '.panopticon.yaml');
}
