/**
 * Settings API Adapter
 *
 * Provides API-compatible interface for settings management.
 * Converts between YAML config format and frontend API format.
 */

import { readFile, writeFile } from 'fs/promises';
import { parseDocument } from 'yaml';
import {
  DEFAULT_ROLES,
  DEFAULT_WORKHORSES,
  loadConfig,
  getGlobalConfigPath,
  clearConfigCache,
  mergeConfigs,
  type YamlConfig,
  type ModelRef,
  type RoleConfig,
  type RolesConfig,
  type WorkhorsesConfig,
  type WorkhorseSlot,
} from './config-yaml.js';
import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';
import type { Role } from './agents.js';
import { MODEL_CAPABILITIES, getModelCapability, MODEL_DEPRECATIONS, resolveModelId } from './model-capabilities.js';
import { reloadGlobalRouter } from './work-type-router.js';

/**
 * Optimal model defaults — multi-provider distribution (see docs/research/)
 * - Kimi K2.6: Exploration, testing, docs, UAT, general-purpose subagent
 * - GLM-5.1: Implementation, review-response (SWE-Bench Pro #1)
 * - GPT-5.5: Specialist review agent (high-stakes code review)
 * - MiniMax M2.7: Procedural specialists — test, merge, inspect
 * - Claude Opus/Sonnet: All parallel review agents (security, correctness, etc.)
 * - GPT-5.5 Nano/Mini: Subagents and CLI (fastest, cheapest, strong tool use)
 *
 * NOTE: All model IDs are automatically resolved through deprecation mapping
 * to ensure this function never returns deprecated models.
 */
