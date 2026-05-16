/**
 * Settings API Adapter
 *
 * Provides API-compatible interface for settings management.
 * Converts between YAML config format and frontend API format.
 */

import { readFile, writeFile } from 'fs/promises';
import { parseDocument } from 'yaml';
import { Data, Effect } from 'effect';
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
  type TtsDaemonConfig,
} from './config-yaml.js';
import { ModelId } from './settings.js';
import type { Role } from './agents.js';
import type { RuntimeName } from './runtimes/types.js';
import { MODEL_CAPABILITIES, getModelCapability, MODEL_DEPRECATIONS, resolveModelId } from './model-capabilities.js';

/**
 * Deprecation warning in API format
 */
export interface ApiDeprecationWarning {
  workType: string;
  from: string;
  to: string;
}

export type ApiTtsConfig = Omit<TtsDaemonConfig, 'daemonPort' | 'daemonHost'>;

const API_TTS_KEYS = [
  'enabled',
  'voice',
  'statusVoice',
  'volume',
  'rate',
  'maxChars',
  'dropInfoWhenFull',
  'voiceMap',
  'mutedSources',
  'utteranceTemplates',
  'mutedIssues',
] as const satisfies readonly (keyof ApiTtsConfig)[];

const API_TTS_KEY_SET = new Set<string>(API_TTS_KEYS);

function unknownApiTtsKeys(tts: Record<string, unknown>): string[] {
  return Object.keys(tts).filter((key) => !API_TTS_KEY_SET.has(key));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function validateApiTtsConfigFields(tts: Record<string, unknown>, errors: string[]): void {
  const unknownKeys = unknownApiTtsKeys(tts);
  if (unknownKeys.length > 0) {
    errors.push(`Unknown tts setting(s): ${unknownKeys.join(', ')}`);
  }

  if (tts.enabled !== undefined && typeof tts.enabled !== 'boolean') errors.push('tts.enabled must be a boolean');
  if (tts.dropInfoWhenFull !== undefined && typeof tts.dropInfoWhenFull !== 'boolean') errors.push('tts.dropInfoWhenFull must be a boolean');
  if (tts.voice !== undefined && typeof tts.voice !== 'string') errors.push('tts.voice must be a string');
  if (tts.statusVoice !== undefined && typeof tts.statusVoice !== 'string') errors.push('tts.statusVoice must be a string');
  if (tts.volume !== undefined && (typeof tts.volume !== 'number' || tts.volume < 0 || tts.volume > 1)) {
    errors.push('tts.volume must be between 0 and 1');
  }
  if (tts.rate !== undefined && (typeof tts.rate !== 'number' || tts.rate <= 0)) {
    errors.push('tts.rate must be greater than 0');
  }
  if (tts.maxChars !== undefined && (typeof tts.maxChars !== 'number' || tts.maxChars <= 0)) {
    errors.push('tts.maxChars must be greater than 0');
  }
  if (tts.voiceMap !== undefined && !isStringRecord(tts.voiceMap)) errors.push('tts.voiceMap must be a string record');
  if (tts.utteranceTemplates !== undefined && !isStringRecord(tts.utteranceTemplates)) errors.push('tts.utteranceTemplates must be a string record');
  if (tts.mutedSources !== undefined && !isStringArray(tts.mutedSources)) errors.push('tts.mutedSources must be an array of strings');
  if (tts.mutedIssues !== undefined && !isStringArray(tts.mutedIssues)) errors.push('tts.mutedIssues must be an array of strings');
}

function sanitizeApiTtsConfig(tts: ApiTtsConfig | undefined): ApiTtsConfig | undefined {
  if (tts === undefined) return undefined;
  if (!isRecord(tts)) throw new Error('tts must be an object');

  const errors: string[] = [];
  validateApiTtsConfigFields(tts, errors);
  if (errors.length > 0) throw new Error(errors.join('; '));

  return Object.fromEntries(
    API_TTS_KEYS
      .filter((key) => tts[key] !== undefined)
      .map((key) => [key, tts[key]]),
  ) as ApiTtsConfig;
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
      nous: boolean;
    };
    /** Legacy model-route overrides are no longer surfaced by GET /api/settings. */
    overrides?: Partial<Record<string, ModelId>>;
    gemini_thinking_level?: number;
    default_conversation_model?: ModelId;
  };
  conversations?: {
    compaction_model?: ModelId;
    manual_compact_mode?: 'claude-code' | 'panopticon-native';
    rich_compaction?: boolean;
    title_model?: ModelId;
    watch_dirs?: string[];
    scan_max_parallel?: number | null;
    embeddings?: boolean;
    embedding_provider?: 'openai' | 'voyage' | 'ollama';
    embedding_model?: string;
    embedding_auto_on_deep?: boolean;
    enrichment?: {
      quick_model?: string | null;
      deep_model?: string | null;
      max_parallel?: number;
      cost_confirm_threshold?: number;
    };
  };
  memory?: {
    provider?: 'anthropic' | 'cliproxy';
    model?: string;
    per_day_cost_cap_usd?: number;
    fallback_provider?: 'anthropic' | 'cliproxy' | '';
    fallback_model?: string;
    observations_enabled?: boolean;
    prompt_time_injection_enabled?: boolean;
    rollup_pending_threshold?: number;
    sidebar_refresh_interval_ms?: number;
  };
  api_keys: {
    openai?: string;
    voyage?: string;
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
    openrouter?: string;
    nous?: string;
  };
  tts?: ApiTtsConfig;
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
  if (config.enabledProviders.has('nous')) return resolveModelId('qwen/qwen3.6-plus');
  if (config.enabledProviders.has('openrouter')) {
    const fav = config.openrouterFavorites[0];
    if (fav) return resolveModelId(fav);
  }
  return resolveModelId('claude-sonnet-4-6');
}

