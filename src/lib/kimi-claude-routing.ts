import { loadConfigSync } from './config-yaml.js';
import { KIMI_PLATFORM_MODEL_IDS, getKimiAnthropicBaseUrl, resolveKimiModelForEndpoint } from './providers.js';

/** Ids whose Claude Code wire id depends on the selected Kimi endpoint. */
const ENDPOINT_SPECIFIC_KIMI_MODELS = new Set(['kimi-k2.7-code', ...Object.keys(KIMI_PLATFORM_MODEL_IDS)]);

/** Resolve only Claude's wire ID; stored IDs and other harness catalogs stay intact. */
export function getClaudeCodeLaunchModel(model: string): string {
  if (!ENDPOINT_SPECIFIC_KIMI_MODELS.has(model)) return model;
  const apiKey = loadConfigSync().config.apiKeys.kimi;
  return apiKey ? resolveKimiModelForEndpoint(model, getKimiAnthropicBaseUrl(apiKey)) : model;
}
