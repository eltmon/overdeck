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
import { MODEL_CAPABILITIES, getModelCapability } from './model-capabilities.js';

/**
 * Optimal model defaults based on research (see docs/MODEL_RECOMMENDATIONS.md)
 * - Opus 4.6: Critical thinking tasks (planning, PRDs, security review, exploration)
 * - Kimi K2.5: Implementation work agent (76.8% SWE-bench, excellent value)
 * - Sonnet 4.5: Quality specialist tasks (review responses, testing, documentation)
 * - Haiku 4.5: Speed-critical tasks (subagents, triage, quick CLI)
 */
export function getOptimalModelDefaults(): Partial<Record<WorkTypeId, ModelId>> {
  return {
    // High-complexity phases - Opus 4.6 for deep analysis
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
    'convoy:security-reviewer': 'claude-opus-4-6',   // SAFETY CRITICAL
    'convoy:performance-reviewer': 'claude-sonnet-4-6',
    'convoy:correctness-reviewer': 'claude-sonnet-4-6',
    'convoy:synthesis-agent': 'claude-sonnet-4-6',

    // Subagents - speed-optimized (Haiku 2x faster, 1/3 cost)
    'subagent:explore': 'claude-haiku-4-5',
    'subagent:plan': 'claude-haiku-4-5',
    'subagent:bash': 'claude-haiku-4-5',
    'subagent:general-purpose': 'claude-sonnet-4-6',

    // Workflow agents - Opus for PRDs, Haiku for speed tasks
    'prd-agent': 'claude-opus-4-6',
    'decomposition-agent': 'claude-haiku-4-5',
    'triage-agent': 'claude-haiku-4-5',

    // CLI modes - speed for quick, quality for interactive
    'cli:interactive': 'claude-sonnet-4-6',
    'cli:quick-command': 'claude-haiku-4-5',
  };
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
      zai: boolean;
      kimi: boolean;
    };
    overrides: Partial<Record<WorkTypeId, ModelId>>;
    gemini_thinking_level?: number;
  };
  api_keys: {
    openai?: string;
    google?: string;
    zai?: string;
    kimi?: string;
  };
  tracker_keys?: {
    linear?: string;
    github?: string;
    gitlab?: string;
    rally?: string;
  };
}

/**
 * Load settings in API format (for GET /api/settings)
 */
export function loadSettingsApi(): ApiSettingsConfig {
  const config = loadConfig();

  return {
    models: {
      providers: {
        anthropic: true, // Always enabled
        openai: config.enabledProviders.has('openai'),
        google: config.enabledProviders.has('google'),
        zai: config.enabledProviders.has('zai'),
        kimi: config.enabledProviders.has('kimi'),
      },
      overrides: config.overrides,
      gemini_thinking_level: config.geminiThinkingLevel,
    },
    api_keys: config.apiKeys,
    tracker_keys: config.trackerKeys,
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
        zai: settings.models.providers.zai,
        kimi: settings.models.providers.kimi,
      },
      overrides: settings.models.overrides,
      gemini_thinking_level: settings.models.gemini_thinking_level as 1 | 2 | 3 | 4,
    },
    api_keys: settings.api_keys,
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
 * Validate settings from API format
 */
export function validateSettingsApi(settings: ApiSettingsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate providers
  if (!settings.models?.providers) {
    errors.push('Missing providers configuration');
  } else {
    // Anthropic must always be enabled
    if (settings.models.providers.anthropic !== true) {
      errors.push('Anthropic provider must be enabled');
    }
  }

  // Validate overrides - check that model IDs are valid
  if (settings.models?.overrides) {
    const validModelIds = Object.keys(MODEL_CAPABILITIES);
    for (const [workType, modelId] of Object.entries(settings.models.overrides)) {
      if (modelId && !validModelIds.includes(modelId)) {
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
  };
}

/**
 * Get available models by provider (for model selection UI)
 */
export function getAvailableModelsApi(): {
  anthropic: Array<{ id: ModelId; name: string }>;
  openai: Array<{ id: ModelId; name: string }>;
  google: Array<{ id: ModelId; name: string }>;
  zai: Array<{ id: ModelId; name: string }>;
  kimi: Array<{ id: ModelId; name: string }>;
} {
  const result: {
    anthropic: Array<{ id: ModelId; name: string }>;
    openai: Array<{ id: ModelId; name: string }>;
    google: Array<{ id: ModelId; name: string }>;
    zai: Array<{ id: ModelId; name: string }>;
    kimi: Array<{ id: ModelId; name: string }>;
  } = {
    anthropic: [],
    openai: [],
    google: [],
    zai: [],
    kimi: [],
  };

  for (const [modelId, capability] of Object.entries(MODEL_CAPABILITIES)) {
    const entry = { id: modelId as ModelId, name: capability.displayName };
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
      case 'zai':
        result.zai.push(entry);
        break;
      case 'kimi':
        result.kimi.push(entry);
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
        zai: false,
        kimi: true, // Kimi K2.5 used for implementation work agent
      },
      overrides: getOptimalModelDefaults(),
      gemini_thinking_level: 3,
    },
    api_keys: {},
    tracker_keys: {},
  };
}