const ROLE_NAMES: readonly Role[] = ['plan', 'work', 'review', 'test', 'ship', 'flywheel'];
const WORKHORSE_SLOTS: readonly WorkhorseSlot[] = ['expensive', 'mid', 'cheap'];
const ALLOWED_SUB_ROLES: Partial<Record<Role, readonly string[]>> = {
  work: ['inspect', 'inspect-deep'],
  review: ['security', 'performance', 'correctness', 'requirements', 'synthesis'],
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

function toApiTtsConfig(config: ReturnType<typeof loadConfig>['config']['tts']): ApiTtsConfig {
  return {
    enabled: config.enabled,
    voice: config.voice,
    statusVoice: config.statusVoice,
    volume: config.volume,
    rate: config.rate,
    maxChars: config.maxChars,
    dropInfoWhenFull: config.dropInfoWhenFull,
    voiceMap: { ...config.voiceMap },
    mutedSources: [...config.mutedSources],
    utteranceTemplates: { ...config.utteranceTemplates },
    mutedIssues: [...config.mutedIssues],
  };
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

function validateRoleFields(fieldPath: string, roleConfig: Record<string, unknown>, errors: string[]): void {
  const harness = roleConfig.harness;
  if (harness !== undefined && harness !== 'claude-code' && harness !== 'pi') {
    errors.push(`${fieldPath}.harness must be claude-code or pi`);
  }

  const effort = roleConfig.effort;
  if (effort !== undefined && effort !== 'low' && effort !== 'medium' && effort !== 'high') {
    errors.push(`${fieldPath}.effort must be low, medium, or high`);
  }

  const maxAgents = roleConfig.maxAgents;
  if (maxAgents !== undefined && (typeof maxAgents !== 'number' || !Number.isInteger(maxAgents) || maxAgents < 1)) {
    errors.push(`${fieldPath}.maxAgents must be a positive integer`);
  }

  const scope = roleConfig.scope;
  if (scope !== undefined && scope !== 'pan-only' && scope !== 'all-tracked-projects') {
    errors.push(`${fieldPath}.scope must be pan-only or all-tracked-projects`);
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
        validateRoleFields(`roles.${role}`, rawRoleConfig, errors);

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

  // Detect deprecated models in current overrides. Overrides are no longer
  // surfaced by GET /api/settings, but warnings help users clean stale config.
  const deprecationWarnings: ApiDeprecationWarning[] = [];
  for (const [workType, modelId] of Object.entries(config.overrides)) {
    if (modelId && MODEL_DEPRECATIONS[modelId]) {
      deprecationWarnings.push({
        workType,
        from: modelId,
        to: MODEL_DEPRECATIONS[modelId],
      });
    }
  }

  const conversationSettings = pruneUndefined({
    compaction_model: config.conversations?.compactionModel,
    manual_compact_mode: config.conversations?.manualCompactMode,
    rich_compaction: config.conversations?.richCompaction,
    title_model: config.conversations?.titleModel,
    watch_dirs: config.conversations?.watchDirs,
    scan_max_parallel: config.conversations?.scanMaxParallel,
    embeddings: config.conversations?.embeddings,
    embedding_provider: config.conversations?.embeddingProvider,
    embedding_model: config.conversations?.embeddingModel,
    embedding_auto_on_deep: config.conversations?.embeddingAutoOnDeep,
    enrichment: config.conversations?.enrichment ? pruneUndefined({
      quick_model: config.conversations.enrichment.quickModel,
      deep_model: config.conversations.enrichment.deepModel,
      max_parallel: config.conversations.enrichment.maxParallel,
      cost_confirm_threshold: config.conversations.enrichment.costConfirmThreshold,
    }) : undefined,
  });

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
        nous: config.enabledProviders.has('nous'),
      },
      gemini_thinking_level: config.geminiThinkingLevel,
      default_conversation_model: getDefaultConversationModelApi(),
    },
    api_keys: config.apiKeys,
    tts: toApiTtsConfig(config.tts),
    openrouter: {
      favorites: config.openrouterFavorites,
    },
    tmux: {
      config_mode: config.tmux.configMode,
    },
    conversations: conversationSettings,
    memory: {
      provider: config.memory.extraction.provider,
      model: config.memory.extraction.model,
      per_day_cost_cap_usd: config.memory.extraction.perDayCostCapUsd,
      fallback_provider: config.memory.extraction.fallbackChain[0]?.provider ?? '',
      fallback_model: config.memory.extraction.fallbackChain[0]?.model,
      observations_enabled: config.memory.observationsEnabled,
      prompt_time_injection_enabled: config.memory.promptTimeInjectionEnabled,
      rollup_pending_threshold: config.memory.rollupPendingThreshold,
      sidebar_refresh_interval_ms: config.memory.sidebarRefreshIntervalMs,
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
    ['memory', config.memory],
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

  if (config.tts !== undefined) {
    for (const [key, value] of Object.entries(config.tts)) {
      doc.setIn(['tts', key], value);
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
        nous: settings.models.providers.nous,
      },
      gemini_thinking_level: settings.models.gemini_thinking_level as 1 | 2 | 3 | 4,
      default_conversation_model: settings.models.default_conversation_model,
    },
    api_keys: {
      openai: settings.api_keys.openai,
      voyage: settings.api_keys.voyage,
      google: settings.api_keys.google,
      minimax: settings.api_keys.minimax,
      zai: settings.api_keys.zai,
      kimi: settings.api_keys.kimi,
      mimo: settings.api_keys.mimo,
      openrouter: settings.api_keys.openrouter,
      nous: settings.api_keys.nous,
    },
    tts: sanitizeApiTtsConfig(settings.tts),
    openrouter: settings.openrouter,
    tmux: settings.tmux,
    conversations: settings.conversations,
    memory: settings.memory
      ? {
          extraction: {
            provider: settings.memory.provider || undefined,
            model: settings.memory.model || undefined,
            per_day_cost_cap_usd: settings.memory.per_day_cost_cap_usd,
            fallback_chain: settings.memory.fallback_provider && settings.memory.fallback_model
              ? [{ provider: settings.memory.fallback_provider, model: settings.memory.fallback_model }]
              : undefined,
          },
          features: {
            observations: settings.memory.observations_enabled,
            prompt_time_injection: settings.memory.prompt_time_injection_enabled,
          },
          rollup_pending_threshold: settings.memory.rollup_pending_threshold,
          sidebar_refresh_interval_ms: settings.memory.sidebar_refresh_interval_ms,
        }
      : undefined,
    tracker_keys: settings.tracker_keys,
    experimental: settings.experimental
      ? { claudeCodeChannels: settings.experimental.claudeCodeChannels }
      : undefined,
    claude: settings.claude?.permissionMode
      ? { permissionMode: settings.claude.permissionMode }
      : undefined,
  };

  await writeYamlConfigPreservingComments(yamlConfig);

  // Clear the config-yaml cache because mtime-based invalidation can miss rapid
  // writes (same-millisecond) or coarse filesystem mtime resolution.
  clearConfigCache();
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
    tts: {
      ...current.tts,
      ...sanitizeApiTtsConfig(updates.tts),
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
    memory: {
      ...current.memory,
      ...updates.memory,
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

export function getRoleConfig(role: Role): RoleConfig | undefined {
  return loadSettingsApi().roles?.[role];
}

export async function setRoleConfig(role: Role, roleConfig: RoleConfig): Promise<ApiSettingsConfig> {
  return updateSettingsApi({ roles: { [role]: roleConfig } });
}

export async function updateProviderApiKey(
  provider: 'openai' | 'voyage' | 'google' | 'minimax' | 'zai' | 'kimi' | 'mimo' | 'openrouter' | 'nous',
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

  if (settings.memory !== undefined) {
    if (settings.memory.per_day_cost_cap_usd !== undefined && settings.memory.per_day_cost_cap_usd < 0) {
      errors.push('memory.per_day_cost_cap_usd must be greater than or equal to 0');
    }
    if (settings.memory.rollup_pending_threshold !== undefined && (!Number.isInteger(settings.memory.rollup_pending_threshold) || settings.memory.rollup_pending_threshold < 1)) {
      errors.push('memory.rollup_pending_threshold must be a positive integer');
    }
    if (settings.memory.sidebar_refresh_interval_ms !== undefined && (!Number.isInteger(settings.memory.sidebar_refresh_interval_ms) || settings.memory.sidebar_refresh_interval_ms < 1)) {
      errors.push('memory.sidebar_refresh_interval_ms must be a positive integer');
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

  if (settings.tts !== undefined) {
    if (!isRecord(settings.tts)) {
      errors.push('tts must be an object');
    } else {
      validateApiTtsConfigFields(settings.tts, errors);
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
  nous: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
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
    nous: Array<{ id: ModelId; name: string; costPer1MTokens: number }>;
  } = {
    anthropic: [],
    openai: [],
    google: [],
    minimax: [],
    zai: [],
    kimi: [],
    mimo: [],
    openrouter: [],
    nous: [],
  };

  for (const [modelId, capability] of Object.entries(MODEL_CAPABILITIES)) {
    // Skip deprecated models — they should not appear in user-facing pickers.
    if (capability.displayName.includes('(deprecated)')) continue;
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
      case 'nous':
        result.nous.push(entry);
        break;
    }
  }

  // Order OpenAI models with latest family first: 5.5 (current default) → 5.4 → 5.3-codex → 5.2 → o-series → gpt-4o legacy.
  const openaiOrder: Record<string, number> = {
    'gpt-5.5': 0, 'gpt-5.5-pro': 1,
    'gpt-5.4': 10, 'gpt-5.4-pro': 11, 'gpt-5.4-mini': 12,
    'gpt-5.3-codex': 20,
    'gpt-5.2': 30,
    'o3': 40, 'o4-mini': 41,
    'gpt-4o': 50, 'gpt-4o-mini': 51,
  };
  result.openai.sort((a, b) => (openaiOrder[a.id] ?? 99) - (openaiOrder[b.id] ?? 99));

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
        nous: false,
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
        nous: false,
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants for the genuinely-async settings-api
// surfaces. Sync helpers (`loadSettingsApi`, `getRoleConfig`, validation,
// defaults) remain unwrapped — they're pure reads of an in-memory parsed
// config. Only the disk-writing helpers receive Effect variants.

/** Tagged error for settings-api Effect variants. */
export class SettingsApiError extends Data.TaggedError('SettingsApiError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `saveSettingsApi`. */
export const saveSettingsApiEffect = (
  settings: ApiSettingsConfig,
): Effect.Effect<void, SettingsApiError> =>
  Effect.tryPromise({
    try: () => saveSettingsApi(settings),
    catch: (cause) =>
      new SettingsApiError({
        operation: 'saveSettingsApi',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `updateSettingsApi`. */
export const updateSettingsApiEffect = (
  updates: Partial<ApiSettingsConfig>,
): Effect.Effect<ApiSettingsConfig, SettingsApiError> =>
  Effect.tryPromise({
    try: () => updateSettingsApi(updates),
    catch: (cause) =>
      new SettingsApiError({
        operation: 'updateSettingsApi',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `setRoleConfig`. */
export const setRoleConfigEffect = (
  role: Role,
  roleConfig: RoleConfig,
): Effect.Effect<ApiSettingsConfig, SettingsApiError> =>
  Effect.tryPromise({
    try: () => setRoleConfig(role, roleConfig),
    catch: (cause) =>
      new SettingsApiError({
        operation: 'setRoleConfig',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `updateProviderApiKey`. */
export const updateProviderApiKeyEffect = (
  ...args: Parameters<typeof updateProviderApiKey>
): Effect.Effect<Awaited<ReturnType<typeof updateProviderApiKey>>, SettingsApiError> =>
  Effect.tryPromise({
    try: () => updateProviderApiKey(...args),
    catch: (cause) =>
      new SettingsApiError({
        operation: 'updateProviderApiKey',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `saveOpenRouterFavorites`. */
export const saveOpenRouterFavoritesEffect = (
  favorites: string[],
): Effect.Effect<void, SettingsApiError> =>
  Effect.tryPromise({
    try: () => saveOpenRouterFavorites(favorites),
    catch: (cause) =>
      new SettingsApiError({
        operation: 'saveOpenRouterFavorites',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