export function getOptimalModelDefaults(): Partial<Record<WorkTypeId, ModelId>> {
  const rawDefaults: Partial<Record<WorkTypeId, string>> = {
    // Planning & high-stakes review — GPT-5.5
    'issue-agent:exploration': 'kimi-k2.6',

    // Implementation — GLM-5.1 (SWE-Bench Pro #1, 8-hour autonomous sessions)
    'issue-agent:implementation': 'glm-5.1',
    'issue-agent:testing': 'kimi-k2.6',
    'issue-agent:documentation': 'kimi-k2.6',
    'issue-agent:review-response': 'glm-5.1',

    // Specialist agents
    'specialist-review-agent': 'gpt-5.5',
    'specialist-test-agent': 'minimax-m2.7',
    'specialist-merge-agent': 'minimax-m2.7',
    'specialist-inspect-agent': 'minimax-m2.7-highspeed',
    'specialist-uat-agent': 'kimi-k2.6',

    // Review agents - mixed based on criticality
    'review:security': 'claude-opus-4-6', // SAFETY CRITICAL
    'review:performance': 'claude-sonnet-4-6',
    'review:correctness': 'claude-sonnet-4-6',
    'review:requirements': 'claude-sonnet-4-6',
    'review:synthesis': 'claude-sonnet-4-6',

    // Subagents — GPT-5.5 Nano (fastest, cheapest, strong tool use)
    'subagent:explore': 'gpt-5.5-nano',
    'subagent:plan': 'gpt-5.5-nano',
    'subagent:bash': 'gpt-5.5-nano',
    'subagent:general-purpose': 'kimi-k2.6',

    // Workflow jobs
    'status-review': 'gpt-5.5-nano',

    // CLI modes
    'cli:interactive': 'gpt-5.5-mini',
    'cli:quick-command': 'gpt-5.5-nano',
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
  workhorses?: WorkhorsesConfig;
  roles?: RolesConfig;
  models: {
    providers: {
      anthropic: boolean;
      openai: boolean;
      google: boolean;
      minimax: boolean;
      zai: boolean;
      kimi: boolean;
      mimo: boolean;
      openrouter: boolean;
    };
    /** Legacy WorkTypeId overrides are no longer surfaced by GET /api/settings. */
    overrides?: Partial<Record<WorkTypeId, ModelId>>;
    gemini_thinking_level?: number;
    default_conversation_model?: ModelId;
  };
  conversations?: {
    compaction_model?: ModelId;
    manual_compact_mode?: 'claude-code' | 'panopticon-native';
    rich_compaction?: boolean;
    title_model?: ModelId;
  };
  api_keys: {
    openai?: string;
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
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
  experimental?: {
    /** Use Claude Code Channels for prompt delivery to eligible work agents. */
    claudeCodeChannels?: boolean;
  };
  /**
   * Permission mode for spawned Claude Code agents.
   *
   * 'auto' (default) → --permission-mode auto (classifier blocks destructive ops)
   * 'bypass'         → --dangerously-skip-permissions --permission-mode bypassPermissions
   *
   * Persisted under `claude.permissionMode` in `~/.panopticon/config.yaml`.
   * Override per-invocation with `--yolo` / `--no-yolo` / `PAN_YOLO`.
   */
  claude?: {
    permissionMode?: 'auto' | 'bypass';
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

  if (config.enabledProviders.has('openai')) return resolveModelId('gpt-5.5');
  if (config.enabledProviders.has('minimax')) return resolveModelId('minimax-m2.7-highspeed');
  if (config.enabledProviders.has('google')) return resolveModelId('gemini-3.1-pro-preview');
  if (config.enabledProviders.has('kimi')) return resolveModelId('kimi-k2.5');
  if (config.enabledProviders.has('zai')) return resolveModelId('glm-5.1');
  if (config.enabledProviders.has('mimo')) return resolveModelId('mimo-v2.5-pro');
  if (config.enabledProviders.has('openrouter')) {
    const fav = config.openrouterFavorites[0];
    if (fav) return resolveModelId(fav);
  }
  return resolveModelId('claude-sonnet-4-6');
}

const CONVOY_TO_REVIEW_MAP: Record<string, string> = {
  'convoy:security-reviewer': 'review:security',
  'convoy:performance-reviewer': 'review:performance',
  'convoy:correctness-reviewer': 'review:correctness',
  'convoy:requirements-reviewer': 'review:requirements',
  'convoy:synthesis-agent': 'review:synthesis',
};

const ROLE_NAMES: readonly Role[] = ['plan', 'work', 'review', 'test', 'ship'];
const WORKHORSE_SLOTS: readonly WorkhorseSlot[] = ['expensive', 'mid', 'cheap'];
const ALLOWED_SUB_ROLES: Partial<Record<Role, readonly string[]>> = {
  work: ['inspect', 'inspect-deep'],
  review: ['security', 'performance', 'correctness', 'requirements'],
};
function seededWorkhorses(config: Pick<ReturnType<typeof loadConfig>['config'], 'workhorses'>): WorkhorsesConfig {
  return { ...DEFAULT_WORKHORSES, ...(config.workhorses ?? {}) };
}

function seededRoles(config: Pick<ReturnType<typeof loadConfig>['config'], 'roles'>): RolesConfig {
  const roles: RolesConfig = {};
  for (const role of ROLE_NAMES) {
    const defaultRole = DEFAULT_ROLES[role];
    const configuredRole = config.roles?.[role];
    const sub = {
      ...(defaultRole.sub ?? {}),
      ...(configuredRole?.sub ?? {}),
    };
    roles[role] = {
      ...defaultRole,
      ...(configuredRole ?? {}),
      sub: Object.keys(sub).length > 0 ? sub : undefined,
    };
  }
  return roles;
}

function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => pruneUndefined(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, pruneUndefined(entry)]),
    ) as T;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkhorseRef(ref: string): boolean {
  return ref.startsWith('workhorse:');
}

function workhorseSlotFromRef(ref: string): string {
  return ref.slice('workhorse:'.length);
}

function mergeRoles(current?: RolesConfig, updates?: RolesConfig): RolesConfig | undefined {
  if (!current && !updates) return undefined;
  const merged: RolesConfig = { ...(current ?? {}) };
  for (const [role, roleConfig] of Object.entries(updates ?? {}) as Array<[Role, RoleConfig]>) {
    merged[role] = {
      ...(merged[role] ?? {}),
      ...roleConfig,
      sub: roleConfig.sub
        ? {
            ...(merged[role]?.sub ?? {}),
            ...roleConfig.sub,
          }
        : merged[role]?.sub,
    };
  }
  return merged;
}

function validateModelRef(
  fieldPath: string,
  ref: unknown,
  effectiveWorkhorses: WorkhorsesConfig,
  errors: string[],
  warnings: string[],
  allowWorkhorseRef: boolean,
): void {
  if (typeof ref !== 'string' || ref.trim() === '') {
    errors.push(`${fieldPath} must be a non-empty model reference`);
    return;
  }

  if (isWorkhorseRef(ref)) {
    if (!allowWorkhorseRef) {
      errors.push(`${fieldPath} cannot reference another workhorse`);
      return;
    }
    const slot = workhorseSlotFromRef(ref);
    if (!WORKHORSE_SLOTS.includes(slot as WorkhorseSlot)) {
      errors.push(`${fieldPath} references unknown workhorse slot "${slot}"`);
      return;
    }
    if (!effectiveWorkhorses[slot as WorkhorseSlot]) {
      errors.push(`${fieldPath} references ${ref} but workhorses.${slot} is not defined`);
    }
    return;
  }

  if (MODEL_DEPRECATIONS[ref]) {
    warnings.push(`${fieldPath}: "${ref}" is deprecated, use "${MODEL_DEPRECATIONS[ref]}" instead`);
    return;
  }

  const resolved = resolveModelId(ref);
  if (!MODEL_CAPABILITIES[resolved]) {
    errors.push(`Invalid model reference "${ref}" at ${fieldPath}`);
  }
}

function validateWorkhorsesAndRoles(settings: ApiSettingsConfig, errors: string[], warnings: string[]): void {
  const effectiveWorkhorses: WorkhorsesConfig = { ...DEFAULT_WORKHORSES };

  if (settings.workhorses !== undefined) {
    if (!isRecord(settings.workhorses)) {
      errors.push('workhorses must be an object');
    } else {
      for (const [slot, ref] of Object.entries(settings.workhorses)) {
        if (!WORKHORSE_SLOTS.includes(slot as WorkhorseSlot)) {
          errors.push(`Unknown workhorse slot "${slot}"`);
          continue;
        }
        effectiveWorkhorses[slot as WorkhorseSlot] = ref as ModelRef;
        validateModelRef(`workhorses.${slot}`, ref, effectiveWorkhorses, errors, warnings, false);
      }
    }
  }

  if (settings.roles !== undefined) {
    if (!isRecord(settings.roles)) {
      errors.push('roles must be an object');
    } else {
      for (const [roleName, rawRoleConfig] of Object.entries(settings.roles)) {
        if (!ROLE_NAMES.includes(roleName as Role)) {
          errors.push(`Unknown role "${roleName}"`);
          continue;
        }
        const role = roleName as Role;
        if (!isRecord(rawRoleConfig)) {
          errors.push(`roles.${role}.model must be a non-empty model reference`);
          continue;
        }

        validateModelRef(`roles.${role}.model`, rawRoleConfig.model, effectiveWorkhorses, errors, warnings, true);

        if (rawRoleConfig.sub !== undefined) {
          if (!isRecord(rawRoleConfig.sub)) {
            errors.push(`roles.${role}.sub must be an object`);
          } else {
            const allowedSubRoles = ALLOWED_SUB_ROLES[role] ?? [];
            for (const [subRole, rawSubConfig] of Object.entries(rawRoleConfig.sub)) {
              if (!allowedSubRoles.includes(subRole)) {
                errors.push(`Unknown sub-role "${subRole}" for role "${role}"`);
                continue;
              }
              if (!isRecord(rawSubConfig)) {
                errors.push(`roles.${role}.sub.${subRole}.model must be a non-empty model reference`);
                continue;
              }
              validateModelRef(
                `roles.${role}.sub.${subRole}.model`,
                rawSubConfig.model,
                effectiveWorkhorses,
                errors,
                warnings,
                true,
              );
            }
          }
        }
      }
    }
  }

  if (errors.length === 0) {
    try {
      mergeConfigs({ workhorses: effectiveWorkhorses, roles: settings.roles });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

export function loadSettingsApi(): ApiSettingsConfig {
  const { config } = loadConfig();

  // Migrate convoy:* override keys to review:* equivalents (PAN-540)
  // Iterate convoy map first so convoy values win when both old+new keys exist,
  // matching original semantics.
  const migratedOverrides: Record<string, string> = { ...config.overrides };
  for (const [oldKey, newKey] of Object.entries(CONVOY_TO_REVIEW_MAP)) {
    if (oldKey in migratedOverrides) {
      migratedOverrides[newKey] = migratedOverrides[oldKey]!;
      delete migratedOverrides[oldKey];
    }
  }

  // Detect deprecated models in current overrides
  const deprecationWarnings: ApiDeprecationWarning[] = [];
  for (const [workType, modelId] of Object.entries(migratedOverrides)) {
    if (modelId && MODEL_DEPRECATIONS[modelId]) {
      deprecationWarnings.push({
        workType: workType as WorkTypeId,
        from: modelId,
        to: MODEL_DEPRECATIONS[modelId],
      });
    }
  }

  return {
    workhorses: seededWorkhorses(config),
    roles: seededRoles(config),
    models: {
      providers: {
        anthropic: config.enabledProviders.has('anthropic'),
        openai: config.enabledProviders.has('openai'),
        google: config.enabledProviders.has('google'),
        minimax: config.enabledProviders.has('minimax'),
        zai: config.enabledProviders.has('zai'),
        kimi: config.enabledProviders.has('kimi'),
        mimo: config.enabledProviders.has('mimo'),
        openrouter: config.enabledProviders.has('openrouter'),
      },
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
      title_model: config.conversations.titleModel,
    },
    tracker_keys: config.trackerKeys,
    experimental: {
      claudeCodeChannels: config.experimental?.claudeCodeChannels ?? false,
    },
    claude: {
      // Defensive — older test mocks of loadConfig may not include `claude`;
      // production loader always populates it via DEFAULT_CONFIG.
      permissionMode: config.claude?.permissionMode ?? 'auto',
    },
    deprecation_warnings: deprecationWarnings.length > 0 ? deprecationWarnings : undefined,
  };
}

async function writeYamlConfigPreservingComments(yamlConfig: YamlConfig): Promise<void> {
  const configPath = getGlobalConfigPath();
  let existingContent = '{}\n';
  try {
    const content = await readFile(configPath, 'utf-8');
    existingContent = content.trim().length > 0 ? content : '{}\n';
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const doc = parseDocument(existingContent);
  if (doc.contents === null) {
    doc.contents = parseDocument('{}\n').contents;
  }
  const config = pruneUndefined(yamlConfig);

  doc.setIn(['workhorses'], config.workhorses ?? {});
  doc.setIn(['roles'], config.roles ?? {});
  doc.setIn(['models', 'providers'], config.models?.providers ?? {});
  doc.deleteIn(['models', 'overrides']);

  if (config.models?.gemini_thinking_level !== undefined) {
    doc.setIn(['models', 'gemini_thinking_level'], config.models.gemini_thinking_level);
  } else {
    doc.deleteIn(['models', 'gemini_thinking_level']);
  }

  if (config.models?.default_conversation_model !== undefined) {
    doc.setIn(['models', 'default_conversation_model'], config.models.default_conversation_model);
  } else {
    doc.deleteIn(['models', 'default_conversation_model']);
  }

  const topLevelSections: Array<[keyof YamlConfig, unknown]> = [
    ['api_keys', config.api_keys],
    ['openrouter', config.openrouter],
    ['tmux', config.tmux],
    ['conversations', config.conversations],
    ['tracker_keys', config.tracker_keys],
    ['experimental', config.experimental],
    ['claude', config.claude],
  ];

  for (const [key, value] of topLevelSections) {
    if (value === undefined) {
      doc.deleteIn([key]);
    } else {
      doc.setIn([key], value);
    }
  }

  await writeFile(configPath, doc.toString({ lineWidth: 120 }), 'utf-8');
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
    workhorses: settings.workhorses,
    roles: settings.roles,
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
        mimo: settings.models.providers.mimo,
        openrouter: settings.models.providers.openrouter,
      },
      gemini_thinking_level: settings.models.gemini_thinking_level as 1 | 2 | 3 | 4,
      default_conversation_model: settings.models.default_conversation_model,
    },
    api_keys: {
      openai: settings.api_keys.openai,
      google: settings.api_keys.google,
      minimax: settings.api_keys.minimax,
      zai: settings.api_keys.zai,
      kimi: settings.api_keys.kimi,
      mimo: settings.api_keys.mimo,
      openrouter: settings.api_keys.openrouter,
    },
    openrouter: settings.openrouter,
    tmux: settings.tmux,
    conversations: settings.conversations,
    tracker_keys: settings.tracker_keys,
    experimental: settings.experimental
      ? { claudeCodeChannels: settings.experimental.claudeCodeChannels }
      : undefined,
    claude: settings.claude?.permissionMode
      ? { permissionMode: settings.claude.permissionMode }
      : undefined,
  };

  await writeYamlConfigPreservingComments(yamlConfig);

  // Reload the global work-type router so in-memory overrides reflect the
  // freshly-written config. Without this, planning-agent / specialist overrides
  // saved via PUT /api/settings don't take effect until the dashboard restarts,
  // and smart-model-selector fallback can pick an unexpected model (e.g. a
  // non-Anthropic top scorer that the runtime can't resolve).
  //
  // We also clear the config-yaml cache because mtime-based invalidation can
  // miss rapid writes (same-millisecond) or coarse filesystem mtime resolution.
  clearConfigCache();
  reloadGlobalRouter();
}

/**
 * Update specific settings (partial update)
 */
export async function updateSettingsApi(updates: Partial<ApiSettingsConfig>): Promise<ApiSettingsConfig> {
  const current = loadSettingsApi();

  // Merge updates
  const merged: ApiSettingsConfig = {
    workhorses: {
      ...current.workhorses,
      ...updates.workhorses,
    },
    roles: mergeRoles(current.roles, updates.roles),
    models: {
      ...current.models,
      ...updates.models,
      providers: {
        ...current.models.providers,
        ...updates.models?.providers,
      },
      overrides: undefined,
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
    experimental: {
      ...current.experimental,
      ...updates.experimental,
    },
    claude: {
      ...current.claude,
      ...updates.claude,
    },
  };

  // Save and return
  await saveSettingsApi(merged);
  return merged;
}

export async function updateProviderApiKey(
  provider: 'openai' | 'google' | 'minimax' | 'zai' | 'kimi' | 'mimo' | 'openrouter',
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

  validateWorkhorsesAndRoles(settings, errors, warnings);

  // Validate gemini thinking level
  if (settings.models?.gemini_thinking_level !== undefined) {
    const level = settings.models.gemini_thinking_level;
    if (level < 1 || level > 4) {
      errors.push('Gemini thinking level must be between 1 and 4');
    }
  }

  // Validate experimental flags — every flag must be a boolean if present.
  if (settings.experimental !== undefined) {
    if (typeof settings.experimental !== 'object' || settings.experimental === null) {
      errors.push('experimental must be an object');
    } else {
      const ccc = (settings.experimental as { claudeCodeChannels?: unknown }).claudeCodeChannels;
      if (ccc !== undefined && typeof ccc !== 'boolean') {
        errors.push('experimental.claudeCodeChannels must be a boolean');
      }
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
  mimo: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  openrouter: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
} {
  const result: {
    anthropic: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    openai: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    google: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    minimax: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    zai: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    kimi: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    mimo: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
    openrouter: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  } = {
    anthropic: [],
    openai: [],
    google: [],
    minimax: [],
    zai: [],
    kimi: [],
    mimo: [],
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
      case 'mimo':
        result.mimo.push(entry);
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
    workhorses: { ...DEFAULT_WORKHORSES },
    roles: seededRoles({ roles: undefined }),
    models: {
      providers: {
        anthropic: true,
        openai: false,
        google: false,
        minimax: false,
        zai: false,
        kimi: true, // Kimi K2.6 (K2.6-code-preview) used for exploration, testing, and documentation
        mimo: false,
        openrouter: false,
      },
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
    workhorses: {
      expensive: 'minimax-m2.7-highspeed',
      mid: 'minimax-m2.7-highspeed',
      cheap: 'minimax-m2.7-highspeed',
    },
    roles: seededRoles({ roles: undefined }),
    models: {
      providers: {
        anthropic: false,
        openai: false,
        google: false,
        zai: false,
        kimi: false,
        minimax: true,
        mimo: false,
        openrouter: false,
      },
      gemini_thinking_level: 3,
    },
    api_keys: {},
    tracker_keys: {},
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
