/**
 * Model Fallback Strategy
 *
 * When a non-Anthropic model is selected but its API key is missing,
 * automatically fallback to an equivalent Anthropic model. This ensures
 * Panopticon always works even without configuring external providers.
 */

import { Effect } from 'effect';
import { ModelId, AnthropicModel, OpenAIModel, GoogleModel } from './settings.js';
import { resolveModelId } from './model-capabilities.js';
import type { SubscriptionPlan } from './subscription-types.js';

/**
 * AI model provider types
 */
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'minimax' | 'openrouter' | 'zai' | 'mimo' | 'nous' | 'dashscope';

/**
 * Map of model ID to provider
 */
const MODEL_PROVIDERS: Record<ModelId, ModelProvider> = {
  // Anthropic models
  'claude-opus-4-7': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5': 'anthropic',
  'claude-haiku-4-5': 'anthropic',

  // OpenAI models (current — per developers.openai.com/codex/models)
  'gpt-5.5': 'openai',
  'gpt-5.5-pro': 'openai',
  'gpt-5.4': 'openai',
  'gpt-5.4-mini': 'openai',
  'gpt-5.4-pro': 'openai',
  'gpt-5.3-codex': 'openai',
  'gpt-5.2': 'openai',
  'o3': 'openai',
  'o4-mini': 'openai',

  // OpenAI legacy (for backward compat with existing configs/tests)
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
  'kimi-k2.6': 'kimi',
  'kimi-k2.5': 'kimi',
  'kimi-k2': 'kimi',
  'K2.6-code-preview': 'kimi',

  // MiniMax models
  'minimax-m2.7': 'minimax',
  'minimax-m2.7-highspeed': 'minimax',

  // Z.AI models
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
  'qwen3.7': 'dashscope',
} as Record<ModelId | string, ModelProvider>;

/**
 * Fallback mapping: non-Anthropic model → Anthropic equivalent
 *
 * Mapping strategy:
 * - Premium models (GPT-5.2, O3, Gemini Pro) → Sonnet 4.6 (good balance)
 * - Economy models (GPT-4o-mini, Gemini Flash) → Haiku 4.5
 * - GPT-4o → Sonnet 4.6 (similar tier)
 *
 * Note: We intentionally avoid Opus 4.6 as default fallback to keep costs reasonable.
 * Users who want Opus can explicitly set it in their config.
 */
const FALLBACK_MAP: Record<string, AnthropicModel> = {
  // OpenAI → Anthropic
  'gpt-5.5': 'claude-sonnet-4-6', // Flagship model → Sonnet
  'gpt-5.5-pro': 'claude-sonnet-4-6', // Top-tier model → Sonnet
  'gpt-5.4': 'claude-sonnet-4-6', // Flagship model → Sonnet
  'gpt-5.4-mini': 'claude-haiku-4-5', // Mid-tier → Haiku
  'gpt-5.4-pro': 'claude-sonnet-4-6', // Top-tier model → Sonnet
  'gpt-5.3-codex': 'claude-sonnet-4-6', // Coding flagship → Sonnet
  'gpt-5.2': 'claude-sonnet-4-6', // Previous-gen flagship → Sonnet
  'o3': 'claude-sonnet-4-6', // Reasoning model → Sonnet
  'o4-mini': 'claude-sonnet-4-6', // Compact reasoning model → Sonnet
  // Retired OpenAI IDs — mappings preserve semantic tier intent
  'o3-deep-research': 'claude-sonnet-4-6',
  // Active OpenAI API names — NOT deprecated. Included here so configs using these
  // IDs still fall back correctly if the OpenAI provider is disabled.
  'gpt-4o': 'claude-sonnet-4-6', // flagship-tier → Sonnet
  'gpt-4o-mini': 'claude-haiku-4-5', // economy-tier → Haiku

  // Google → Anthropic
  'gemini-3.1-pro-preview': 'claude-sonnet-4-6', // Flagship → Sonnet
  'gemini-3-flash-preview': 'claude-haiku-4-5', // Fast model → Haiku
  'gemini-3.1-flash-lite-preview': 'claude-haiku-4-5', // Budget model → Haiku
  // Deprecated Google IDs
  'gemini-3-pro-preview': 'claude-sonnet-4-6',
  'gemini-2.5-pro': 'claude-sonnet-4-6',
  'gemini-2.5-flash': 'claude-haiku-4-5',

  // Kimi → Anthropic
  'kimi-k2.6': 'claude-sonnet-4-6', // Latest flagship → Sonnet
  'kimi-k2.5': 'claude-sonnet-4-6', // Premium model → Sonnet
  'kimi-k2': 'claude-sonnet-4-6', // Previous gen
  'K2.6-code-preview': 'claude-sonnet-4-6',

  // MiniMax → Anthropic
  'minimax-m2.7': 'claude-sonnet-4-6', // Near-Opus performance → Sonnet
  'minimax-m2.7-highspeed': 'claude-sonnet-4-6', // Same quality, faster → Sonnet

  // Z.AI → Anthropic
  'glm-5.1': 'claude-sonnet-4-6', // Current GLM flagship → Sonnet
  // Deprecated Z.AI IDs — explicit targets preserve tier semantics independent of
  // MODEL_DEPRECATIONS resolution order (both resolve glm-4.7→glm-5.1 then FALLBACK_MAP,
  // and direct FALLBACK_MAP lookup; explicit entries make the result deterministic).
  'glm-4.7': 'claude-sonnet-4-6', // strong-tier → Sonnet
  'glm-4.7-flash': 'claude-haiku-4-5', // economy-tier → Haiku

  // MiMo → Anthropic
  'mimo-v2.5-pro': 'claude-sonnet-4-6', // Flagship reasoning → Sonnet
  'mimo-v2.5': 'claude-sonnet-4-6', // Multimodal → Sonnet

  // Nous Portal → Anthropic
  'qwen/qwen3.6-plus': 'claude-sonnet-4-6',

  // DashScope → Anthropic
  'qwen3-max': 'claude-sonnet-4-6',
  'qwen3-coder-plus': 'claude-sonnet-4-6',
  'qwen3-plus': 'claude-haiku-4-5',
  'qwen3.7': 'claude-sonnet-4-6',
};

