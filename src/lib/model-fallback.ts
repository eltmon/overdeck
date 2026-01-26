/**
 * Model Fallback Strategy
 *
 * When a non-Anthropic model is selected but its API key is missing,
 * automatically fallback to an equivalent Anthropic model. This ensures
 * Panopticon always works even without configuring external providers.
 */

import { ModelId, AnthropicModel, OpenAIModel, GoogleModel, ZAIModel } from './settings.js';

/**
 * AI model provider types
 */
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'zai';

/**
 * Map of model ID to provider
 */
const MODEL_PROVIDERS: Record<ModelId, ModelProvider> = {
  // Anthropic models
  'claude-opus-4-5': 'anthropic',
  'claude-sonnet-4-5': 'anthropic',
  'claude-haiku-4-5': 'anthropic',

  // OpenAI models
  'gpt-5.2-codex': 'openai',
  'o3-deep-research': 'openai',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',

  // Google models
  'gemini-3-pro-preview': 'google',
  'gemini-3-flash-preview': 'google',

  // Z.AI models
  'glm-4.7': 'zai',
  'glm-4.7-flash': 'zai',
};

/**
 * Fallback mapping: non-Anthropic model → Anthropic equivalent
 *
 * Mapping strategy:
 * - Premium models (GPT-5.2, O3, Gemini Pro) → Sonnet 4.5 (good balance)
 * - Economy models (GPT-4o-mini, Gemini Flash, GLM Flash) → Haiku 4.5
 * - GPT-4o → Sonnet 4.5 (similar tier)
 * - GLM-4.7 → Haiku 4.5 (economy tier)
 *
 * Note: We intentionally avoid Opus 4.5 as default fallback to keep costs reasonable.
 * Users who want Opus can explicitly set it in their config.
 */
const FALLBACK_MAP: Record<string, AnthropicModel> = {
  // OpenAI → Anthropic
  'gpt-5.2-codex': 'claude-sonnet-4-5', // Premium code model → Sonnet
  'o3-deep-research': 'claude-sonnet-4-5', // Premium research model → Sonnet
  'gpt-4o': 'claude-sonnet-4-5', // Flagship model → Sonnet
  'gpt-4o-mini': 'claude-haiku-4-5', // Economy model → Haiku

  // Google → Anthropic
  'gemini-3-pro-preview': 'claude-sonnet-4-5', // Premium model → Sonnet
  'gemini-3-flash-preview': 'claude-haiku-4-5', // Fast model → Haiku

  // Z.AI → Anthropic
  'glm-4.7': 'claude-haiku-4-5', // Standard model → Haiku
  'glm-4.7-flash': 'claude-haiku-4-5', // Fast model → Haiku
};

/**
 * Default fallback when model not in explicit mapping
 */
const DEFAULT_FALLBACK: AnthropicModel = 'claude-sonnet-4-5';

/**
 * Get the provider for a model ID
 */
export function getModelProvider(modelId: ModelId): ModelProvider {
  return MODEL_PROVIDERS[modelId];
}

/**
 * Check if a model requires an external API key
 */
export function requiresExternalKey(modelId: ModelId): boolean {
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

  // Provider disabled - lookup fallback
  const fallback = FALLBACK_MAP[modelId] || DEFAULT_FALLBACK;

  // Log fallback for visibility
  console.warn(
    `Model ${modelId} requires ${provider} API key - falling back to ${fallback}`
  );

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
  zai?: string;
}): Set<ModelProvider> {
  const enabled = new Set<ModelProvider>(['anthropic']); // Always enabled

  // Check each optional provider
  if (apiKeys.openai && apiKeys.openai.trim()) {
    enabled.add('openai');
  }
  if (apiKeys.google && apiKeys.google.trim()) {
    enabled.add('google');
  }
  if (apiKeys.zai && apiKeys.zai.trim()) {
    enabled.add('zai');
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
