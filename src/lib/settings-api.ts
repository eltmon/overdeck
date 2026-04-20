/**
 * Settings API Adapter
 *
 * Provides API-compatible interface for settings management.
 * Converts between YAML config format and frontend API format.
 */

import { writeFile } from 'fs/promises';
import yaml from 'js-yaml';
import { loadConfig, getGlobalConfigPath, YamlConfig } from './config-yaml.js';
import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';
import { MODEL_CAPABILITIES, getModelCapability, MODEL_DEPRECATIONS, resolveModelId } from './model-capabilities.js';
import { reloadGlobalRouter } from './work-type-router.js';

/**
 * Optimal model defaults — multi-provider distribution (see docs/research/)
 * - Kimi K2.6: Exploration, testing, docs, UAT, general-purpose subagent
 * - GLM-5.1: Implementation, review-response (SWE-Bench Pro #1)
 * - GPT-5.4: Specialist review agent (high-stakes code review)
 * - MiniMax M2.7: Procedural specialists — test, merge, inspect
 * - Claude Opus/Sonnet: All parallel review agents (security, correctness, etc.)
 * - GPT-5.4 Nano/Mini: Subagents and CLI (fastest, cheapest, strong tool use)
 *
 * NOTE: All model IDs are automatically resolved through deprecation mapping
 * to ensure this function never returns deprecated models.
 */
export function getOptimalModelDefaults(): Partial<Record<WorkTypeId, ModelId>> {
  const rawDefaults: Partial<Record<WorkTypeId, string>> = {
    // Planning & high-stakes review — GPT-5.4
    'issue-agent:exploration': 'K2.6-code-preview',

    // Implementation — GLM-5.1 (SWE-Bench Pro #1, 8-hour autonomous sessions)
    'issue-agent:implementation': 'glm-5.1',
    'issue-agent:testing': 'K2.6-code-preview',
    'issue-agent:documentation': 'K2.6-code-preview',
    'issue-agent:review-response': 'glm-5.1',

    // Specialist agents
    'specialist-review-agent': 'gpt-5.4',
    'specialist-test-agent': 'minimax-m2.7',
    'specialist-merge-agent': 'minimax-m2.7',
    'specialist-inspect-agent': 'minimax-m2.7-highspeed',
    'specialist-uat-agent': 'K2.6-code-preview',

    // Review agents - mixed based on criticality
    'review:security': 'claude-opus-4-6', // SAFETY CRITICAL
    'review:performance': 'claude-sonnet-4-6',
    'review:correctness': 'claude-sonnet-4-6',
    'review:requirements': 'claude-sonnet-4-6',
    'review:synthesis': 'claude-sonnet-4-6',

    // Subagents — GPT-5.4 Nano (155 tok/s, Tau2-Bench 92.5% tool use)
    'subagent:explore': 'gpt-5.4-nano',
    'subagent:plan': 'gpt-5.4-nano',
    'subagent:bash': 'gpt-5.4-nano',
    'subagent:general-purpose': 'K2.6-code-preview',

    // Workflow jobs
    'status-review': 'gpt-5.4-nano',

    // CLI modes
    'cli:interactive': 'gpt-5.4-mini',
    'cli:quick-command': 'gpt-5.4-nano',
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
      zai: boolean;
      kimi: boolean;
      openrouter: boolean;
    };
    overrides: Partial<Record<WorkTypeId, ModelId>>;
    gemini_thinking_level?: number;
    default_conversation_model?: ModelId;
  };
  conversations?: {
    compaction_model?: ModelId;
    manual_compact_mode?: 'claude-code' | 'panopticon-native';
    rich_compaction?: boolean;
  };
  api_keys: {
    openai?: string;
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    openrouter?: string;
  };
  openrouter?: {
    favorites?: string[];
  };
  tmux?: {
    config_mode?: 'managed' | 'inherit-user';
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
export function getDefaultConversationModelApi(): ModelId {
  const { config } = loadConfig();

  if (config.defaultConversationModel) return resolveModelId(config.defaultConversationModel);

  if (config.enabledProviders.has('openai')) return resolveModelId('gpt-5.4');
  if (config.enabledProviders.has('minimax')) return resolveModelId('minimax-m2.7-highspeed');
  if (config.enabledProviders.has('google')) return resolveModelId('gemini-3.1-pro-preview');
  if (config.enabledProviders.has('kimi')) return resolveModelId('kimi-k2.5');
  if (config.enabledProviders.has('zai')) return resolveModelId('glm-5.1');
  if (config.enabledProviders.has('openrouter')) {
    const fav = config.openrouterFavorites[0];
    if (fav) return resolveModelId(fav);
  }
  return resolveModelId('claude-sonnet-4-6');
}

/** convoy:* override keys → review:* equivalents (translated on every read) */
const CONVOY_TO_REVIEW_MIGRATION: Partial<Record<string, WorkTypeId>> = {
  'convoy:security-reviewer': 'review:security',
  'convoy:performance-reviewer': 'review:performance',
  'convoy:correctness-reviewer': 'review:correctness',
  'convoy:requirements-reviewer': 'review:requirements',
  'convoy:synthesis-agent': 'review:synthesis',
};

export function loadSettingsApi(): ApiSettingsConfig {
  const { config } = loadConfig();

  // Translate persisted convoy:* override keys to review:* equivalents on every read.
  // The rename is applied in-memory; it persists to disk only when the user calls saveSettingsApi.
  const migratedOverrides: Partial<Record<WorkTypeId, ModelId>> = {};
  let migrationNeeded = false;
  for (const [workType, modelId] of Object.entries(config.overrides)) {
    const newKey = CONVOY_TO_REVIEW_MIGRATION[workType];
    if (newKey) {
      migratedOverrides[newKey] = modelId as ModelId;
      migrationNeeded = true;
    } else {
      migratedOverrides[workType as WorkTypeId] = modelId as ModelId;
    }
  }
  // Use migratedOverrides for the response without mutating the loaded config object.
  const effectiveOverrides = migrationNeeded
    ? (migratedOverrides as Record<WorkTypeId, ModelId>)
    : config.overrides;

  // Detect deprecated models in current overrides
  const deprecationWarnings: ApiDeprecationWarning[] = [];
  for (const [workType, modelId] of Object.entries(effectiveOverrides)) {
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
        anthropic: config.enabledProviders.has('anthropic'),
        openai: config.enabledProviders.has('openai'),
        google: config.enabledProviders.has('google'),
        minimax: config.enabledProviders.has('minimax'),
        zai: config.enabledProviders.has('zai'),
        kimi: config.enabledProviders.has('kimi'),
        openrouter: config.enabledProviders.has('openrouter'),
      },
      overrides: effectiveOverrides,
      gemini_thinking_level: config.geminiThinkingLevel,
      default_conversation_model: getDefaultConversationModelApi(),
    },
    api_keys: config.apiKeys,
    openrouter: {
      favorites: config.openrouterFavorites,
    },
    tmux: {
      config_mode: config.tmux.configMode,
    },
    conversations: {
      compaction_model: config.conversations.compactionModel,
      manual_compact_mode: config.conversations.manualCompactMode,
      rich_compaction: config.conversations.richCompaction,
    },
    tracker_keys: config.trackerKeys,
    deprecation_warnings: deprecationWarnings.length > 0 ? deprecationWarnings : undefined,
  };
}

