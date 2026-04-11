/**
 * Model Fallback Strategy
 *
 * When a non-Anthropic model is selected but its API key is missing,
 * automatically fallback to an equivalent Anthropic model. This ensures
 * Panopticon always works even without configuring external providers.
 */

import { ModelId, AnthropicModel, OpenAIModel, GoogleModel } from './settings.js';
import { resolveModelId } from './model-capabilities.js';

/**
 * AI model provider types
 */
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'minimax' | 'openrouter' | 'zai';

/**
 * Map of model ID to provider
 */
const MODEL_PROVIDERS: Record<ModelId, ModelProvider> = {
  // Anthropic models
  'claude-opus-4-6': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5': 'anthropic',
  'claude-haiku-4-5': 'anthropic',

  // OpenAI models
  'gpt-5.4': 'openai',
  'gpt-5.4-mini': 'openai',
  'gpt-5.4-nano': 'openai',
  'o3': 'openai',

  // Google models
  'gemini-3.1-pro-preview': 'google',
  'gemini-3-flash': 'google',
  'gemini-3.1-flash-lite-preview': 'google',

  // Kimi models
  'kimi-k2.5': 'kimi',

  // MiniMax models
  'minimax-m2.7': 'minimax',
  'minimax-m2.7-highspeed': 'minimax',

  // Z.AI models
  'glm-5.1': 'zai',
};

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
  'gpt-5.4': 'claude-sonnet-4-6', // Flagship model → Sonnet
  'gpt-5.4-mini': 'claude-haiku-4-5', // Mid-tier → Haiku
  'gpt-5.4-nano': 'claude-haiku-4-5', // Economy model → Haiku
  'o3': 'claude-sonnet-4-6', // Reasoning model → Sonnet
  // Deprecated OpenAI IDs — explicit mappings preserve semantic intent
  // (gpt-4o was flagship-tier, so → Sonnet; gpt-4o-mini was economy → Haiku)
  'gpt-5.2-codex': 'claude-sonnet-4-6',
  'o3-deep-research': 'claude-sonnet-4-6',
  'gpt-4o': 'claude-sonnet-4-6',
  'gpt-4o-mini': 'claude-haiku-4-5',

  // Google → Anthropic
  'gemini-3.1-pro-preview': 'claude-sonnet-4-6', // Flagship → Sonnet
  'gemini-3-flash': 'claude-haiku-4-5', // Fast model → Haiku
  'gemini-3.1-flash-lite-preview': 'claude-haiku-4-5', // Budget model → Haiku
  // Deprecated Google IDs
  'gemini-3-pro-preview': 'claude-sonnet-4-6',
  'gemini-3-flash-preview': 'claude-haiku-4-5',
  'gemini-2.5-pro': 'claude-sonnet-4-6',
  'gemini-2.5-flash': 'claude-haiku-4-5',

  // Kimi → Anthropic
  'kimi-k2.5': 'claude-sonnet-4-6', // Premium model → Sonnet

  // MiniMax → Anthropic
  'minimax-m2.7': 'claude-sonnet-4-6', // Near-Opus performance → Sonnet
  'minimax-m2.7-highspeed': 'claude-sonnet-4-6', // Same quality, faster → Sonnet
};

/**
 * Default fallback when model not in explicit mapping
 */
const DEFAULT_FALLBACK: AnthropicModel = 'claude-sonnet-4-6';

/**
 * Check if a model ID is an OpenRouter model
 *
 * OpenRouter model IDs use the format "organization/model-name" (e.g., "qwen/qwen3.6-plus:free").
 * This is distinct from all other providers which use simple identifiers without slashes.
 */
export function isOpenRouterModel(modelId: string): boolean {
  return modelId.includes('/');
}

/**
 * Get the provider for a model ID
 */
export function getModelProvider(modelId: ModelId | string): ModelProvider {
  if (isOpenRouterModel(modelId)) return 'openrouter';
  // Resolve deprecated model IDs to their current replacement before looking up provider
  const resolved = resolveModelId(modelId);
  return (MODEL_PROVIDERS as Record<string, ModelProvider>)[resolved] ?? 'anthropic';
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
  // Anthropic is always enabled (required)
  if (provider === 'anthropic') return true;

  return enabledProviders.has(provider);
}

/**
 * Apply fallback strategy for a model
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
  const provider = getModelProvider(modelId);

  // If provider is enabled, use the requested model
  if (isProviderEnabled(provider, enabledProviders)) {
    return modelId;
  }

  // Provider disabled — fall back to the equivalent Anthropic model
  const fallback = getFallbackModel(modelId);
  console.warn(`Model ${modelId} requires ${provider} API key which is not configured, falling back to ${fallback}`);
  return fallback;
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
