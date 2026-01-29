/**
 * Provider Configuration and Compatibility
 *
 * Defines which LLM providers are compatible with Claude Code's API format.
 * - Direct providers: Implement Anthropic-compatible API (no router needed)
 * - Router providers: Require claude-code-router for API translation
 */

import type { ModelId, AnthropicModel, OpenAIModel, GoogleModel, ZAIModel } from './settings.js';

export type ProviderName = 'anthropic' | 'kimi' | 'openai' | 'google' | 'zai';

/**
 * Provider compatibility types
 * - direct: Anthropic-compatible API, use ANTHROPIC_BASE_URL directly
 * - router: Incompatible API, requires claude-code-router for translation
 */
export type ProviderCompatibility = 'direct' | 'router';

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: ProviderName;
  displayName: string;
  compatibility: ProviderCompatibility;
  baseUrl?: string; // For direct providers
  models: ModelId[];
  tested: boolean; // Whether compatibility has been verified
  description: string;
}

/**
 * All provider configurations
 */
export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    compatibility: 'direct',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    tested: true,
    description: 'Native Claude API',
  },

  kimi: {
    name: 'kimi',
    displayName: 'Kimi (Moonshot AI)',
    compatibility: 'direct',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    models: [], // Kimi uses same model names as Anthropic
    tested: true,
    description: 'Anthropic-compatible API, tested 2026-01-28',
  },

  zai: {
    name: 'zai',
    displayName: 'Z.AI (GLM)',
    compatibility: 'direct',
    baseUrl: 'https://api.z.ai/api/anthropic',
    models: ['glm-4.7', 'glm-4.7-flash'],
    tested: true,
    description: 'Anthropic-compatible API, tested 2026-01-28',
  },

  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    compatibility: 'router',
    models: ['gpt-5.2-codex', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini'],
    tested: false,
    description: 'Requires claude-code-router for API translation',
  },

  google: {
    name: 'google',
    displayName: 'Google (Gemini)',
    compatibility: 'router',
    models: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
    tested: false,
    description: 'Requires claude-code-router for API translation',
  },
};

/**
 * Get provider for a given model ID
 */
export function getProviderForModel(modelId: ModelId): ProviderConfig {
  // Check Anthropic models
  if (['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'].includes(modelId)) {
    return PROVIDERS.anthropic;
  }

  // Check OpenAI models
  if (['gpt-5.2-codex', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini'].includes(modelId)) {
    return PROVIDERS.openai;
  }

  // Check Google models
  if (['gemini-3-pro-preview', 'gemini-3-flash-preview'].includes(modelId)) {
    return PROVIDERS.google;
  }

  // Check Z.AI models
  if (['glm-4.7', 'glm-4.7-flash'].includes(modelId)) {
    return PROVIDERS.zai;
  }

  // Default to Anthropic if unknown
  return PROVIDERS.anthropic;
}

/**
 * Check if a provider requires claude-code-router
 */
export function requiresRouter(provider: ProviderName): boolean {
  return PROVIDERS[provider].compatibility === 'router';
}

/**
 * Get all providers that require router (have router compatibility)
 */
export function getRouterProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS).filter(p => p.compatibility === 'router');
}

/**
 * Get all direct-compatible providers
 */
export function getDirectProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS).filter(p => p.compatibility === 'direct');
}

/**
 * Check if any configured providers require router
 * Used to determine if router installation is needed
 */
export function needsRouter(apiKeys: { openai?: string; google?: string; zai?: string }): boolean {
  return !!(apiKeys.openai || apiKeys.google);
}

/**
 * Get environment variables for spawning agent with specific provider
 */
export function getProviderEnv(
  provider: ProviderConfig,
  apiKey: string
): Record<string, string> {
  if (provider.compatibility === 'direct') {
    // Direct providers use ANTHROPIC_BASE_URL
    const env: Record<string, string> = {};

    if (provider.baseUrl) {
      env.ANTHROPIC_BASE_URL = provider.baseUrl;
    }

    if (provider.name !== 'anthropic') {
      // Non-Anthropic providers need auth token
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
    }

    // Z.AI recommends longer timeout
    if (provider.name === 'zai') {
      env.API_TIMEOUT_MS = '300000';
    }

    return env;
  } else {
    // Router providers use local router proxy
    return {
      ANTHROPIC_BASE_URL: 'http://localhost:8000',
      ANTHROPIC_AUTH_TOKEN: 'router-managed',
    };
  }
}
