import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { FsError } from './errors.js';
import type { SettingsConfig, ModelId } from './settings.js';
import { loadConfig, resolveModel } from './config-yaml.js';

// claude-code-router config directory
const ROUTER_CONFIG_DIR = join(homedir(), '.claude-code-router');
const ROUTER_CONFIG_FILE = join(ROUTER_CONFIG_DIR, 'config.json');

// Provider configuration
interface Provider {
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
}

// Router rule (agent type -> model)
interface RouterRule {
  model: string;
}

// Complete router configuration
export interface RouterConfig {
  providers: Provider[];
  router: Record<string, RouterRule>;
}

/**
 * Map model IDs to their providers
 */
function getModelProvider(modelId: ModelId): 'anthropic' | 'openai' | 'google' {
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gpt-') || modelId === 'o3') return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  // Default to anthropic for unknown models
  return 'anthropic';
}

/**
 * Generate claude-code-router config from Panopticon settings (LEGACY)
 *
 * @deprecated Use generateRouterConfigFromWorkTypes instead
 */
export function generateRouterConfig(settings: SettingsConfig): RouterConfig {
  const providers: Provider[] = [];
  const router: Record<string, RouterRule> = {};

  // Anthropic provider (always included - uses $ANTHROPIC_API_KEY env var)
  providers.push({
    name: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: '$ANTHROPIC_API_KEY',
    models: ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  });

  // OpenAI provider (only if API key configured)
  if (settings.api_keys.openai) {
    providers.push({
      name: 'openai',
      baseURL: 'https://api.openai.com/v1',
      // Support both plain text and ${VAR} syntax
      apiKey: settings.api_keys.openai.startsWith('$')
        ? settings.api_keys.openai
        : settings.api_keys.openai,
      models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-pro', 'gpt-5.3-codex', 'gpt-5.2', 'o3', 'o4-mini'],
    });
  }

  // Google provider (only if API key configured)
  if (settings.api_keys.google) {
    providers.push({
      name: 'google',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: settings.api_keys.google.startsWith('$')
        ? settings.api_keys.google
        : settings.api_keys.google,
      models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
    });
  }

  // See src/lib/providers.ts for direct API configuration

  // Legacy SettingsConfig still exposes historical keys; convert them to role keys
  // so generated CCR config no longer depends on the removed WorkType registry.
  router['role:review'] = {
    model: settings.models.specialists.review_agent,
  };
  router['role:test'] = {
    model: settings.models.specialists.test_agent,
  };
  router['role:ship'] = {
    model: settings.models.specialists.merge_agent,
  };
  router['role:plan'] = {
    model: settings.models.complexity.complex,
  };
  router['role:work'] = {
    model: settings.models.complexity.medium,
  };

  return { providers, router };
}

/**
 * Generate claude-code-router config from role routing.
 *
 * @deprecated Kept for CLI compatibility with older CCR setup commands. The
 * role primitive owns model resolution; emitted router keys are role-based.
 */
export function generateRouterConfigFromWorkTypes(): RouterConfig {
  const { config } = loadConfig();
  const apiKeys = config.apiKeys;
  const enabledProviders = config.enabledProviders;

  const providers: Provider[] = [];
  const router: Record<string, RouterRule> = {};

  // Anthropic provider (always included - uses $ANTHROPIC_API_KEY env var)
  providers.push({
    name: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: '$ANTHROPIC_API_KEY',
    models: ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  });

  // OpenAI provider (only if enabled)
  if (enabledProviders.has('openai') && apiKeys.openai) {
    providers.push({
      name: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: apiKeys.openai.startsWith('$') ? apiKeys.openai : apiKeys.openai,
      models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-pro', 'gpt-5.3-codex', 'gpt-5.2', 'o3', 'o4-mini'],
    });
  }

  // Google provider (only if enabled)
  if (enabledProviders.has('google') && apiKeys.google) {
    providers.push({
      name: 'google',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: apiKeys.google.startsWith('$') ? apiKeys.google : apiKeys.google,
      models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
    });
  }

  for (const role of ['plan', 'work', 'review', 'test', 'ship', 'flywheel'] as const) {
    router[`role:${role}`] = { model: resolveModel(role, undefined, config) };
  }
  for (const subRole of ['inspect', 'inspect-deep'] as const) {
    router[`role:work.${subRole}`] = { model: resolveModel('work', subRole, config) };
  }
  for (const subRole of ['security', 'correctness', 'performance', 'requirements'] as const) {
    router[`role:review.${subRole}`] = { model: resolveModel('review', subRole, config) };
  }

  return { providers, router };
}

/**
 * Write router config to ~/.claude-code-router/config.json
 */
export function writeRouterConfig(config: RouterConfig): void {
  // Ensure directory exists
  if (!existsSync(ROUTER_CONFIG_DIR)) {
    mkdirSync(ROUTER_CONFIG_DIR, { recursive: true });
  }

  // Write config with pretty formatting
  const content = JSON.stringify(config, null, 2);
  writeFileSync(ROUTER_CONFIG_FILE, content, 'utf8');
}

/**
 * Get the router config file path (for display/debugging)
 */
export function getRouterConfigPath(): string {
  return ROUTER_CONFIG_FILE;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of `writeRouterConfig`. Uses fs/promises so it's safe in
 *  dashboard-server-reachable code paths (no event-loop blocking). */
export const writeRouterConfigEffect = (
  config: RouterConfig,
): Effect.Effect<void, FsError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(ROUTER_CONFIG_DIR, { recursive: true }),
      catch: (cause) => new FsError({ path: ROUTER_CONFIG_DIR, operation: 'mkdir', cause }),
    });
    const content = JSON.stringify(config, null, 2);
    yield* Effect.tryPromise({
      try: () => writeFile(ROUTER_CONFIG_FILE, content, 'utf8'),
      catch: (cause) => new FsError({ path: ROUTER_CONFIG_FILE, operation: 'write', cause }),
    });
  });

