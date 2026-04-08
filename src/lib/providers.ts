/**
 * Provider Configuration and Compatibility
 *
 * Defines which LLM providers are compatible with Claude Code's API format.
 * - Direct providers: Implement Anthropic-compatible API (no router needed)
 * - Router providers: Require claude-code-router for API translation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ModelId, AnthropicModel, OpenAIModel, GoogleModel, ZAIModel, MiniMaxModel } from './settings.js';

export type ProviderName = 'anthropic' | 'kimi' | 'openai' | 'google' | 'zai' | 'minimax' | 'openrouter';

/**
 * Provider compatibility types
 * - direct: Anthropic-compatible API, use ANTHROPIC_BASE_URL directly
 * - router: Incompatible API, requires claude-code-router for translation
 */
export type ProviderCompatibility = 'direct' | 'router';

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
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    tested: true,
    description: 'Native Claude API',
  },

  kimi: {
    name: 'kimi',
    displayName: 'Kimi (Moonshot AI)',
    compatibility: 'direct',
    baseUrl: 'https://api.kimi.com/coding/',
    authType: 'credential-file',
    credentialFile: '~/.kimi/credentials/kimi-code.json',
    credentialHelper: '~/.panopticon/bin/kimi-token-helper.sh',
    models: [], // Kimi uses same model names as Anthropic
    tested: true,
    description: 'Anthropic-compatible API via Kimi Code Plan (OAuth token refresh)',
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

  minimax: {
    name: 'minimax',
    displayName: 'MiniMax',
    compatibility: 'direct',
    baseUrl: 'https://api.minimax.io/anthropic',
    models: ['minimax-m2.7', 'minimax-m2.7-highspeed'],
    tested: true,
    description: 'Anthropic-compatible API, 10B active params, 100 tps highspeed variant',
  },

  openrouter: {
    name: 'openrouter',
    displayName: 'OpenRouter',
    compatibility: 'direct',
    baseUrl: 'https://openrouter.ai/api',
    models: [], // Dynamic models fetched from OpenRouter API; IDs contain '/'
    tested: true,
    description: 'Anthropic-compatible API aggregator. Model IDs contain \'/\' (e.g. qwen/qwen3.6-plus:free)',
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
  if (['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'].includes(modelId)) {
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

  // Check Kimi models
  if (['kimi-k2', 'kimi-k2.5'].includes(modelId)) {
    return PROVIDERS.kimi;
  }

  // Check MiniMax models
  if (['minimax-m2.7', 'minimax-m2.7-highspeed'].includes(modelId)) {
    return PROVIDERS.minimax;
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

    // Z.AI recommends longer timeout
    if (provider.name === 'zai') {
      env.API_TIMEOUT_MS = '300000';
    }

    return env;
  } else {
    // Router providers use local router proxy
    return {
      ANTHROPIC_BASE_URL: 'http://localhost:3456',
      ANTHROPIC_AUTH_TOKEN: 'router-managed',
    };
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