/**
 * Save settings from API format (for PUT /api/settings)
 */
export async function saveSettingsApi(settings: ApiSettingsConfig): Promise<void> {
  const { config: currentConfig } = loadConfig();
  const providerAuth = currentConfig.providerAuth ?? {};
  const providerPlan = currentConfig.providerPlan ?? {};

  // Convert API format to YAML format
  const yamlConfig: YamlConfig = {
    models: {
      providers: {
        anthropic: settings.models.providers.anthropic,
        openai: providerAuth.openai || providerPlan.openai
          ? {
              enabled: settings.models.providers.openai,
              auth: providerAuth.openai,
              plan: providerPlan.openai,
            }
          : settings.models.providers.openai,
        google: providerAuth.google || providerPlan.google
          ? {
              enabled: settings.models.providers.google,
              auth: providerAuth.google,
              plan: providerPlan.google,
            }
          : settings.models.providers.google,
        minimax: settings.models.providers.minimax,
        zai: settings.models.providers.zai,
        kimi: settings.models.providers.kimi,
        openrouter: settings.models.providers.openrouter,
      },
      overrides: settings.models.overrides,
      gemini_thinking_level: settings.models.gemini_thinking_level as 1 | 2 | 3 | 4,
      default_conversation_model: settings.models.default_conversation_model,
    },
    api_keys: {
      openai: settings.api_keys.openai,
      google: settings.api_keys.google,
      minimax: settings.api_keys.minimax,
      zai: settings.api_keys.zai,
      kimi: settings.api_keys.kimi,
      openrouter: settings.api_keys.openrouter,
    },
    openrouter: settings.openrouter,
    tmux: settings.tmux,
    conversations: settings.conversations,
    tracker_keys: settings.tracker_keys,
  };

  // Write to YAML file
  const yamlContent = yaml.dump(yamlConfig, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });

  await writeFile(getGlobalConfigPath(), yamlContent, 'utf-8');

  // Reload the global work-type router so in-memory overrides reflect the
  // freshly-written config. Without this, planning-agent / specialist overrides
  // saved via PUT /api/settings don't take effect until the dashboard restarts,
  // and smart-model-selector fallback can pick an unexpected model (e.g. a
  // non-Anthropic top scorer that the runtime can't resolve).
  reloadGlobalRouter();
}

