import { loadConfigSync } from './config-yaml.js';
import { getKimiAnthropicBaseUrl, resolveKimiModelForEndpoint } from './providers.js';

/** Resolve only Claude's wire ID; stored IDs and other harness catalogs stay intact. */
export function getClaudeCodeLaunchModelSync(model: string): string {
  if (model !== 'kimi-k2.7-code') return model;
  const apiKey = loadConfigSync().config.apiKeys.kimi;
  return apiKey ? resolveKimiModelForEndpoint(model, getKimiAnthropicBaseUrl(apiKey)) : model;
}
