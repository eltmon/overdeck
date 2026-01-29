import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SETTINGS_FILE } from './paths.js';

// Model identifiers
export type AnthropicModel = 'claude-opus-4-5' | 'claude-sonnet-4-5' | 'claude-haiku-4-5';
export type OpenAIModel = 'gpt-5.2-codex' | 'o3-deep-research' | 'gpt-4o' | 'gpt-4o-mini';
export type GoogleModel = 'gemini-3-pro-preview' | 'gemini-3-flash-preview';
export type ZAIModel = 'glm-4.7' | 'glm-4.7-flash';
export type KimiModel = 'kimi-k2' | 'kimi-k2.5';
export type ModelId = AnthropicModel | OpenAIModel | GoogleModel | ZAIModel | KimiModel;

// Task complexity levels
export type ComplexityLevel = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

// Specialist agent types
export interface SpecialistModels {
  review_agent: ModelId;
  test_agent: ModelId;
  merge_agent: ModelId;
}

// Complexity-based model mapping
export type ComplexityModels = {
  [K in ComplexityLevel]: ModelId;
};

// All model configuration
export interface ModelsConfig {
  specialists: SpecialistModels;
  planning_agent: ModelId;
  complexity: ComplexityModels;
}

// API keys for external providers
export interface ApiKeysConfig {
  openai?: string;
  google?: string;
  zai?: string;
  kimi?: string;
}

// Complete settings structure
export interface SettingsConfig {
  models: ModelsConfig;
  api_keys: ApiKeysConfig;
}

// Default settings (Anthropic-only, no external API keys)
const DEFAULT_SETTINGS: SettingsConfig = {
  models: {
    specialists: {
      review_agent: 'claude-sonnet-4-5',
      test_agent: 'claude-haiku-4-5',
      merge_agent: 'claude-sonnet-4-5',
    },
    planning_agent: 'claude-opus-4-5',
    complexity: {
      trivial: 'claude-haiku-4-5',
      simple: 'claude-haiku-4-5',
      medium: 'claude-sonnet-4-5',
      complex: 'claude-sonnet-4-5',
      expert: 'claude-opus-4-5',
    },
  },
  api_keys: {},
};

/**
 * Deep merge utility that recursively merges objects.
 * - Recursively merges nested objects
 * - User values take precedence over defaults
 */
function deepMerge<T extends object>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults };

  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const defaultVal = defaults[key];
    const overrideVal = overrides[key];

    // Skip undefined values in overrides
    if (overrideVal === undefined) continue;

    // Deep merge if both values are non-array objects
    if (
      typeof defaultVal === 'object' &&
      defaultVal !== null &&
      !Array.isArray(defaultVal) &&
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(defaultVal, overrideVal as any);
    } else {
      // For primitives or null - override wins
      result[key] = overrideVal as T[keyof T];
    }
  }

  return result;
}

/**
 * Load settings from ~/.panopticon/settings.json
 * Returns default settings if file doesn't exist or is invalid
 */
export function loadSettings(): SettingsConfig {
  if (!existsSync(SETTINGS_FILE)) {
    return getDefaultSettings();
  }

  try {
    const content = readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(content) as Partial<SettingsConfig>;
    return deepMerge(DEFAULT_SETTINGS, parsed);
  } catch (error) {
    console.error('Warning: Failed to parse settings.json, using defaults');
    return getDefaultSettings();
  }
}

/**
 * Save settings to ~/.panopticon/settings.json
 * Writes with pretty formatting (2-space indent)
 */
export function saveSettings(settings: SettingsConfig): void {
  const content = JSON.stringify(settings, null, 2);
  writeFileSync(SETTINGS_FILE, content, 'utf8');
}

/**
 * Validate settings structure and model IDs
 * Returns error message if invalid, null if valid
 */
export function validateSettings(settings: SettingsConfig): string | null {
  // Validate models structure
  if (!settings.models) {
    return 'Missing models configuration';
  }

  // Validate specialists
  if (!settings.models.specialists) {
    return 'Missing specialists configuration';
  }
  const specialists = settings.models.specialists;
  if (!specialists.review_agent || !specialists.test_agent || !specialists.merge_agent) {
    return 'Missing specialist agent model configuration';
  }

  // Validate planning agent
  if (!settings.models.planning_agent) {
    return 'Missing planning_agent configuration';
  }

  // Validate complexity levels
  if (!settings.models.complexity) {
    return 'Missing complexity configuration';
  }
  const complexity = settings.models.complexity;
  const requiredLevels: ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
  for (const level of requiredLevels) {
    if (!complexity[level]) {
      return `Missing complexity level: ${level}`;
    }
  }

  // Validate api_keys structure (optional keys)
  if (!settings.api_keys) {
    return 'Missing api_keys configuration';
  }

  return null;
}

/**
 * Get a deep copy of the default settings
 */
export function getDefaultSettings(): SettingsConfig {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

/**
 * Get available models for a provider based on configured API keys
 * Returns empty array if provider API key is not configured
 */
export function getAvailableModels(settings: SettingsConfig): {
  anthropic: AnthropicModel[];
  openai: OpenAIModel[];
  google: GoogleModel[];
  zai: ZAIModel[];
  kimi: KimiModel[];
} {
  const anthropicModels: AnthropicModel[] = [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
  ];

  const openaiModels: OpenAIModel[] = settings.api_keys.openai
    ? ['gpt-5.2-codex', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini']
    : [];

  const googleModels: GoogleModel[] = settings.api_keys.google
    ? ['gemini-3-pro-preview', 'gemini-3-flash-preview']
    : [];

  const zaiModels: ZAIModel[] = settings.api_keys.zai
    ? ['glm-4.7', 'glm-4.7-flash']
    : [];

  const kimiModels: KimiModel[] = settings.api_keys.kimi
    ? ['kimi-k2', 'kimi-k2.5']
    : [];

  return {
    anthropic: anthropicModels,
    openai: openaiModels,
    google: googleModels,
    zai: zaiModels,
    kimi: kimiModels,
  };
}
