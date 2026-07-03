/**
 * Model Fallback Strategy
 *
 * When a non-Anthropic model is selected but its API key is missing,
 * automatically fallback to an equivalent Anthropic model. This ensures
 * Overdeck always works even without configuring external providers.
 */

import { Effect } from 'effect';
import { ModelId, AnthropicModel } from './settings.js';
import { resolveModelIdSync } from './model-capabilities.js';
import type { SubscriptionPlan } from './subscription-types.js';

/**
 * AI model provider types
 */
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'minimax' | 'openrouter' | 'zai' | 'mimo' | 'nous' | 'dashscope' | 'xai' | 'groq' | 'cerebras' | 'mistral';

/**
 * Map of model ID to provider
 */
const MODEL_PROVIDERS: Record<ModelId, ModelProvider> = {
  // Anthropic models
  'claude-fable-5': 'anthropic',
  'claude-opus-4-8': 'anthropic',
  'claude-opus-4-7': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'claude-sonnet-5': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5': 'anthropic',
  'claude-haiku-4-5': 'anthropic',

  // OpenAI models (supported per Codex CLI catalog, 2026-05-23)
  'gpt-5.5': 'openai',
  'gpt-5.4': 'openai',
  'gpt-5.4-mini': 'openai',
  'gpt-5.3-codex': 'openai',
  'gpt-5.3-codex-spark': 'openai',
  'gpt-5.2': 'openai',

  // OpenAI retired (kept for backward compat with saved configs; migrated
  // out via MODEL_DEPRECATIONS in src/lib/model-capabilities.ts)
  'gpt-5.5-pro': 'openai',
  'gpt-5.4-pro': 'openai',
  'o3': 'openai',
  'o4-mini': 'openai',
  'o3-deep-research': 'openai',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',

  // Google models (current)
  'gemini-3.1-pro-preview': 'google',
  'gemini-3-flash-preview': 'google',
  'gemini-3.1-flash-lite-preview': 'google',

  // Google legacy
  'gemini-3-pro-preview': 'google',
  'gemini-2.5-pro': 'google',
  'gemini-2.5-flash': 'google',

  // Kimi models
  'kimi-k2.7-code': 'kimi',
  'kimi-k2.6': 'kimi',
  'kimi-k2.5': 'kimi',
  'kimi-k2': 'kimi',
  'K2.6-code-preview': 'kimi',

  // MiniMax models
  'minimax-m2.7': 'minimax',
  'minimax-m2.7-highspeed': 'minimax',
  'MiniMax-M3': 'minimax',

  // Z.AI models
  'glm-5.2': 'zai',
  'glm-5.1': 'zai',
  'glm-4.7': 'zai',
  'glm-4.7-flash': 'zai',

  // MiMo models
  'mimo-v2.5-pro': 'mimo',
  'mimo-v2.5': 'mimo',

  // Nous Portal models
  'qwen/qwen3.6-plus': 'nous',

  // DashScope models
  'qwen3-max': 'dashscope',
  'qwen3-coder-plus': 'dashscope',
  'qwen3-plus': 'dashscope',
  'qwen3.7-max': 'dashscope',

  // xAI models
  'grok-build-0.1': 'xai',
} as Record<ModelId | string, ModelProvider>;

/**
 * Fallback mapping: non-Anthropic model → Anthropic equivalent
 *
 * Mapping strategy:
 * - Premium models (GPT-5.2, O3, Gemini Pro) → Sonnet 5 (good balance)
 * - Economy models (GPT-4o-mini, Gemini Flash) → Haiku 4.5
 * - GPT-4o → Sonnet 5 (similar tier)
 *
 * Note: We intentionally avoid Opus 4.6 as default fallback to keep costs reasonable.
 * Users who want Opus can explicitly set it in their config.
 */
