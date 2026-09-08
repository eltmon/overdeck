/** Model picker catalog, including installed OpenCode Go and Zen models. */
import type { ModelId } from './settings.js';
import type { RuntimeName } from './runtimes/types.js';
import { MODEL_CAPABILITIES, MODEL_DEPRECATIONS } from './model-capabilities.js';
import { discoverOpenCodeModels } from './opencode-models.js';

type AvailableModel = {
  id: ModelId;
  name: string;
  costPer1MTokens: number;
  /** Native catalog rows carry the harness required to launch that model ID. */
  harness?: RuntimeName;
  /** Effort levels the row's harness actually offers. */
  effortLevels?: readonly string[];
  /** Display name without any harness suffix — pickers compose row labels from it. */
  baseName?: string;
};
type AvailableModelsApi = Record<'anthropic' | 'openai' | 'google' | 'minimax' | 'zai' | 'kimi' | 'mimo' | 'openrouter' | 'nous' | 'dashscope' | 'opencode' | 'opencode-go', AvailableModel[]>;

function annotateKimiAvailableModel(modelId: string, entry: AvailableModel, effortLevels: readonly string[] | undefined): AvailableModel {
  if (modelId.startsWith('kimi-code/')) {
    return {
      ...entry,
      name: `${entry.name} — Kimi Code CLI`,
      baseName: entry.name,
      harness: 'kimi-code',
      effortLevels,
    };
  }
  return {
    ...entry,
    baseName: entry.name,
    harness: 'claude-code',
    effortLevels,
  };
}

export function getAvailableModelsApi(openCodeModels: readonly AvailableModel[] = []): AvailableModelsApi {
  const result: AvailableModelsApi = {
    anthropic: [],
    openai: [],
    google: [],
    minimax: [],
    zai: [],
    kimi: [],
    mimo: [],
    openrouter: [],
    nous: [],
    dashscope: [],
    opencode: openCodeModels.filter((model) => model.id.startsWith('opencode/')),
    'opencode-go': openCodeModels.filter((model) => model.id.startsWith('opencode-go/')),
  };

  for (const [modelId, capability] of Object.entries(MODEL_CAPABILITIES)) {
    // Skip deprecated models — they should not appear in user-facing pickers.
    // MODEL_DEPRECATIONS is the single source of truth for "this model has
    // been retired and remapped to a current one"; capability entries are kept
    // for back-compat (cost/capability lookups for old configs and historical
    // conversations), but they must not surface in dropdowns.
    if (capability.displayName.includes('(deprecated)')) continue;
    if (modelId in MODEL_DEPRECATIONS) continue;
    const entry = { id: modelId as ModelId, name: capability.displayName, costPer1MTokens: capability.costPer1MTokens };
    const annotated = capability.provider === 'kimi' ? annotateKimiAvailableModel(modelId, entry, capability.effortLevels) : entry;
    switch (capability.provider) {
      case 'anthropic':
        result.anthropic.push(annotated);
        break;
      case 'openai':
        result.openai.push(annotated);
        break;
      case 'google':
        result.google.push(annotated);
        break;
      case 'kimi':
        result.kimi.push(annotated);
        break;
      case 'minimax':
        result.minimax.push(annotated);
        break;
      case 'zai':
        result.zai.push(annotated);
        break;
      case 'mimo':
        result.mimo.push(annotated);
        break;
      case 'openrouter':
        result.openrouter.push(annotated);
        break;
      case 'nous':
        result.nous.push(annotated);
        break;
      case 'dashscope':
        result.dashscope.push(annotated);
        break;
    }
  }

  // Order OpenAI models with latest family first: gpt-6-astra → 5.6-sol (current default) → 5.6-terra → 5.6-luna → 5.5 → 5.4 → 5.3-codex → 5.2 → o-series → gpt-4o legacy.
  const openaiOrder: Record<string, number> = {
    'gpt-6-astra': 0,
    'gpt-5.6-sol': 1, 'gpt-5.6-terra': 2, 'gpt-5.6-luna': 3,
    'gpt-5.5': 10, 'gpt-5.5-pro': 11,
    'gpt-5.4': 20, 'gpt-5.4-pro': 21, 'gpt-5.4-mini': 22,
    'gpt-5.3-codex': 30,
    'gpt-5.2': 40,
    'o3': 50, 'o4-mini': 51,
    'gpt-4o': 60, 'gpt-4o-mini': 61,
  };
  result.openai.sort((a, b) => (openaiOrder[a.id] ?? 99) - (openaiOrder[b.id] ?? 99));

  return result;
}


export async function getAvailableModelsWithOpenCodeApi(): Promise<AvailableModelsApi> {
  const models = await discoverOpenCodeModels().catch((error) => {
    console.warn('[settings] OpenCode model discovery failed:', error instanceof Error ? error.message : String(error));
    return [];
  });
  return getAvailableModelsApi(models);
}
