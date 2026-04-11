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
import { MODEL_CAPABILITIES, getModelCapability, MODEL_DEPRECATIONS, resolveModelId } from './model-capabilities.js';

/**
 * Optimal model defaults based on research (see docs/MODEL_RECOMMENDATIONS.md)
 * - Opus 4.6: Critical thinking tasks (planning, PRDs, security review, exploration)
 * - Kimi K2.5: Implementation work agent (76.8% SWE-bench, excellent value)
 * - Sonnet 4.6: Quality specialist tasks (review responses, testing, documentation)
 * - Haiku 4.5: Speed-critical tasks (subagents, triage, quick CLI)
 *
 * NOTE: All model IDs are automatically resolved through deprecation mapping
 * to ensure this function never returns deprecated models.
 */
export function getOptimalModelDefaults(): Partial<Record<WorkTypeId, ModelId>> {
  const rawDefaults: Partial<Record<WorkTypeId, string>> = {
    // High-complexity phases - Opus 4.6 for deep analysis and planning
    'issue-agent:exploration': 'claude-opus-4-6',

    // Implementation phases - Kimi K2.5 for excellent coding at great value
    'issue-agent:implementation': 'kimi-k2.5',
    'issue-agent:testing': 'claude-sonnet-4-6',
    'issue-agent:documentation': 'claude-sonnet-4-6',
    'issue-agent:review-response': 'claude-sonnet-4-6',

    // Specialist agents - quality critical
    'specialist-review-agent': 'claude-opus-4-6',
    'specialist-test-agent': 'claude-sonnet-4-6',
    'specialist-merge-agent': 'claude-sonnet-4-6',

    // Convoy reviewers - mixed based on criticality
    'convoy:security-reviewer': 'claude-opus-4-6', // SAFETY CRITICAL
    'convoy:performance-reviewer': 'claude-sonnet-4-6',
    'convoy:correctness-reviewer': 'claude-sonnet-4-6',
    'convoy:synthesis-agent': 'claude-sonnet-4-6',

    // Subagents - speed-optimized (Haiku 2x faster, 1/3 cost)
    'subagent:explore': 'claude-haiku-4-5',
    'subagent:plan': 'claude-haiku-4-5',
    'subagent:bash': 'claude-haiku-4-5',
    'subagent:general-purpose': 'claude-sonnet-4-6',

    // CLI modes - speed for quick, quality for interactive
    'cli:interactive': 'claude-sonnet-4-6',
    'cli:quick-command': 'claude-haiku-4-5',
  };

  // Apply deprecation resolution to all model IDs
  const resolved: Partial<Record<WorkTypeId, ModelId>> = {};
  for (const [workType, modelId] of Object.entries(rawDefaults)) {
    resolved[workType as WorkTypeId] = resolveModelId(modelId);
  }

  return resolved;
}

/**
 * Deprecation warning in API format
 */
export interface ApiDeprecationWarning {
  workType: WorkTypeId;
  from: string;
  to: string;
}

// API format matches frontend SettingsConfig interface
// Note: No cost_sensitivity - we're opinionated and always pick the best model
// for each task. Users control cost by which providers they enable.
export interface ApiSettingsConfig {
  models: {
    providers: {
      anthropic: boolean;
      openai: boolean;
      google: boolean;
      minimax: boolean;
      kimi: boolean;
      openrouter: boolean;
    };
    overrides: Partial<Record<WorkTypeId, ModelId>>;
    gemini_thinking_level?: number;
  };
  api_keys: {
    openai?: string;
    google?: string;
    minimax?: string;
    kimi?: string;
    openrouter?: string;
  };
  openrouter?: {
    favorites?: string[];
  };
  tracker_keys?: {
    linear?: string;
    github?: string;
    gitlab?: string;
    rally?: string;
  };
  deprecation_warnings?: ApiDeprecationWarning[];
}

/**
 * Load settings in API format (for GET /api/settings)
 *
 * Also detects deprecated model IDs in current overrides and returns warnings.
 */
export function loadSettingsApi(): ApiSettingsConfig {
  const { config } = loadConfig();

  // Detect deprecated models in current overrides
  const deprecationWarnings: ApiDeprecationWarning[] = [];
  for (const [workType, modelId] of Object.entries(config.overrides)) {
    if (modelId && MODEL_DEPRECATIONS[modelId]) {
      deprecationWarnings.push({
        workType: workType as WorkTypeId,
        from: modelId,
        to: MODEL_DEPRECATIONS[modelId],
      });
    }
  }

  return {
    models: {
      providers: {
        anthropic: true, // Always enabled
        openai: config.enabledProviders.has('openai'),
        google: config.enabledProviders.has('google'),
        minimax: config.enabledProviders.has('minimax'),
        kimi: config.enabledProviders.has('kimi'),
        openrouter: config.enabledProviders.has('openrouter'),
      },
      overrides: config.overrides,
      gemini_thinking_level: config.geminiThinkingLevel,
    },
    api_keys: config.apiKeys,
    openrouter: {
      favorites: config.openrouterFavorites,
    },
    tracker_keys: config.trackerKeys,
    deprecation_warnings: deprecationWarnings.length > 0 ? deprecationWarnings : undefined,
  };
}

/**
 * Save settings from API format (for PUT /api/settings)
 */
