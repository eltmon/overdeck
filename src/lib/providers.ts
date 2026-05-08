/**
 * Provider Configuration and Compatibility
 *
 * Defines which LLM providers are compatible with Claude Code's API format.
 * - Direct providers: Implement Anthropic-compatible API (no router needed)
 * - Claudish providers: Route through claudish for provider-prefixed model selection
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ModelId, AnthropicModel, OpenAIModel, GoogleModel, KimiModel, MimoModel } from './settings.js';

export type ProviderName = 'anthropic' | 'kimi' | 'openai' | 'google' | 'minimax' | 'zai' | 'mimo' | 'openrouter';

/**
 * Provider compatibility types
 * - direct: Anthropic-compatible API, use ANTHROPIC_BASE_URL directly
 * - claudish: Route via claudish (provider@model syntax, supports OAuth subscriptions)
 */
export type ProviderCompatibility = 'direct' | 'claudish';

/**
 * Provider configuration
 */
/**
 * Auth type for direct providers:
 * - static: Use a long-lived API key passed via ANTHROPIC_AUTH_TOKEN (default)
 * - credential-file: Use apiKeyHelper to read a fresh token from a credential file.
 *   Used for providers like Kimi Code Plan whose JWT tokens expire every ~15 minutes.
 */
export type ProviderAuthType = 'static' | 'credential-file';

export interface ProviderConfig {
  name: ProviderName;
  displayName: string;
  compatibility: ProviderCompatibility;
  baseUrl?: string; // For direct providers
  authType?: ProviderAuthType; // Defaults to 'static'
  credentialFile?: string; // Path to credential file (for 'credential-file' auth)
  credentialHelper?: string; // Script that reads credential file and prints token
  models: (ModelId | string)[];
  haikuModel?: string; // Model to use as haiku substitute (for non-Anthropic providers)
  tierModels?: {
    opus?: string;
    sonnet?: string;
    haiku?: string;
  };
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
    models: ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    tested: true,
    description: 'Native Claude API',
  },

  kimi: {
    name: 'kimi',
    displayName: 'Kimi (Moonshot AI)',
    compatibility: 'claudish',
    models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2', 'K2.6-code-preview'],
    tierModels: { opus: 'kimi-k2.6', sonnet: 'kimi-k2.5', haiku: 'kimi-k2' },
    tested: true,
    description: 'Route via claudish: kimi@model or bare model (auto-detected)',
  },

  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    compatibility: 'claudish',
    models: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-nano', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'o3', 'o4-mini'],
    tierModels: { opus: 'gpt-5.5-pro', sonnet: 'gpt-5.5', haiku: 'gpt-5.5-mini' },
    tested: true,
    description: 'Route via claudish: oai@model (API key) or cx@model (ChatGPT OAuth subscription)',
  },

  google: {
    name: 'google',
    displayName: 'Google (Gemini)',
    compatibility: 'direct',
    models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
    tierModels: { opus: 'gemini-3.1-pro-preview', sonnet: 'gemini-3-flash-preview', haiku: 'gemini-3.1-flash-lite-preview' },
    tested: true,
    description: 'Route via local CLIProxyAPI Gemini backend using GOOGLE_API_KEY',
  },

  minimax: {
    name: 'minimax',
    displayName: 'MiniMax',
    compatibility: 'claudish',
    models: ['minimax-m2.7', 'minimax-m2.7-highspeed'],
    haikuModel: 'minimax-m2.7-highspeed',
    tierModels: { opus: 'minimax-m2.7', sonnet: 'minimax-m2.7', haiku: 'minimax-m2.7-highspeed' },
    tested: true,
    description: 'Route via claudish: mm@model or bare model (auto-detected)',
  },

  zai: {
    name: 'zai',
    displayName: 'Z.AI',
    compatibility: 'claudish',
    models: ['glm-5.1', 'glm-4.7', 'glm-4.7-flash'],
    haikuModel: 'glm-4.7-flash',
    tierModels: { opus: 'glm-5.1', sonnet: 'glm-4.7', haiku: 'glm-4.7-flash' },
    tested: true,
    description: 'Route via claudish: zai@model or bare model (auto-detected)',
  },

  mimo: {
    name: 'mimo',
    displayName: 'Xiaomi MiMo',
    compatibility: 'claudish',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
    authType: 'static',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    haikuModel: 'mimo-v2.5',
    tierModels: { opus: 'mimo-v2.5-pro', sonnet: 'mimo-v2.5-pro', haiku: 'mimo-v2.5' },
    tested: true,
    description: 'Route via claudish custom URL: https://token-plan-sgp.xiaomimimo.com/anthropic/<model>',
  },

  openrouter: {
    name: 'openrouter',
    displayName: 'OpenRouter',
    compatibility: 'claudish',
    models: [], // Dynamic models fetched from OpenRouter API; IDs contain '/'
    tested: true,
    description: 'Route via claudish: or@model (e.g. or@qwen/qwen3.6-plus:free)',
  },
};

/**
 * Get provider for a given model ID
 */