/**
 * Default fallback when model not in explicit mapping
 */
const DEFAULT_FALLBACK: AnthropicModel = 'claude-sonnet-4-6';

/**
 * Tier rank for OpenAI models: higher = more powerful, needs higher subscription
 * Used for within-provider tier-aware fallback.
 */
const MODEL_TIER_RANK: Record<string, number> = {
  // OpenAI tiers
  'gpt-5.5-pro': 3,
  'gpt-5.5': 2,
  'gpt-5.4-pro': 3,
  'gpt-5.4': 2,
  'gpt-5.3-codex': 2,
  'gpt-5.2': 2,
  'o3': 2,
  'o4-mini': 1,
  'gpt-5.4-mini': 0,
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
export function isOpenRouterModel(modelId: string): boolean {
  return modelId.includes('/') && modelId !== 'qwen/qwen3.6-plus';
}

/**
 * Get the provider for a model ID
 */
export function getModelProvider(modelId: ModelId | string): ModelProvider {
  if (isOpenRouterModel(modelId)) return 'openrouter';
  const direct = (MODEL_PROVIDERS as Record<string, ModelProvider>)[modelId];
  if (direct) return direct;
  const resolved = resolveModelId(modelId);
  const resolvedProvider = (MODEL_PROVIDERS as Record<string, ModelProvider>)[resolved];
  if (resolvedProvider) return resolvedProvider;

  if (modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('o1') || modelId.startsWith('o2') || modelId.startsWith('o3') || modelId.startsWith('o4')) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('kimi-')) return 'kimi';
  if (modelId.toLowerCase().startsWith('minimax')) return 'minimax';
  if (modelId.startsWith('mimo-')) return 'mimo';
  return 'anthropic';
}

/**
 * Check if a model requires an external API key
 */