const FALLBACK_MAP: Record<string, AnthropicModel> = {
  // OpenAI → Anthropic
  'gpt-5.5': 'claude-sonnet-5', // Flagship model → Sonnet
  'gpt-5.5-pro': 'claude-sonnet-5', // Top-tier model → Sonnet
  'gpt-5.4': 'claude-sonnet-5', // Flagship model → Sonnet
  'gpt-5.4-mini': 'claude-haiku-4-5', // Mid-tier → Haiku
  'gpt-5.4-pro': 'claude-sonnet-5', // Top-tier model → Sonnet
  'gpt-5.3-codex': 'claude-sonnet-5', // Coding flagship → Sonnet
  'gpt-5.3-codex-spark': 'claude-haiku-4-5', // Ultra-fast coder → Haiku
  'gpt-5.2': 'claude-sonnet-5', // Previous-gen flagship → Sonnet
  'o3': 'claude-sonnet-5', // Reasoning model → Sonnet
  'o4-mini': 'claude-sonnet-5', // Compact reasoning model → Sonnet
  // Retired OpenAI IDs — mappings preserve semantic tier intent
  'o3-deep-research': 'claude-sonnet-5',
  // Active OpenAI API names — NOT deprecated. Included here so configs using these
  // IDs still fall back correctly if the OpenAI provider is disabled.
  'gpt-4o': 'claude-sonnet-5', // flagship-tier → Sonnet
  'gpt-4o-mini': 'claude-haiku-4-5', // economy-tier → Haiku

  // Google → Anthropic
  'gemini-3.1-pro-preview': 'claude-sonnet-5', // Flagship → Sonnet
  'gemini-3-flash-preview': 'claude-haiku-4-5', // Fast model → Haiku
  'gemini-3.1-flash-lite-preview': 'claude-haiku-4-5', // Budget model → Haiku
  // Deprecated Google IDs
  'gemini-3-pro-preview': 'claude-sonnet-5',
  'gemini-2.5-pro': 'claude-sonnet-5',
  'gemini-2.5-flash': 'claude-haiku-4-5',

  // Kimi → Anthropic
  'kimi-k2.7-code': 'claude-sonnet-5', // Coding flagship → Sonnet
  'kimi-k2.6': 'claude-sonnet-5', // Latest flagship → Sonnet
  'kimi-k2.5': 'claude-sonnet-5', // Premium model → Sonnet
  'kimi-k2': 'claude-sonnet-5', // Previous gen
  'K2.6-code-preview': 'claude-sonnet-5',

  // MiniMax → Anthropic
  'minimax-m2.7': 'claude-sonnet-5', // Near-Opus performance → Sonnet
  'minimax-m2.7-highspeed': 'claude-sonnet-5', // Same quality, faster → Sonnet
  'MiniMax-M3': 'claude-sonnet-5', // Top-tier coding → Sonnet

  // Z.AI → Anthropic
  'glm-5.2': 'claude-sonnet-5', // Current GLM flagship → Sonnet
  'glm-5.1': 'claude-sonnet-5', // Previous GLM flagship → Sonnet
  // Deprecated Z.AI IDs — explicit targets preserve tier semantics independent of
  // MODEL_DEPRECATIONS resolution order (both resolve glm-4.7→glm-5.1 then FALLBACK_MAP,
  // and direct FALLBACK_MAP lookup; explicit entries make the result deterministic).
  'glm-4.7': 'claude-sonnet-5', // strong-tier → Sonnet
  'glm-4.7-flash': 'claude-haiku-4-5', // economy-tier → Haiku

  // MiMo → Anthropic
  'mimo-v2.5-pro': 'claude-sonnet-5', // Flagship reasoning → Sonnet
  'mimo-v2.5': 'claude-sonnet-5', // Multimodal → Sonnet

  // Nous Portal → Anthropic
  'qwen/qwen3.6-plus': 'claude-sonnet-5',

  // DashScope → Anthropic
  'qwen3-max': 'claude-sonnet-5',
  'qwen3-coder-plus': 'claude-sonnet-5',
  'qwen3-plus': 'claude-haiku-4-5',
  'qwen3.7-max': 'claude-sonnet-5',

  // xAI → Anthropic
  'grok-build-0.1': 'claude-sonnet-5', // Coding flagship → Sonnet
};

/**
 * Default fallback when model not in explicit mapping
 */
const DEFAULT_FALLBACK: AnthropicModel = 'claude-sonnet-5';

/**
 * Tier rank for OpenAI models: higher = more powerful, needs higher subscription
 * Used for within-provider tier-aware fallback.
 */
const MODEL_TIER_RANK: Record<string, number> = {
  // OpenAI tiers — addendum 2026-05-23 catalog (Codex CLI)
  'gpt-5.5': 2,
  'gpt-5.4': 2,
  'gpt-5.3-codex': 2,
  'gpt-5.3-codex-spark': 1,
  'gpt-5.2': 2,
  'gpt-5.4-mini': 0,
  // Retired — kept for backward compat with saved configs until users
  // re-save (deprecation migrations in MODEL_DEPRECATIONS will rewrite them)
  'gpt-5.5-pro': 3,
  'gpt-5.4-pro': 3,
  'o3': 2,
  'o4-mini': 1,
};