export function getProviderForModel(modelId: ModelId | string): ProviderConfig {
  // OpenRouter model IDs always contain '/' (e.g. 'qwen/qwen3.6-plus:free')
  if (modelId.includes('/')) {
    return PROVIDERS.openrouter;
  }

  // Check Anthropic models
  if (['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'].includes(modelId)) {
    return PROVIDERS.anthropic;
  }

  // Check OpenAI models
  if (['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-nano', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'o3', 'o4-mini', 'gpt-5.2-codex', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini'].includes(modelId)) {
    return PROVIDERS.openai;
  }

  // Check Google models
  if (['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'].includes(modelId)) {
    return PROVIDERS.google;
  }

  // Check MiniMax models
  if (['minimax-m2.7', 'minimax-m2.7-highspeed'].includes(modelId)) {
    return PROVIDERS.minimax;
  }

  // Check Kimi models
  if (['kimi-k2.6', 'kimi-k2.5', 'kimi-k2', 'K2.6-code-preview'].includes(modelId)) {
    return PROVIDERS.kimi;
  }

  // Check Z.AI models
  if (['glm-5.1', 'glm-4.7', 'glm-4.7-flash'].includes(modelId)) {
    return PROVIDERS.zai;
  }

  // Check MiMo models
  if (['mimo-v2.5-pro', 'mimo-v2.5'].includes(modelId)) {
    return PROVIDERS.mimo;
  }

  // Default to Anthropic if unknown
  return PROVIDERS.anthropic;
}

/**
 * Check if a provider requires claudish routing
 */
export function requiresClaudish(provider: ProviderName): boolean {
  return PROVIDERS[provider].compatibility === 'claudish';
}

/**
 * Get all providers that require claudish routing
 */
export function getClaudishProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS).filter(p => p.compatibility === 'claudish');
}

/**
 * Get all direct-compatible providers
 */
export function getDirectProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS).filter(p => p.compatibility === 'direct');
}

/**
 * Check if any configured providers need claudish installed.
 */
export function needsClaudish(apiKeys: { openai?: string; google?: string }): boolean {
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
      if (provider.authType === 'credential-file') {
        // Credential-file providers use apiKeyHelper for dynamic token refresh.
        // We still need an initial ANTHROPIC_AUTH_TOKEN for the first request,
        // but apiKeyHelper (configured via setupCredentialFileAuth) will keep it fresh.
        env.ANTHROPIC_AUTH_TOKEN = apiKey;
        // Refresh token every 60 seconds (kimi-cli refreshes credential file automatically)
        env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS = '60000';
      } else {
        // Static providers use a long-lived API key
        env.ANTHROPIC_AUTH_TOKEN = apiKey;
      }
    }

    // MiniMax, Z.AI, and MiMo recommend longer timeouts
    if (provider.name === 'minimax' || provider.name === 'zai' || provider.name === 'mimo') {
      env.API_TIMEOUT_MS = '300000';
    }

    // Non-Anthropic providers don't support claude-haiku-4-5-20251001.
    // Tell Claude Code to use the provider's small/fast model instead
    // for Explore agents and other haiku-dependent features.
    if (provider.haikuModel) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.haikuModel;
    }

    // Inject subagent model env vars so Claude Code spawns subagents
    // (Explorer, Plan, general-purpose) with model IDs the provider knows.
    if (provider.tierModels) {
      if (provider.tierModels.opus) {
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.tierModels.opus;
      }
      if (provider.tierModels.sonnet) {
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.tierModels.sonnet;
      }
      if (provider.tierModels.haiku) {
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.tierModels.haiku;
        env.ANTHROPIC_SMALL_FAST_MODEL = provider.tierModels.haiku;
        env.CLAUDE_CODE_SUBAGENT_MODEL = provider.tierModels.haiku;
      }
    }

    return env;
  } else {
    // Claudish-backed providers are launched via the `claudish` wrapper, not
    // through a long-lived localhost proxy. For subscription/OAuth-backed
    // models no extra env is required; for direct API-key mode, pass the
    // provider-native key env that claudish expects.
    if (apiKey === 'subscription-oauth') {
      return {};
    }

    if (provider.name === 'openai') {
      return { OPENAI_API_KEY: apiKey };
    }

    if (provider.name === 'google') {
      return { GEMINI_API_KEY: apiKey };
    }

    if (provider.name === 'kimi') {
      return { KIMI_CODING_API_KEY: apiKey };
    }

    if (provider.name === 'minimax') {
      return { MINIMAX_API_KEY: apiKey };
    }

    if (provider.name === 'zai') {
      return { ZHIPU_API_KEY: apiKey };
    }

    if (provider.name === 'mimo') {
      return { ANTHROPIC_API_KEY: apiKey };
    }

    if (provider.name === 'openrouter') {
      return { OPENROUTER_API_KEY: apiKey };
    }

    return {};
  }
}

/**
 * For credential-file providers (e.g. Kimi Code Plan), configure Claude Code's
 * apiKeyHelper in the workspace settings so tokens are refreshed dynamically.
 *
 * This writes to .claude/settings.local.json in the workspace directory.
 * Must be called before spawning the agent.
 */
export function setupCredentialFileAuth(provider: ProviderConfig, workspacePath: string): void {
  if (provider.authType !== 'credential-file' || !provider.credentialHelper) return;

  const helperPath = provider.credentialHelper.replace('~', process.env.HOME || '');
  const claudeDir = join(workspacePath, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Read existing settings or start fresh
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch { /* start fresh */ }
  }

  // Set the apiKeyHelper to our token reader script
  settings.apiKeyHelper = helperPath;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Clear credential-file auth from workspace settings.
 *
 * When switching from a credential-file provider (e.g. Kimi) to a static/plan-based
 * provider (e.g. Anthropic), the apiKeyHelper must be removed from
 * .claude/settings.local.json. Otherwise Claude Code will keep using the stale
 * token helper and fail with "Invalid API key".
 */
export function clearCredentialFileAuth(workspacePath: string): void {
  const settingsPath = join(workspacePath, '.claude', 'settings.local.json');
  if (!existsSync(settingsPath)) return;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    if (!settings.apiKeyHelper) return; // Nothing to clear

    delete settings.apiKeyHelper;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch { /* non-fatal */ }
}