export function requiresExternalKey(modelId: ModelId | string): boolean {
  return getModelProvider(modelId) !== 'anthropic';
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: ModelProvider): ModelId[] {
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
export const DEFAULT_DEEP_ENRICHMENT_MODEL = 'claude-sonnet-4-6';

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
    // User is pro-tier or original was top-tier → use Sonnet 4.6
    return 'claude-sonnet-4-6';
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
export function applyTierAwareFallback(
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>,
  userTier?: SubscriptionPlan
): ModelId {
  const provider = getModelProvider(modelId);

  // Case 1: Provider disabled — use Anthropic equivalent if available
  if (!isProviderEnabled(provider, enabledProviders)) {
    const fallback = getFallbackModel(modelId);
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
  const providerModels = getModelsByProvider(provider);
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
export function applyFallback(
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>
): ModelId {
  return applyTierAwareFallback(modelId, enabledProviders, undefined);
}

/**
 * Get the fallback model for a given model (useful for preview/display)
 *
 * @param modelId Model to get fallback for
 * @returns Anthropic fallback model
 */
export function getFallbackModel(modelId: ModelId): AnthropicModel {
  // Anthropic models fallback to themselves
  if (getModelProvider(modelId) === 'anthropic') {
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
export function detectEnabledProviders(apiKeys: {
  openai?: string;
  google?: string;
  kimi?: string;
  minimax?: string;
  openrouter?: string;
  zai?: string;
  mimo?: string;
  nous?: string;
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

  return enabled;
}

/**
 * Filter a list of models to only those available with enabled providers
 *
 * @param models List of models to filter
 * @param enabledProviders Set of enabled provider names
 * @returns Filtered list of models
 */
export function filterAvailableModels(
  models: ModelId[],
  enabledProviders: Set<ModelProvider>
): ModelId[] {
  return models.filter((modelId) => {
    const provider = getModelProvider(modelId);
    return isProviderEnabled(provider, enabledProviders);
  });
}

/**
 * Get all available models (across all enabled providers)
 *
 * @param enabledProviders Set of enabled provider names
 * @returns List of available model IDs
 */
export function getAvailableModels(enabledProviders: Set<ModelProvider>): ModelId[] {
  return Object.keys(MODEL_PROVIDERS).filter((modelId) => {
    const provider = MODEL_PROVIDERS[modelId as ModelId];
    return isProviderEnabled(provider, enabledProviders);
  }) as ModelId[];
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Pure-sync provider/fallback resolution — additive Effect.sync wrappers.

/** True if the model id is an OpenRouter id. Pure. */
export const isOpenRouterModelEffect = (modelId: string): Effect.Effect<boolean> =>
  Effect.sync(() => isOpenRouterModel(modelId));

/** Resolve the provider for a model id. Pure. */
export const getModelProviderEffect = (
  modelId: ModelId | string,
): Effect.Effect<ModelProvider> => Effect.sync(() => getModelProvider(modelId));

/** Whether the model requires an external (non-Anthropic) API key. Pure. */
export const requiresExternalKeyEffect = (
  modelId: ModelId | string,
): Effect.Effect<boolean> => Effect.sync(() => requiresExternalKey(modelId));

/** Models for a specific provider. Pure. */
export const getModelsByProviderEffect = (
  provider: ModelProvider,
): Effect.Effect<ModelId[]> => Effect.sync(() => getModelsByProvider(provider));

/** Tier-aware fallback resolution. Pure. */
export const applyTierAwareFallbackEffect = (
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>,
  userTier?: SubscriptionPlan,
): Effect.Effect<ModelId> =>
  Effect.sync(() => applyTierAwareFallback(modelId, enabledProviders, userTier));

/** Provider-disabled fallback resolution. Pure. */
export const applyFallbackEffect = (
  modelId: ModelId,
  enabledProviders: Set<ModelProvider>,
): Effect.Effect<ModelId> => Effect.sync(() => applyFallback(modelId, enabledProviders));

/** Map a non-Anthropic model to its Anthropic equivalent. Pure. */
export const getFallbackModelEffect = (modelId: ModelId): Effect.Effect<AnthropicModel> =>
  Effect.sync(() => getFallbackModel(modelId));

/** Detect enabled providers from configured API keys. Pure. */
export const detectEnabledProvidersEffect = (
  apiKeys: Parameters<typeof detectEnabledProviders>[0],
): Effect.Effect<Set<ModelProvider>> => Effect.sync(() => detectEnabledProviders(apiKeys));

/** Filter a model list to the ones whose providers are enabled. Pure. */
export const filterAvailableModelsEffect = (
  models: ModelId[],
  enabledProviders: Set<ModelProvider>,
): Effect.Effect<ModelId[]> =>
  Effect.sync(() => filterAvailableModels(models, enabledProviders));

/** All available models across enabled providers. Pure. */
export const getAvailableModelsEffect = (
  enabledProviders: Set<ModelProvider>,
): Effect.Effect<ModelId[]> => Effect.sync(() => getAvailableModels(enabledProviders));