/**
 * Tier rank for subscription plans
 */
const TIER_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  plus: 1,
  pro: 2,
};

/**
 * Check if a model ID is an OpenRouter model
 *
 * OpenRouter model IDs use the format "organization/model-name" (e.g., "qwen/qwen3.6-plus:free").
 * This is distinct from all other providers which use simple identifiers without slashes.
 */
export function isOpenRouterModelSync(modelId: string): boolean {
  return modelId.includes('/') && modelId !== 'qwen/qwen3.6-plus';
}

/**
 * Get the provider for a model ID
 */
export function getModelProviderSync(modelId: ModelId | string): ModelProvider {
  if (isOpenRouterModelSync(modelId)) return 'openrouter';
  const direct = (MODEL_PROVIDERS as Record<string, ModelProvider>)[modelId];
  if (direct) return direct;
  const resolved = resolveModelIdSync(modelId);
  const resolvedProvider = (MODEL_PROVIDERS as Record<string, ModelProvider>)[resolved];
  if (resolvedProvider) return resolvedProvider;

  if (modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('o1') || modelId.startsWith('o2') || modelId.startsWith('o3') || modelId.startsWith('o4')) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('kimi-')) return 'kimi';
  if (modelId.toLowerCase().startsWith('minimax')) return 'minimax';
  if (modelId.startsWith('mimo-')) return 'mimo';
  if (modelId.startsWith('grok-')) return 'xai';
  return 'anthropic';
}

/**
 * Check if a model requires an external API key
 */
