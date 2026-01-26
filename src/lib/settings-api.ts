/**
 * Settings API Adapter
 *
 * Provides API-compatible interface for settings management.
 * Converts between YAML config format and frontend API format.
 */

import { writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { loadConfig, getGlobalConfigPath, YamlConfig } from './config-yaml.js';
import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';

// API format matches frontend SettingsConfig interface
export interface ApiSettingsConfig {
  models: {
    preset: 'premium' | 'balanced' | 'budget';
    providers: {
      anthropic: boolean;
      openai: boolean;
      google: boolean;
      zai: boolean;
    };
    overrides: Partial<Record<WorkTypeId, ModelId>>;
    gemini_thinking_level?: number;
  };
  api_keys: {
    openai?: string;
    google?: string;
    zai?: string;
  };
}

/**
 * Load settings in API format (for GET /api/settings)
 */
export function loadSettingsApi(): ApiSettingsConfig {
  const config = loadConfig();

  return {
    models: {
      preset: config.preset,
      providers: {
        anthropic: true, // Always enabled
        openai: config.enabledProviders.has('openai'),
        google: config.enabledProviders.has('google'),
        zai: config.enabledProviders.has('zai'),
      },
      overrides: config.overrides,
      gemini_thinking_level: config.geminiThinkingLevel,
    },
    api_keys: config.apiKeys,
  };
}

/**
 * Save settings from API format (for PUT /api/settings)
 */
export function saveSettingsApi(settings: ApiSettingsConfig): void {
  // Convert API format to YAML format
  const yamlConfig: YamlConfig = {
    models: {
      preset: settings.models.preset,
      providers: {
        anthropic: settings.models.providers.anthropic,
        openai: settings.models.providers.openai,
        google: settings.models.providers.google,
        zai: settings.models.providers.zai,
      },
      overrides: settings.models.overrides,
      gemini_thinking_level: settings.models.gemini_thinking_level as 1 | 2 | 3 | 4 | undefined,
    },
    api_keys: settings.api_keys,
  };

  // Write to global config file
  const configPath = getGlobalConfigPath();
  const yamlContent = yaml.dump(yamlConfig, { indent: 2, lineWidth: 120 });
  writeFileSync(configPath, yamlContent, 'utf-8');
}

/**
 * Validate settings structure (for API validation)
 */
export function validateSettingsApi(settings: ApiSettingsConfig): string | null {
  // Validate models structure
  if (!settings.models) {
    return 'Missing models configuration';
  }

  // Validate preset
  const validPresets = ['premium', 'balanced', 'budget'];
  if (!validPresets.includes(settings.models.preset)) {
    return `Invalid preset: ${settings.models.preset}. Must be one of: ${validPresets.join(', ')}`;
  }

  // Validate providers
  if (!settings.models.providers) {
    return 'Missing providers configuration';
  }

  // Anthropic must always be enabled
  if (!settings.models.providers.anthropic) {
    return 'Anthropic provider must be enabled (required)';
  }

  // Validate Gemini thinking level if present
  if (settings.models.gemini_thinking_level !== undefined) {
    const level = settings.models.gemini_thinking_level;
    if (level < 1 || level > 4 || !Number.isInteger(level)) {
      return 'Gemini thinking level must be an integer between 1 and 4';
    }
  }

  return null;
}

/**
 * Get available models filtered by enabled providers
 */
export function getAvailableModelsApi(settings: ApiSettingsConfig): Record<string, string[]> {
  const allModels = {
    anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    openai: ['gpt-5.2-codex', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini'],
    google: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
    zai: ['glm-4.7', 'glm-4.7-flash'],
  };

  const result: Record<string, string[]> = {};

  // Only include models for enabled providers
  for (const [provider, models] of Object.entries(allModels)) {
    if (settings.models.providers[provider as keyof typeof settings.models.providers]) {
      result[provider] = models;
    }
  }

  return result;
}
