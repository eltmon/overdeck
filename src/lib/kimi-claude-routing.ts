import { loadConfigSync } from './config-yaml.js';
import { KIMI_PLATFORM_MODEL_IDS, getKimiAnthropicBaseUrl, resolveKimiModelForEndpoint } from './providers.js';

/** Resolve only Claude's wire ID; stored IDs and other harness catalogs stay intact. */
export function getClaudeCodeLaunchModel(model: string): string {
  // Ids whose Claude Code wire id depends on the selected Kimi endpoint. Computed
  // per call (not module scope) so a test's partial providers.js mock — one that
  // omits KIMI_PLATFORM_MODEL_IDS — doesn't throw merely by importing this module.
  const endpointSpecificKimiModels = new Set(['kimi-k2.7-code', ...Object.keys(KIMI_PLATFORM_MODEL_IDS ?? {})]);
  if (!endpointSpecificKimiModels.has(model)) return model;
  const apiKey = loadConfigSync().config.apiKeys.kimi;
  return apiKey ? resolveKimiModelForEndpoint(model, getKimiAnthropicBaseUrl(apiKey)) : model;
}
