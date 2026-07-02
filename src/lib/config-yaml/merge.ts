import type { AuthMode, SubscriptionPlan } from '../subscription-types.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { ModelProvider } from '../model-fallback.js';
import { resolveModelIdSync } from '../model-capabilities.js';
import type { ModelId } from '../settings.js';
import { BACKGROUND_AI_FEATURES } from '../background-ai/registry.js';
import { mergeTieredExecutionConfig, validateTieredExecutionConfig } from '../agents/tier-table.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { cloneRoles, DEFAULT_MODEL_REFS, DEFAULT_ROLES, DEFAULT_WORKHORSES, mergeRoleConfig, validateRoleModelRefs } from './roles.js';
import {
  cloneDocsConfig,
  isComplianceMode,
  isFeatureRegistryClassificationProvider,
  mergeCavemanConfig,
  mergeDocsConfig,
  mergeRemoteConfig,
  mergeRtkConfig,
  mergeShadowConfig,
  mergeTldrConfig,
  mergeTtsConfig,
} from './domain-mergers.js';
import {
  COMPLIANCE_MODES,
  type NormalizedConfig,
  type ProviderConfig,
  type YamlConfig,
} from './schema.js';

/**
 * Normalize a provider config (handle both boolean and object forms)
 */
function normalizeProviderConfig(
  providerConfig: ProviderConfig | boolean | undefined,
  fallbackKey?: string
): { enabled: boolean; api_key?: string; auth?: AuthMode; plan?: SubscriptionPlan; harness?: RuntimeName } {
  if (providerConfig === undefined) {
    return { enabled: false };
  }

  if (typeof providerConfig === 'boolean') {
    return { enabled: providerConfig, api_key: fallbackKey };
  }

  return {
    enabled: providerConfig.enabled,
    api_key: providerConfig.api_key || fallbackKey,
    harness: providerConfig.harness,
    auth: providerConfig.auth,
    plan: providerConfig.plan,
  };
}

function validateProviderHarness(provider: ModelProvider, harness: RuntimeName | undefined): void {
  if (harness !== undefined && harness !== 'claude-code' && harness !== 'ohmypi' && harness !== 'codex') {
    throw new Error(`config.yaml: models.providers.${provider}.harness must be claude-code, ohmypi, or codex`);
  }
}