/**
 * Update specific settings (partial update)
 */
export async function updateSettingsApi(updates: Partial<ApiSettingsConfig>): Promise<ApiSettingsConfig> {
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
    tmux: {
      ...current.tmux,
      ...updates.tmux,
    },
    conversations: {
      ...current.conversations,
      ...updates.conversations,
    },
    tracker_keys: {
      ...current.tracker_keys,
      ...updates.tracker_keys,
    },
  };

  // Save and return
  await saveSettingsApi(merged);
  return merged;
}

export async function updateProviderApiKey(
  provider: 'openai' | 'google' | 'minimax' | 'zai' | 'kimi' | 'openrouter',
  apiKey?: string
): Promise<ApiSettingsConfig> {
  return updateSettingsApi({
    api_keys: {
      [provider]: apiKey,
    },
  });
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
    // At least one provider must be enabled
    const enabledCount = Object.values(settings.models.providers).filter(Boolean).length;
    if (enabledCount === 0) {
      errors.push('At least one provider must be enabled');
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
  zai: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  kimi: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  openrouter: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
} {
  const result: {
    anthropic: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    openai: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    google: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    minimax: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    zai: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    kimi: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    openrouter: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  } = {
    anthropic: [],
    openai: [],
    google: [],
    minimax: [],
    zai: [],
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
      case 'zai':
        result.zai.push(entry);
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
        zai: false,
        kimi: true, // Kimi K2.6 (K2.6-code-preview) used for exploration, testing, and documentation
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
 * MiniMax-optimized defaults: use MiniMax M2.7 for all work, Anthropic disabled
 */
export function getMiniMaxDefaultsApi(): ApiSettingsConfig {
  return {
    models: {
      providers: {
        anthropic: false,
        openai: false,
        google: false,
        zai: false,
        kimi: false,
        minimax: true,
        openrouter: false,
      },
      overrides: getMiniMaxModelDefaults(),
      gemini_thinking_level: 3,
    },
    api_keys: {},
    tracker_keys: {},
  };
}

function getMiniMaxModelDefaults(): Partial<Record<WorkTypeId, ModelId>> {
  return {
    'issue-agent:exploration': 'minimax-m2.7-highspeed',
    'issue-agent:implementation': 'minimax-m2.7-highspeed',
    'issue-agent:testing': 'minimax-m2.7-highspeed',
    'issue-agent:documentation': 'minimax-m2.7-highspeed',
    'issue-agent:review-response': 'minimax-m2.7-highspeed',
    'specialist-review-agent': 'minimax-m2.7-highspeed',
    'specialist-test-agent': 'minimax-m2.7-highspeed',
    'specialist-merge-agent': 'minimax-m2.7-highspeed',
    'specialist-inspect-agent': 'minimax-m2.7-highspeed',
    'specialist-uat-agent': 'minimax-m2.7-highspeed',
    'review:security': 'minimax-m2.7-highspeed',
    'review:performance': 'minimax-m2.7-highspeed',
    'review:correctness': 'minimax-m2.7-highspeed',
    'review:requirements': 'minimax-m2.7-highspeed',
    'review:synthesis': 'minimax-m2.7-highspeed',
    'subagent:explore': 'minimax-m2.7-highspeed',
    'subagent:plan': 'minimax-m2.7-highspeed',
    'subagent:bash': 'minimax-m2.7-highspeed',
    'subagent:general-purpose': 'minimax-m2.7-highspeed',
    'planning-agent': 'minimax-m2.7-highspeed',
    'cli:interactive': 'minimax-m2.7-highspeed',
    'cli:quick-command': 'minimax-m2.7-highspeed',
  };
}

/**
 * Save OpenRouter favorites to config.yaml
 */
export async function saveOpenRouterFavorites(favorites: string[]): Promise<void> {
  const current = loadSettingsApi();
  await saveSettingsApi({
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