export function saveSettingsApi(settings: ApiSettingsConfig): void {
  // Convert API format to YAML format
  const yamlConfig: YamlConfig = {
    models: {
      providers: {
        anthropic: settings.models.providers.anthropic,
        openai: settings.models.providers.openai,
        google: settings.models.providers.google,
        zai: settings.models.providers.minimax,
        kimi: settings.models.providers.kimi,
        openrouter: settings.models.providers.openrouter,
      },
      overrides: settings.models.overrides,
      gemini_thinking_level: settings.models.gemini_thinking_level as 1 | 2 | 3 | 4,
    },
    api_keys: settings.api_keys,
    openrouter: settings.openrouter,
    tracker_keys: settings.tracker_keys,
  };

  // Write to YAML file
  const yamlContent = yaml.dump(yamlConfig, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });

  writeFileSync(getGlobalConfigPath(), yamlContent, 'utf-8');
}

/**
 * Update specific settings (partial update)
 */
export function updateSettingsApi(updates: Partial<ApiSettingsConfig>): ApiSettingsConfig {
  const current = loadSettingsApi();

  // Merge updates
  const merged: ApiSettingsConfig = {
    models: {
      ...current.models,
      ...updates.models,
      providers: {
        ...current.models.providers,
        ...updates.models?.providers,
      },
      overrides: {
        ...current.models.overrides,
        ...updates.models?.overrides,
      },
    },
    api_keys: {
      ...current.api_keys,
      ...updates.api_keys,
    },
    openrouter: {
      ...current.openrouter,
      ...updates.openrouter,
    },
    tracker_keys: {
      ...current.tracker_keys,
      ...updates.tracker_keys,
    },
  };

  // Save and return
  saveSettingsApi(merged);
  return merged;
}

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate settings from API format
 *
 * Returns errors for invalid settings and warnings for deprecated model IDs.
 */
export function validateSettingsApi(settings: ApiSettingsConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate providers
  if (!settings.models?.providers) {
    errors.push('Missing providers configuration');
  } else {
    // Anthropic must always be enabled
    if (settings.models.providers.anthropic !== true) {
      errors.push('Anthropic provider must be enabled');
    }
  }

  // Validate overrides - check that model IDs are valid (including deprecated ones)
  if (settings.models?.overrides) {
    const validModelIds = Object.keys(MODEL_CAPABILITIES);
    for (const [workType, modelId] of Object.entries(settings.models.overrides)) {
      if (!modelId) continue;

      // Check if deprecated
      if (MODEL_DEPRECATIONS[modelId]) {
        warnings.push(
          `${workType}: "${modelId}" is deprecated, use "${MODEL_DEPRECATIONS[modelId]}" instead`
        );
      }
      // Check if valid (current or deprecated)
      else if (!validModelIds.includes(modelId)) {
        errors.push(`Invalid model ID "${modelId}" for work type "${workType}"`);
      }
    }
  }

  // Validate gemini thinking level
  if (settings.models?.gemini_thinking_level !== undefined) {
    const level = settings.models.gemini_thinking_level;
    if (level < 1 || level > 4) {
      errors.push('Gemini thinking level must be between 1 and 4');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get available models by provider (for model selection UI)
 */
export function getAvailableModelsApi(): {
  anthropic: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  openai: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  google: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  minimax: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  kimi: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  openrouter: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
} {
  const result: {
    anthropic: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    openai: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    google: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    minimax: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    kimi: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    openrouter: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  } = {
    anthropic: [],
    openai: [],
    google: [],
    minimax: [],
    kimi: [],
    openrouter: [],
  };

  for (const [modelId, capability] of Object.entries(MODEL_CAPABILITIES)) {
    const entry = { id: modelId as ModelId, name: capability.displayName, costPer1MTokens: capability.costPer1MTokens };
    switch (capability.provider) {
      case 'anthropic':
        result.anthropic.push(entry);
        break;
      case 'openai':
        result.openai.push(entry);
        break;
      case 'google':
        result.google.push(entry);
        break;
      case 'kimi':
        result.kimi.push(entry);
        break;
      case 'minimax':
        result.minimax.push(entry);
        break;
      case 'openrouter':
        result.openrouter.push(entry);
        break;
    }
  }

  return result;
}

/**
 * Get optimal default settings (for "Restore optimal defaults" feature)
 */
export function getOptimalDefaultsApi(): ApiSettingsConfig {
  return {
    models: {
      providers: {
        anthropic: true,
        openai: false,
        google: false,
        minimax: false,
        kimi: true, // Kimi K2.5 used for implementation work agent
        openrouter: false,
      },
      overrides: getOptimalModelDefaults(),
      gemini_thinking_level: 3,
    },
    api_keys: {},
    tracker_keys: {},
  };
}

/**
 * Save OpenRouter favorites to config.yaml
 */
export function saveOpenRouterFavorites(favorites: string[]): void {
  const current = loadSettingsApi();
  saveSettingsApi({
    ...current,
    openrouter: { ...current.openrouter, favorites },
  });
}

/**
 * Get OpenRouter favorites from config
 */
export function getOpenRouterFavorites(): string[] {
  const settings = loadSettingsApi();
  return settings.openrouter?.favorites ?? [];
}
