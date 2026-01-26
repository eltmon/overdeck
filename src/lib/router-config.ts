import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SettingsConfig, ModelId } from './settings.js';
import { getAllWorkTypes, WorkTypeId } from './work-types.js';
import { WorkTypeRouter } from './work-type-router.js';

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
function getModelProvider(modelId: ModelId): 'anthropic' | 'openai' | 'google' | 'zai' {
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3-')) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('glm-')) return 'zai';
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
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
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
      models: ['gpt-5.2-codex', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini'],
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
      models: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
    });
  }

  // Z.AI provider (only if API key configured)
  if (settings.api_keys.zai) {
    providers.push({
      name: 'zai',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: settings.api_keys.zai.startsWith('$')
        ? settings.api_keys.zai
        : settings.api_keys.zai,
      models: ['glm-4.7', 'glm-4.7-flash'],
    });
  }

  // Router rules: Map agent types to configured models

  // Specialist agents
  router['specialist-review-agent'] = {
    model: settings.models.specialists.review_agent,
  };
  router['specialist-test-agent'] = {
    model: settings.models.specialists.test_agent,
  };
  router['specialist-merge-agent'] = {
    model: settings.models.specialists.merge_agent,
  };

  // Planning agent
  router['planning-agent'] = {
    model: settings.models.planning_agent,
  };

  // Complexity-based routing (for backward compatibility)
  router['complexity-trivial'] = {
    model: settings.models.complexity.trivial,
  };
  router['complexity-simple'] = {
    model: settings.models.complexity.simple,
  };
  router['complexity-medium'] = {
    model: settings.models.complexity.medium,
  };
  router['complexity-complex'] = {
    model: settings.models.complexity.complex,
  };
  router['complexity-expert'] = {
    model: settings.models.complexity.expert,
  };

  return { providers, router };
}

/**
 * Generate claude-code-router config from work types
 *
 * This is the new work-type-based router configuration.
 * It generates routing rules for all 23 work types using the
 * WorkTypeRouter to resolve models.
 */
export function generateRouterConfigFromWorkTypes(): RouterConfig {
  const workTypeRouter = new WorkTypeRouter();
  const apiKeys = workTypeRouter.getApiKeys();
  const enabledProviders = workTypeRouter.getEnabledProviders();

  const providers: Provider[] = [];
  const router: Record<string, RouterRule> = {};

  // Anthropic provider (always included - uses $ANTHROPIC_API_KEY env var)
  providers.push({
    name: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: '$ANTHROPIC_API_KEY',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  });

  // OpenAI provider (only if enabled)
  if (enabledProviders.has('openai') && apiKeys.openai) {
    providers.push({
      name: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: apiKeys.openai.startsWith('$') ? apiKeys.openai : apiKeys.openai,
      models: ['gpt-5.2-codex', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini'],
    });
  }

  // Google provider (only if enabled)
  if (enabledProviders.has('google') && apiKeys.google) {
    providers.push({
      name: 'google',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: apiKeys.google.startsWith('$') ? apiKeys.google : apiKeys.google,
      models: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
    });
  }

  // Z.AI provider (only if enabled)
  if (enabledProviders.has('zai') && apiKeys.zai) {
    providers.push({
      name: 'zai',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: apiKeys.zai.startsWith('$') ? apiKeys.zai : apiKeys.zai,
      models: ['glm-4.7', 'glm-4.7-flash'],
    });
  }

  // Generate router rules for all 23 work types
  const allWorkTypes = getAllWorkTypes();
  for (const workType of allWorkTypes) {
    const resolution = workTypeRouter.getModel(workType);
    router[workType] = {
      model: resolution.model,
    };
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
