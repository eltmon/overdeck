import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SETTINGS_FILE } from './paths.js';

// Model identifiers
export type AnthropicModel = 'claude-opus-4-7' | 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-sonnet-4-5' | 'claude-haiku-4-5';
export type OpenAIModel = 'gpt-5.5' | 'gpt-5.5-pro' | 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.4-pro' | 'gpt-5.3-codex' | 'gpt-5.2' | 'o3' | 'o4-mini' | 'o3-deep-research' | 'gpt-4o' | 'gpt-4o-mini';
export type GoogleModel = 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-lite-preview' | 'gemini-3-pro-preview' | 'gemini-3-flash-preview' | 'gemini-2.5-pro' | 'gemini-2.5-flash';
export type KimiModel = 'kimi-k2.6' | 'kimi-k2.5' | 'K2.6-code-preview' | 'kimi-k2';
export type MiniMaxModel = 'minimax-m2.7' | 'minimax-m2.7-highspeed';
export type ZAIModel = 'glm-5.1' | 'glm-4.7' | 'glm-4.7-flash';
export type MimoModel = 'mimo-v2.5-pro' | 'mimo-v2.5';
export type ModelId = AnthropicModel | OpenAIModel | GoogleModel | KimiModel | MiniMaxModel | ZAIModel | MimoModel;

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
  status_review: ModelId;
  complexity: ComplexityModels;
}

// API keys for external providers
export interface ApiKeysConfig {
  openai?: string;
  google?: string;
  kimi?: string;
  minimax?: string;
  mimo?: string;
}

// Complete settings structure
export interface SettingsConfig {
  models: ModelsConfig;
  api_keys: ApiKeysConfig;
}

// Default settings - match optimal defaults from settings-api.ts
const DEFAULT_SETTINGS: SettingsConfig = {
  models: {
    specialists: {
      review_agent: 'claude-opus-4-6',
      test_agent: 'claude-sonnet-4-6',
      merge_agent: 'claude-sonnet-4-6',
    },
    status_review: 'claude-opus-4-6',
    complexity: {
      trivial: 'claude-haiku-4-5',
      simple: 'claude-haiku-4-5',
      medium: 'kimi-k2.5',
      complex: 'kimi-k2.5',
      expert: 'claude-opus-4-6',
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
 * Also loads API keys from environment variables as fallback
 */
export function loadSettings(): SettingsConfig {
  let settings: SettingsConfig;

  if (!existsSync(SETTINGS_FILE)) {
    settings = getDefaultSettings();
  } else {
    try {
      const content = readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(content) as Partial<SettingsConfig>;
      settings = deepMerge(DEFAULT_SETTINGS, parsed);
    } catch (error) {
      console.error('Warning: Failed to parse settings.json, using defaults');
      settings = getDefaultSettings();
    }
  }

  // Load API keys from environment variables as fallback
  // This allows using ~/.panopticon.env for API keys
  const envApiKeys: ApiKeysConfig = {};
  if (process.env.OPENAI_API_KEY) envApiKeys.openai = process.env.OPENAI_API_KEY;
  if (process.env.GOOGLE_API_KEY) envApiKeys.google = process.env.GOOGLE_API_KEY;
  if (process.env.MINIMAX_API_KEY) envApiKeys.minimax = process.env.MINIMAX_API_KEY;
  if (process.env.KIMI_CODING_API_KEY) envApiKeys.kimi = process.env.KIMI_CODING_API_KEY;
  else if (process.env.KIMI_API_KEY) envApiKeys.kimi = process.env.KIMI_API_KEY;
  if (process.env.MIMO_API_KEY) envApiKeys.mimo = process.env.MIMO_API_KEY;

  // Merge env vars as fallback (settings.json takes precedence)
  settings.api_keys = {
    ...envApiKeys,
    ...settings.api_keys,
  };

  return settings;
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
  kimi: KimiModel[];
  minimax: MiniMaxModel[];
  mimo: MimoModel[];
} {
  const anthropicModels: AnthropicModel[] = [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ];

  const openaiModels: OpenAIModel[] = settings.api_keys.openai
    ? ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-pro', 'gpt-5.3-codex', 'gpt-5.2', 'o3', 'o4-mini']
    : [];

  const googleModels: GoogleModel[] = settings.api_keys.google
    ? ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']
    : [];

  const kimiModels: KimiModel[] = settings.api_keys.kimi
    ? ['kimi-k2.6', 'kimi-k2.5', 'K2.6-code-preview']
    : [];

  const minimaxModels: MiniMaxModel[] = settings.api_keys.minimax
    ? ['minimax-m2.7', 'minimax-m2.7-highspeed']
    : [];

  const mimoModels: MimoModel[] = settings.api_keys.mimo
    ? ['mimo-v2.5-pro', 'mimo-v2.5']
    : [];

  return {
    anthropic: anthropicModels,
    openai: openaiModels,
    google: googleModels,
    kimi: kimiModels,
    minimax: minimaxModels,
    mimo: mimoModels,
  };
}

/**
 * Check if a model ID is an Anthropic model
 * Anthropic models can be run directly with `claude` CLI
 */
export function isAnthropicModel(modelId: ModelId | string): boolean {
  return modelId.startsWith('claude-');
}

/**
 * Get the Claude CLI model flag for an Anthropic model
 * Maps our model IDs to Claude's expected format
 */
export function getClaudeModelFlag(modelId: ModelId | string): string {
  const modelMap: Record<string, string> = {
    'claude-opus-4-6': 'opus',
    'claude-sonnet-4-6': 'sonnet',
    'claude-sonnet-4-5': 'sonnet',
    'claude-haiku-4-5': 'haiku',
  };
  return modelMap[modelId] || 'sonnet';
}

/**
 * Get the command to run an agent with a specific model
 * Always uses 'claude' CLI — non-Anthropic models work via ANTHROPIC_BASE_URL env var
 * pointing to their Anthropic-compatible endpoint.
 */
export function getAgentCommand(modelId: ModelId | string): { command: string; args: string[] } {
  if (isAnthropicModel(modelId)) {
    return {
      command: 'claude',
      args: ['--model', getClaudeModelFlag(modelId)],
    };
  }
  // Non-Anthropic direct providers: use claude CLI with the model name as-is.
  // The caller must set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN env vars.
  return {
    command: 'claude',
    args: ['--model', modelId],
  };
}