export function requiresExternalKeySync(modelId: ModelId | string): boolean {
  return getModelProviderSync(modelId) !== 'anthropic';
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProviderSync(provider: ModelProvider): ModelId[] {
  return Object.entries(MODEL_PROVIDERS)
    .filter(([_, p]) => p === provider)
    .map(([modelId]) => modelId as ModelId);
}

/**
 * Check if a provider is enabled (has API key configured)
 *
 * @param provider Provider to check
 * @param enabledProviders Set of enabled provider names
 * @returns true if provider is enabled or is Anthropic (always enabled)
 */
export function isProviderEnabled(
  provider: ModelProvider,
  enabledProviders: Set<ModelProvider>
): boolean {
  return enabledProviders.has(provider);
}

export const DEFAULT_QUICK_ENRICHMENT_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_DEEP_ENRICHMENT_MODEL = 'claude-sonnet-5';

export type EnrichmentTier = 1 | 2 | 3;

export interface EnrichmentTierConfig {
  quickModel: string | null;
  deepModel: string | null;
}

export const ENRICHMENT_TIER_MAX_MESSAGES: Record<EnrichmentTier, number | null> = {
  1: 3,
  2: 11,
  3: null,
};

export function selectEnrichmentModelForTier(tier: EnrichmentTier, config: EnrichmentTierConfig): string {
  if (tier === 1) return config.quickModel ?? DEFAULT_QUICK_ENRICHMENT_MODEL;
  return config.deepModel ?? DEFAULT_DEEP_ENRICHMENT_MODEL;
}

export function maxMessagesForEnrichmentTier(tier: EnrichmentTier): number | null {
  return ENRICHMENT_TIER_MAX_MESSAGES[tier];
}

/**
 * Get the best Anthropic model available at or below a given tier.
 * Used when a user cannot access their preferred tier model and we want
 * to keep them within the Anthropic (claudish) ecosystem before switching.
 */
function getBestAnthropicAtTier(
  targetTier: SubscriptionPlan,
  originalModelId: ModelId
): AnthropicModel {
  const targetRank = TIER_RANK[targetTier];
  const originalRank = MODEL_TIER_RANK[originalModelId] ?? 0;

  // Determine which tier Anthropic model to use
  if (targetRank >= 2 || originalRank >= 2) {
    // User is pro-tier or original was top-tier → use the current Sonnet.
    return 'claude-sonnet-5';
  } else if (targetRank >= 0) {
    // User is free or plus tier → use Haiku 4.5 for economy
    return 'claude-haiku-4-5';
  }
  return DEFAULT_FALLBACK;
}

/**
 * Apply tier-aware fallback strategy for a model.
 *
 * Resolution order:
 * 1. If provider disabled → Anthropic equivalent (existing behavior)
 * 2. If userTier restricts model tier → within-provider downgrade if possible
 *    (e.g., gpt-5.4-pro → gpt-5.4 for plus user)
 * 3. If no same-tier model available → Anthropic equivalent
 *
 * @param modelId        Requested model
 * @param enabledProviders Set of enabled provider names
 * @param userTier       User's subscription tier (for OAuth users)
 * @returns              Best available model (possibly downgraded)
 */
export function applyTierAwareFallbackSync(
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>,
  userTier?: SubscriptionPlan
): ModelId {
  const provider = getModelProviderSync(modelId);

  // Case 1: Provider disabled — use Anthropic equivalent if available
  if (!isProviderEnabled(provider, enabledProviders)) {
    const fallback = getFallbackModelSync(modelId);
    if (isProviderEnabled('anthropic', enabledProviders)) {
      console.warn(
        `Model ${modelId} requires ${provider} API key which is not configured, falling back to ${fallback}`
      );
      return fallback;
    }
    // Anthropic is also disabled — return original model and warn; caller must handle
    console.warn(
      `Model ${modelId} requires ${provider} API key which is not configured, and Anthropic is also disabled — keeping original model`
    );
    return modelId;
  }

  // Case 2: API key auth (userTier undefined) — no tier restriction
  if (userTier === undefined) {
    return modelId;
  }

  // Case 3: Check if model is accessible at user's tier
  const modelRank = MODEL_TIER_RANK[modelId] ?? 0;
  const userRank = TIER_RANK[userTier];

  if (modelRank <= userRank) {
    // Model is accessible at user's tier
    return modelId;
  }

  // Case 4: User tier too low — find best available model at user's tier in same provider
  const providerModels = getModelsByProviderSync(provider);
  const candidates = providerModels.filter((m) => {
    const mRank = MODEL_TIER_RANK[m] ?? 0;
    return mRank <= userRank;
  });

  if (candidates.length > 0) {
    // Find highest-tier candidate (closest to original)
    candidates.sort((a, b) => (MODEL_TIER_RANK[b] ?? 0) - (MODEL_TIER_RANK[a] ?? 0));
    const downgraded = candidates[0]!;
    console.warn(
      `Model ${modelId} requires higher subscription tier, downgrading to ${downgraded}`
    );
    return downgraded;
  }

  // Case 5: No same-tier model available — fall back to Anthropic equivalent if available
  if (isProviderEnabled('anthropic', enabledProviders)) {
    const fallback = getBestAnthropicAtTier(userTier, modelId);
    console.warn(
      `No ${provider} model available at tier ${userTier}, falling back to ${fallback}`
    );
    return fallback;
  }
  // Anthropic is also disabled — return original model and warn; caller must handle
  console.warn(
    `No ${provider} model available at tier ${userTier}, and Anthropic is also disabled — keeping original model`
  );
  return modelId;
}

/**
 * Apply fallback strategy for a model (legacy, no tier awareness)
 *
 * If the model's provider is disabled (no API key), return an Anthropic equivalent.
 * Otherwise, return the original model.
 *
 * @param modelId Requested model
 * @param enabledProviders Set of enabled provider names
 * @returns Original model if provider enabled, otherwise Anthropic fallback
 */
export function applyFallbackSync(
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>
): ModelId {
  return applyTierAwareFallbackSync(modelId, enabledProviders, undefined);
}

/**
 * Get the fallback model for a given model (useful for preview/display)
 *
 * @param modelId Model to get fallback for
 * @returns Anthropic fallback model
 */
export function getFallbackModelSync(modelId: ModelId): AnthropicModel {
  // Anthropic models fallback to themselves
  if (getModelProviderSync(modelId) === 'anthropic') {
    return modelId as AnthropicModel;
  }

  return FALLBACK_MAP[modelId] || DEFAULT_FALLBACK;
}

/**
 * Detect enabled providers from API keys configuration
 *
 * @param apiKeys API keys object from settings
 * @returns Set of enabled provider names
 */
export function detectEnabledProvidersSync(apiKeys: {
  openai?: string;
  google?: string;
  kimi?: string;
  minimax?: string;
  openrouter?: string;
  zai?: string;
  mimo?: string;
  nous?: string;
  xai?: string;
}): Set<ModelProvider> {
  const enabled = new Set<ModelProvider>(['anthropic']); // Always enabled

  // Check each optional provider
  if (apiKeys.openai && apiKeys.openai.trim()) {
    enabled.add('openai');
  }
  if (apiKeys.google && apiKeys.google.trim()) {
    enabled.add('google');
  }
  if (apiKeys.kimi && apiKeys.kimi.trim()) {
    enabled.add('kimi');
  }
  if (apiKeys.minimax && apiKeys.minimax.trim()) {
    enabled.add('minimax');
  }
  if (apiKeys.openrouter && apiKeys.openrouter.trim()) {
    enabled.add('openrouter');
  }
  if (apiKeys.zai && apiKeys.zai.trim()) {
    enabled.add('zai');
  }
  if (apiKeys.mimo && apiKeys.mimo.trim()) {
    enabled.add('mimo');
  }
  if (apiKeys.nous && apiKeys.nous.trim()) {
    enabled.add('nous');
  }
  if (apiKeys.xai && apiKeys.xai.trim()) {
    enabled.add('xai');
  }

  return enabled;
}

/**
 * Filter a list of models to only those available with enabled providers
 *
 * @param models List of models to filter
 * @param enabledProviders Set of enabled provider names
 * @returns Filtered list of models
 */
export function filterAvailableModelsSync(
  models: ModelId[],
  enabledProviders: Set<ModelProvider>
): ModelId[] {
  return models.filter((modelId) => {
    const provider = getModelProviderSync(modelId);
    return isProviderEnabled(provider, enabledProviders);
  });
}

/**
 * Get all available models (across all enabled providers)
 *
 * @param enabledProviders Set of enabled provider names
 * @returns List of available model IDs
 */
export function getAvailableModelsSync(enabledProviders: Set<ModelProvider>): ModelId[] {
  return Object.keys(MODEL_PROVIDERS).filter((modelId) => {
    const provider = MODEL_PROVIDERS[modelId as ModelId];
    return isProviderEnabled(provider, enabledProviders);
  }) as ModelId[];
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Pure-sync provider/fallback resolution — additive Effect.sync wrappers.

/** True if the model id is an OpenRouter id. Pure. */
export const isOpenRouterModel = (modelId: string): Effect.Effect<boolean> =>
  Effect.sync(() => isOpenRouterModelSync(modelId));

/** Resolve the provider for a model id. Pure. */
export const getModelProvider = (
  modelId: ModelId | string,
): Effect.Effect<ModelProvider> => Effect.sync(() => getModelProviderSync(modelId));

/** Whether the model requires an external (non-Anthropic) API key. Pure. */
export const requiresExternalKey = (
  modelId: ModelId | string,
): Effect.Effect<boolean> => Effect.sync(() => requiresExternalKeySync(modelId));

/** Models for a specific provider. Pure. */
export const getModelsByProvider = (
  provider: ModelProvider,
): Effect.Effect<ModelId[]> => Effect.sync(() => getModelsByProviderSync(provider));

/** Tier-aware fallback resolution. Pure. */
export const applyTierAwareFallback = (
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>,
  userTier?: SubscriptionPlan,
): Effect.Effect<ModelId> =>
  Effect.sync(() => applyTierAwareFallbackSync(modelId, enabledProviders, userTier));

/** Provider-disabled fallback resolution. Pure. */
export const applyFallback = (
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>,
): Effect.Effect<ModelId> => Effect.sync(() => applyFallbackSync(modelId, enabledProviders));

/** Map a non-Anthropic model to its Anthropic equivalent. Pure. */
export const getFallbackModel = (modelId: ModelId): Effect.Effect<AnthropicModel> =>
  Effect.sync(() => getFallbackModelSync(modelId));

/** Detect enabled providers from configured API keys. Pure. */
export const detectEnabledProviders = (
  apiKeys: Parameters<typeof detectEnabledProvidersSync>[0],
): Effect.Effect<Set<ModelProvider>> => Effect.sync(() => detectEnabledProvidersSync(apiKeys));

/** Filter a model list to the ones whose providers are enabled. Pure. */
export const filterAvailableModels = (
  models: ModelId[],
  enabledProviders: Set<ModelProvider>,
): Effect.Effect<ModelId[]> =>
  Effect.sync(() => filterAvailableModelsSync(models, enabledProviders));

/** All available models across enabled providers. Pure. */
export const getAvailableModels = (
  enabledProviders: Set<ModelProvider>,
): Effect.Effect<ModelId[]> => Effect.sync(() => getAvailableModelsSync(enabledProviders));
