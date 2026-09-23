import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfigSync, resolveModel } from './config-yaml.js';

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
 * Generate claude-code-router config from role routing.
 *
 * @deprecated Kept for CLI compatibility with older CCR setup commands. The
 * role primitive owns model resolution; emitted router keys are role-based.
 */
export function generateRouterConfigFromWorkTypes(): RouterConfig {
  const { config } = loadConfigSync();
  const apiKeys = config.apiKeys;
  const enabledProviders = config.enabledProviders;

  const providers: Provider[] = [];
  const router: Record<string, RouterRule> = {};

  // Anthropic provider (always included - uses $ANTHROPIC_API_KEY env var)
  providers.push({
    name: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: '$ANTHROPIC_API_KEY',
    models: ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  });

  // OpenAI provider (only if enabled)
  if (enabledProviders.has('openai') && apiKeys.openai) {
    providers.push({
      name: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: apiKeys.openai.startsWith('$') ? apiKeys.openai : apiKeys.openai,
      models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    });
  }

  // Google provider (only if enabled)
  if (enabledProviders.has('google') && apiKeys.google) {
    providers.push({
      name: 'google',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: apiKeys.google.startsWith('$') ? apiKeys.google : apiKeys.google,
      models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
    });
  }

  for (const role of ['plan', 'work', 'review', 'test', 'ship', 'flywheel', 'strike', 'sequencer', 'knowledge'] as const) {
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
export function writeRouterConfigSync(config: RouterConfig): void {
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