function applyProviderHarness(result: NormalizedConfig, provider: ModelProvider, harness: RuntimeName | undefined): void {
  validateProviderHarness(provider, harness);
  if (harness !== undefined) {
    result.providerHarnesses[provider] = harness;
  }
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
 * Merge multiple configs with precedence: project > global > defaults
 */
export function mergeConfigs(...configs: (YamlConfig | null)[]): { config: NormalizedConfig; explicitlyDisabled: Set<ModelProvider> } {
  const result: NormalizedConfig = {
    ...DEFAULT_CONFIG,
    tmux: {
      ...DEFAULT_CONFIG.tmux,
    },
    enabledProviders: new Set(DEFAULT_CONFIG.enabledProviders),
    providerHarnesses: { ...DEFAULT_CONFIG.providerHarnesses },
    workhorses: { ...DEFAULT_WORKHORSES },
    roles: cloneRoles(DEFAULT_ROLES),
    tieredExecution: {
      enabled: DEFAULT_CONFIG.tieredExecution.enabled,
      tiers: { ...DEFAULT_CONFIG.tieredExecution.tiers },
      supervisor: DEFAULT_CONFIG.tieredExecution.supervisor,
      replay_threshold: DEFAULT_CONFIG.tieredExecution.replay_threshold,
    },
    memory: {
      extraction: {
        ...DEFAULT_CONFIG.memory.extraction,
        fallbackChain: [...DEFAULT_CONFIG.memory.extraction.fallbackChain],
      },
      observationsEnabled: DEFAULT_CONFIG.memory.observationsEnabled,
      promptTimeInjectionEnabled: DEFAULT_CONFIG.memory.promptTimeInjectionEnabled,
      rollupPendingThreshold: DEFAULT_CONFIG.memory.rollupPendingThreshold,
      sidebarRefreshIntervalMs: DEFAULT_CONFIG.memory.sidebarRefreshIntervalMs,
      workerConcurrency: DEFAULT_CONFIG.memory.workerConcurrency,
    },
    backgroundAi: {
      cheapMode: DEFAULT_CONFIG.backgroundAi.cheapMode,
      features: { ...DEFAULT_CONFIG.backgroundAi.features },
    },
    compliance: {
      mode: DEFAULT_CONFIG.compliance.mode,
    },
    registry: {
      classification: { ...DEFAULT_CONFIG.registry.classification },
    },
    shadow: {
      enabled: DEFAULT_CONFIG.shadow.enabled,
      trackers: { ...DEFAULT_CONFIG.shadow.trackers },
    },
    caveman: {
      enabled: DEFAULT_CONFIG.caveman.enabled,
      abTest: DEFAULT_CONFIG.caveman.abTest,
      modes: { ...DEFAULT_CONFIG.caveman.modes },
    },
    rtk: {
      enabled: DEFAULT_CONFIG.rtk.enabled,
    },
    docs: cloneDocsConfig(DEFAULT_CONFIG.docs),
    conversationSearch: { ...DEFAULT_CONFIG.conversationSearch },
    tts: {
      enabled: DEFAULT_CONFIG.tts.enabled,
      lifecycle: DEFAULT_CONFIG.tts.lifecycle,
      voice: DEFAULT_CONFIG.tts.voice,
      volume: DEFAULT_CONFIG.tts.volume,
      rate: DEFAULT_CONFIG.tts.rate,
      maxChars: DEFAULT_CONFIG.tts.maxChars,
      dropInfoWhenFull: DEFAULT_CONFIG.tts.dropInfoWhenFull,
      daemonPort: DEFAULT_CONFIG.tts.daemonPort,
      daemonHost: DEFAULT_CONFIG.tts.daemonHost,
      daemonAutoStart: DEFAULT_CONFIG.tts.daemonAutoStart,
      voiceMap: { ...DEFAULT_CONFIG.tts.voiceMap },
      mutedSources: [...DEFAULT_CONFIG.tts.mutedSources],
      utteranceTemplates: { ...DEFAULT_CONFIG.tts.utteranceTemplates },
      mutedIssues: [...DEFAULT_CONFIG.tts.mutedIssues],
    },
    ttsSummarizer: {
      enabled: DEFAULT_CONFIG.ttsSummarizer.enabled,
      model: DEFAULT_CONFIG.ttsSummarizer.model,
      batchWindowSeconds: DEFAULT_CONFIG.ttsSummarizer.batchWindowSeconds,
    },
    resources: {
      memoryWarnGb: DEFAULT_CONFIG.resources.memoryWarnGb,
      memoryBlockGb: DEFAULT_CONFIG.resources.memoryBlockGb,
      agentWarnCount: DEFAULT_CONFIG.resources.agentWarnCount,
      agentBlockCount: DEFAULT_CONFIG.resources.agentBlockCount,
    },
    experimental: {
      experimentalFeatures: DEFAULT_CONFIG.experimental.experimentalFeatures,
      claudeCodeChannels: DEFAULT_CONFIG.experimental.claudeCodeChannels,
      claudeCodeChannelsMcp: DEFAULT_CONFIG.experimental.claudeCodeChannelsMcp,
      streamdownRenderer: DEFAULT_CONFIG.experimental.streamdownRenderer,
      showHarnessModelPermutations: DEFAULT_CONFIG.experimental.showHarnessModelPermutations,
    },
    claude: {
      permissionMode: DEFAULT_CONFIG.claude.permissionMode,
    },
    codex: {
      permissionMode: DEFAULT_CONFIG.codex.permissionMode,
    },
  };

  // Track providers explicitly disabled in models.providers so that legacy
  // api_keys and env var fallbacks don't re-enable them.
  const explicitlyDisabled = new Set<ModelProvider>();

  // Filter out null configs
  const validConfigs = configs.filter((c): c is YamlConfig => c !== null);

  // Merge in reverse order (lowest precedence first)
  for (const config of validConfigs.reverse()) {
    // Merge providers
    if (config.models?.providers) {
      const providers = config.models.providers;
      const legacyKeys = config.api_keys || {};

      // Anthropic
      const anthropic = normalizeProviderConfig(providers.anthropic, undefined);
      applyProviderHarness(result, 'anthropic', anthropic.harness);
      if (anthropic.enabled) {
        result.enabledProviders.add('anthropic');
        if (anthropic.auth) result.providerAuth.anthropic = anthropic.auth;
        if (anthropic.plan) result.providerPlan.anthropic = anthropic.plan;
      } else if (providers.anthropic !== undefined) {
        explicitlyDisabled.add('anthropic');
        result.enabledProviders.delete('anthropic');
      }

      // OpenAI
      const openai = normalizeProviderConfig(providers.openai, legacyKeys.openai);
      applyProviderHarness(result, 'openai', openai.harness);
      if (openai.enabled) {
        result.enabledProviders.add('openai');
        if (openai.api_key) {
          result.apiKeys.openai = resolveEnvVar(openai.api_key);
        }
        if (openai.auth) result.providerAuth.openai = openai.auth;
        if (openai.plan) result.providerPlan.openai = openai.plan;
      } else if (providers.openai !== undefined) {
        explicitlyDisabled.add('openai');
      }

      // Google
      const google = normalizeProviderConfig(providers.google, legacyKeys.google);
      applyProviderHarness(result, 'google', google.harness);
      if (google.enabled) {
        result.enabledProviders.add('google');
        if (google.api_key) {
          result.apiKeys.google = resolveEnvVar(google.api_key);
        }
        if (google.auth) result.providerAuth.google = google.auth;
        if (google.plan) result.providerPlan.google = google.plan;
      } else if (providers.google !== undefined) {
        explicitlyDisabled.add('google');
      }

      // MiniMax
      const minimax = normalizeProviderConfig(providers.minimax, legacyKeys.minimax);
      applyProviderHarness(result, 'minimax', minimax.harness);
      if (minimax.enabled) {
        result.enabledProviders.add('minimax');
        if (minimax.api_key) {
          result.apiKeys.minimax = resolveEnvVar(minimax.api_key);
        }
      } else if (providers.minimax !== undefined) {
        explicitlyDisabled.add('minimax');
      }

      // Z.AI
      const zai = normalizeProviderConfig(providers.zai, legacyKeys.zai);
      applyProviderHarness(result, 'zai', zai.harness);
      if (zai.enabled) {
        result.enabledProviders.add('zai');
        if (zai.api_key) {
          result.apiKeys.zai = resolveEnvVar(zai.api_key);
        }
      } else if (providers.zai !== undefined) {
        explicitlyDisabled.add('zai');
      }

      // Kimi
      const kimi = normalizeProviderConfig(providers.kimi, legacyKeys.kimi);
      applyProviderHarness(result, 'kimi', kimi.harness);
      if (kimi.enabled) {
        result.enabledProviders.add('kimi');
        if (kimi.api_key) {
          result.apiKeys.kimi = resolveEnvVar(kimi.api_key);
        }
      } else if (providers.kimi !== undefined) {
        explicitlyDisabled.add('kimi');
      }

      // OpenRouter
      const openrouter = normalizeProviderConfig(providers.openrouter, legacyKeys.openrouter);
      applyProviderHarness(result, 'openrouter', openrouter.harness);
      if (openrouter.enabled) {
        result.enabledProviders.add('openrouter');
        if (openrouter.api_key) {
          result.apiKeys.openrouter = resolveEnvVar(openrouter.api_key);
        }
      } else if (providers.openrouter !== undefined) {
        explicitlyDisabled.add('openrouter');
      }

      // MiMo
      const mimo = normalizeProviderConfig(providers.mimo, legacyKeys.mimo);
      applyProviderHarness(result, 'mimo', mimo.harness);
      if (mimo.enabled) {
        result.enabledProviders.add('mimo');
        if (mimo.api_key) {
          result.apiKeys.mimo = resolveEnvVar(mimo.api_key);
        }
      } else if (providers.mimo !== undefined) {
        explicitlyDisabled.add('mimo');
      }

      // Nous Portal
      const nous = normalizeProviderConfig(providers.nous, legacyKeys.nous);
      applyProviderHarness(result, 'nous', nous.harness);
      if (nous.enabled) {
        result.enabledProviders.add('nous');
        if (nous.api_key) {
          result.apiKeys.nous = resolveEnvVar(nous.api_key);
        }
      } else if (providers.nous !== undefined) {
        explicitlyDisabled.add('nous');
      }

      // Alibaba DashScope
      const dashscope = normalizeProviderConfig(providers.dashscope, legacyKeys.dashscope);
      applyProviderHarness(result, 'dashscope', dashscope.harness);
      if (dashscope.enabled) {
        result.enabledProviders.add('dashscope');
        if (dashscope.api_key) {
          result.apiKeys.dashscope = resolveEnvVar(dashscope.api_key);
        }
      } else if (providers.dashscope !== undefined) {
        explicitlyDisabled.add('dashscope');
      }
    }

    // Merge tmux configuration
    if (config.tmux?.config_mode) {
      result.tmux.configMode = config.tmux.config_mode;
    }

    // Merge conversation configuration
    if (config.conversations?.compaction_model) {
      result.conversations.compactionModel = resolveModelIdSync(config.conversations.compaction_model);
    }
    if (config.conversations?.manual_compact_mode) {
      result.conversations.manualCompactMode = config.conversations.manual_compact_mode;
    }
    if (config.conversations?.rich_compaction !== undefined) {
      result.conversations.richCompaction = config.conversations.rich_compaction;
    }
    if (config.conversations?.title_model) {
      result.conversations.titleModel = resolveModelIdSync(config.conversations.title_model);
    }
    if (config.conversations?.watch_dirs) {
      result.conversations.watchDirs = config.conversations.watch_dirs;
    }
    if (config.conversations?.scan_max_parallel !== undefined) {
      result.conversations.scanMaxParallel = config.conversations.scan_max_parallel;
    }
    if (config.conversations?.embeddings !== undefined) {
      result.conversations.embeddings = config.conversations.embeddings;
    }
    if (config.conversations?.embedding_provider) {
      result.conversations.embeddingProvider = config.conversations.embedding_provider;
      if (config.conversations.embedding_provider === 'ollama' && !config.conversations.embedding_model) {
        result.conversations.embeddingModel = 'nomic-embed-text';
      }
    }
    if (config.conversations?.embedding_model) {
      result.conversations.embeddingModel = config.conversations.embedding_model;
    }
    if (config.conversations?.embedding_auto_on_deep !== undefined) {
      result.conversations.embeddingAutoOnDeep = config.conversations.embedding_auto_on_deep;
    }
    if (config.conversations?.enrichment?.quick_model !== undefined) {
      result.conversations.enrichment.quickModel = config.conversations.enrichment.quick_model;
    }
    if (config.conversations?.enrichment?.deep_model !== undefined) {
      result.conversations.enrichment.deepModel = config.conversations.enrichment.deep_model;
    }
    if (config.conversations?.enrichment?.max_parallel !== undefined) {
      result.conversations.enrichment.maxParallel = config.conversations.enrichment.max_parallel;
    }
    if (config.conversations?.enrichment?.cost_confirm_threshold !== undefined) {
      result.conversations.enrichment.costConfirmThreshold = config.conversations.enrichment.cost_confirm_threshold;
    }

    if (config.memory) {
      if (config.memory.extraction) {
        result.memory.extraction = {
          ...result.memory.extraction,
          ...(config.memory.extraction.provider !== undefined ? { provider: config.memory.extraction.provider } : {}),
          ...(config.memory.extraction.model !== undefined ? { model: config.memory.extraction.model } : {}),
          ...(config.memory.extraction.per_day_cost_cap_usd !== undefined ? { perDayCostCapUsd: config.memory.extraction.per_day_cost_cap_usd } : {}),
          ...(config.memory.extraction.fallback_chain !== undefined ? { fallbackChain: config.memory.extraction.fallback_chain } : {}),
        };
      }
      if (config.memory.features?.observations !== undefined) {
        result.memory.observationsEnabled = config.memory.features.observations;
      }
      if (config.memory.features?.prompt_time_injection !== undefined) {
        result.memory.promptTimeInjectionEnabled = config.memory.features.prompt_time_injection;
      }
      if (config.memory.rollup_pending_threshold !== undefined) {
        result.memory.rollupPendingThreshold = config.memory.rollup_pending_threshold;
      }
      if (config.memory.sidebar_refresh_interval_ms !== undefined) {
        result.memory.sidebarRefreshIntervalMs = config.memory.sidebar_refresh_interval_ms;
      }
      if (config.memory.worker_concurrency !== undefined) {
        result.memory.workerConcurrency = config.memory.worker_concurrency;
      }
    }

    if (config.compliance?.mode !== undefined) {
      if (!isComplianceMode(config.compliance.mode)) {
        throw new Error(`config.yaml: compliance.mode must be ${COMPLIANCE_MODES.join(', ')}`);
      }
      result.compliance.mode = config.compliance.mode;
    }

    if (config.registry?.classification) {
      const classification = config.registry.classification;
      if (classification.enabled !== undefined) result.registry.classification.enabled = classification.enabled;
      if (classification.provider !== undefined) {
        if (!isFeatureRegistryClassificationProvider(classification.provider)) {
          throw new Error('config.yaml: registry.classification.provider must be anthropic or cliproxy');
        }
        result.registry.classification.provider = classification.provider;
      }
      if (classification.model !== undefined) result.registry.classification.model = classification.model;
      if (classification.per_day_cost_cap_usd !== undefined) {
        if (typeof classification.per_day_cost_cap_usd !== 'number' || classification.per_day_cost_cap_usd < 0) {
          throw new Error('config.yaml: registry.classification.per_day_cost_cap_usd must be a non-negative number');
        }
        result.registry.classification.perDayCostCapUsd = classification.per_day_cost_cap_usd;
      }
    }

    // Merge OpenRouter favorites
    if (config.openrouter?.favorites) {
      result.openrouterFavorites = config.openrouter.favorites;
    }

    // Merge role/workhorse model configuration
    mergeRoleConfig(result, config);

    // Merge tiered execution after provider auth from this source is available.
    result.tieredExecution = mergeTieredExecutionConfig(result.tieredExecution, config.tiered_execution);

    // Merge legacy API keys (for backward compatibility)
    // Only enable providers that weren't explicitly disabled in models.providers
    if (config.api_keys) {
      if (config.api_keys.openai) {
        result.apiKeys.openai = resolveEnvVar(config.api_keys.openai);
        if (!explicitlyDisabled.has('openai')) {
          result.enabledProviders.add('openai');
        }
      }
      if (config.api_keys.voyage) {
        result.apiKeys.voyage = resolveEnvVar(config.api_keys.voyage);
      }
      if (config.api_keys.google) {
        result.apiKeys.google = resolveEnvVar(config.api_keys.google);
        if (!explicitlyDisabled.has('google')) {
          result.enabledProviders.add('google');
        }
      }
      if (config.api_keys.minimax) {
        result.apiKeys.minimax = resolveEnvVar(config.api_keys.minimax);
        if (!explicitlyDisabled.has('minimax')) {
          result.enabledProviders.add('minimax');
        }
      }
      if (config.api_keys.zai) {
        result.apiKeys.zai = resolveEnvVar(config.api_keys.zai);
        if (!explicitlyDisabled.has('zai')) {
          result.enabledProviders.add('zai');
        }
      }
      if (config.api_keys.kimi) {
        result.apiKeys.kimi = resolveEnvVar(config.api_keys.kimi);
        if (!explicitlyDisabled.has('kimi')) {
          result.enabledProviders.add('kimi');
        }
      }
      if (config.api_keys.openrouter) {
        result.apiKeys.openrouter = resolveEnvVar(config.api_keys.openrouter);
        if (!explicitlyDisabled.has('openrouter')) {
          result.enabledProviders.add('openrouter');
        }
      }
      if (config.api_keys.mimo) {
        result.apiKeys.mimo = resolveEnvVar(config.api_keys.mimo);
        if (!explicitlyDisabled.has('mimo')) {
          result.enabledProviders.add('mimo');
        }
      }
      if (config.api_keys.nous) {
        result.apiKeys.nous = resolveEnvVar(config.api_keys.nous);
        if (!explicitlyDisabled.has('nous')) {
          result.enabledProviders.add('nous');
        }
      }
      if (config.api_keys.dashscope) {
        result.apiKeys.dashscope = resolveEnvVar(config.api_keys.dashscope);
        if (!explicitlyDisabled.has('dashscope')) {
          result.enabledProviders.add('dashscope');
        }
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

    // Merge default conversation model
    if (config.models?.default_conversation_model) {
      result.defaultConversationModel = config.models.default_conversation_model;
    }

    // Merge tracker keys
    if (config.tracker_keys) {
      if (config.tracker_keys.linear) {
        result.trackerKeys.linear = resolveEnvVar(config.tracker_keys.linear);
      }
      if (config.tracker_keys.github) {
        result.trackerKeys.github = resolveEnvVar(config.tracker_keys.github);
      }
      if (config.tracker_keys.gitlab) {
        result.trackerKeys.gitlab = resolveEnvVar(config.tracker_keys.gitlab);
      }
      if (config.tracker_keys.rally) {
        result.trackerKeys.rally = resolveEnvVar(config.tracker_keys.rally);
      }
    }

    // Merge shadow configuration
    mergeShadowConfig(result.shadow, config);

    // Merge caveman configuration
    mergeCavemanConfig(result.caveman, config);

    // Merge RTK configuration
    mergeRtkConfig(result.rtk, config);

    // Merge TLDR configuration
    mergeTldrConfig(result.tldr, config);

    // Merge docs RAG configuration
    mergeDocsConfig(result.docs, config);

    // Merge TTS daemon configuration
    mergeTtsConfig(result.tts, config);

    // Merge TTS summarizer configuration
    if (config.tts?.summarizer) {
      const s = config.tts.summarizer;
      if (s.enabled !== undefined) {
        result.ttsSummarizer.enabled = s.enabled;
      }
      if (s.model) {
        result.ttsSummarizer.model = resolveModelIdSync(s.model) as ModelId;
      }
      if (s.batch_window_seconds !== undefined) {
        result.ttsSummarizer.batchWindowSeconds = s.batch_window_seconds;
      }
    }

    // Merge background AI feature toggles + low-cost master switch (PAN-1583)
    if (config.background_ai) {
      if (typeof config.background_ai.cheap_mode === 'boolean') {
        result.backgroundAi.cheapMode = config.background_ai.cheap_mode;
      }
      if (config.background_ai.features) {
        for (const feature of BACKGROUND_AI_FEATURES) {
          const value = config.background_ai.features[feature];
          if (typeof value === 'boolean') {
            result.backgroundAi.features[feature] = value;
          }
        }
      }
    }

    if (config.resources) {
      if (typeof config.resources.memory_warn_gb === 'number') {
        result.resources.memoryWarnGb = config.resources.memory_warn_gb;
      }
      if (typeof config.resources.memory_block_gb === 'number') {
        result.resources.memoryBlockGb = config.resources.memory_block_gb;
      }
      if (typeof config.resources.agent_warn_count === 'number') {
        result.resources.agentWarnCount = config.resources.agent_warn_count;
      }
      if (typeof config.resources.agent_block_count === 'number') {
        result.resources.agentBlockCount = config.resources.agent_block_count;
      }
    }

    if (config.experimental) {
      if (typeof config.experimental.experimentalFeatures === 'boolean') {
        result.experimental.experimentalFeatures = config.experimental.experimentalFeatures;
      }
      if (typeof config.experimental.claudeCodeChannels === 'boolean') {
        result.experimental.claudeCodeChannels = config.experimental.claudeCodeChannels;
      }
      if (typeof config.experimental.claudeCodeChannelsMcp === 'boolean') {
        result.experimental.claudeCodeChannelsMcp = config.experimental.claudeCodeChannelsMcp;
      }
      if (typeof config.experimental.streamdownRenderer === 'boolean') {
        result.experimental.streamdownRenderer = config.experimental.streamdownRenderer;
      }
      if (typeof config.experimental.showHarnessModelPermutations === 'boolean') {
        result.experimental.showHarnessModelPermutations = config.experimental.showHarnessModelPermutations;
      }
    }

    if (config.claude && (config.claude.permissionMode === 'auto' || config.claude.permissionMode === 'bypass')) {
      result.claude.permissionMode = config.claude.permissionMode;
    }

    if (config.codex && (config.codex.permissionMode === 'read-only' || config.codex.permissionMode === 'workspace' || config.codex.permissionMode === 'auto-review' || config.codex.permissionMode === 'full-access')) {
      result.codex.permissionMode = config.codex.permissionMode;
    }

    // Merge remote work-agent provisioning settings
    mergeRemoteConfig(result, config);

    // Merge conversationSearch configuration
    if (config.conversationSearch) {
      const cs = config.conversationSearch;
      if (typeof cs.enabled === 'boolean') {
        result.conversationSearch.enabled = cs.enabled;
      }
      if (cs.provider !== undefined) {
        result.conversationSearch.provider = cs.provider;
      }
      if (cs.model !== undefined) {
        result.conversationSearch.model = cs.model;
      }
      if (cs.apiKeyRef !== undefined) {
        result.conversationSearch.apiKeyRef = cs.apiKeyRef;
      }
      if (cs.dbPath !== undefined) {
        result.conversationSearch.dbPath = cs.dbPath;
      }
    }
  }

  validateRoleModelRefs(result);
  if (Object.keys(result.tieredExecution.tiers).length > 0 || result.tieredExecution.enabled) {
    result.tieredExecution = validateTieredExecutionConfig(result.tieredExecution, {
      providerAuth: result.providerAuth,
    });
  }

  return { config: result, explicitlyDisabled };
}
