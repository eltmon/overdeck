/**
 * Model picker catalog, including installed OpenCode Go and Zen models, signed-in Grok Build
 * models, and "— Antigravity" rows for Google models when agy is installed with a credential.
 */
import { getHarnessBehavior } from '@overdeck/contracts';
import { GROK_BUILD_MODELS, type ModelId } from './settings.js';
import type { RuntimeName } from './runtimes/types.js';
import { MODEL_CAPABILITIES, MODEL_DEPRECATIONS } from './model-capabilities.js';
import { discoverOpenCodeModels } from './opencode-models.js';
import { resolveHarnessBinary } from './harness-binary.js';
import { readGrokSignIn } from './grok-sign-in.js';
import { readAntigravityAuthStatus } from './antigravity-auth.js';
import { isAntigravityModel } from './antigravity-models.js';

type AvailableModel = {
  id: ModelId;
  name: string;
  costPer1MTokens: number;
  contextWindow?: number;
  /** Native catalog rows carry the harness required to launch that model ID. */
  harness?: RuntimeName;
  /** Effort levels the row's harness actually offers. */
  effortLevels?: readonly string[];
  /** Display name without any harness suffix — pickers compose row labels from it. */
  baseName?: string;
};
type AvailableModelsApi = Record<'anthropic' | 'openai' | 'google' | 'minimax' | 'zai' | 'kimi' | 'mimo' | 'openrouter' | 'nous' | 'dashscope' | 'meta' | 'opencode' | 'opencode-go' | 'grok', AvailableModel[]>;

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

export function getAvailableModelsApi(openCodeModels: readonly AvailableModel[] = [], grokModels: readonly AvailableModel[] = []): AvailableModelsApi {
  const result: AvailableModelsApi = {
    opencode: openCodeModels.filter((model) => model.id.startsWith('opencode/')),
    'opencode-go': openCodeModels.filter((model) => model.id.startsWith('opencode-go/')),
    grok: [...grokModels],
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
    meta: [],
  };

  for (const [modelId, capability] of Object.entries(MODEL_CAPABILITIES)) {
    // Retain historical capabilities, but expose only active selections.
    if (capability.displayName.includes('(deprecated)')) continue;
    if (modelId in MODEL_DEPRECATIONS) continue;
    const contextWindow = capability.contextWindow;
    const name = capability.displayName.replace(/\s*\(?[\d.]+[KM]\)?$/, '');
    const contextLabel = contextWindow === 1_048_576 ? '1M' : contextWindow === 262_144 ? '256K' : contextWindow >= 1_000_000 ? `${Number((contextWindow / 1_000_000).toFixed(3))}M` : `${Number((contextWindow / 1000).toFixed(3))}K`;
    const entry = { id: modelId as ModelId, name: `${name} (${contextLabel} context)`, contextWindow, effortLevels: capability.effortLevels, costPer1MTokens: capability.costPer1MTokens };
    const annotated = capability.provider === 'kimi' ? annotateKimiAvailableModel(modelId, entry, capability.effortLevels) : entry;
    switch (capability.provider) {
      case 'meta':
        result.meta.push({ ...entry, harness: 'muse', effortLevels: capability.effortLevels });
        break;
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

  // Order OpenAI models with latest family first: gpt-6.2-astra → 6.2-sol → 6-astra → 6.1-sol → 6.1-terra → 6-sol → 6-luna → 5.6-sol (current default) → 5.6-terra → 5.6-luna → 6-astra-law → 6-rosalind (domain models) → 5.5 → 5.4 → 5.3-codex → 5.2 → o-series → gpt-4o legacy.
  const openaiOrder: Record<string, number> = {
    'gpt-6.2-astra': 0, 'gpt-6.2-sol': 1,
    'gpt-6-astra': 2, 'gpt-6.1-sol': 3, 'gpt-6.1-terra': 4, 'gpt-6-sol': 5, 'gpt-6-luna': 6,
    'gpt-5.6-sol': 7, 'gpt-5.6-terra': 8, 'gpt-5.6-luna': 9, 'gpt-6-astra-law': 10, 'gpt-6-rosalind': 11,
    'gpt-5.5': 12, 'gpt-5.5-pro': 13,
    'gpt-5.4': 20, 'gpt-5.4-pro': 21, 'gpt-5.4-mini': 22,
    'gpt-5.3-codex': 30,
    'gpt-5.2': 40,
    'o3': 50, 'o4-mini': 51,
    'gpt-4o': 60, 'gpt-4o-mini': 61,
  };
  result.openai.sort((a, b) => (openaiOrder[a.id] ?? 99) - (openaiOrder[b.id] ?? 99));

  return result;
}

/** Grok Build models appear only when the grok CLI is installed and signed in (PAN-5078 D8). */
async function availableGrokModels(): Promise<AvailableModel[]> {
  try {
    if (!await resolveHarnessBinary('grok')) return [];
    if (!(await readGrokSignIn()).signedIn) return [];
  } catch (error) {
    console.warn('[settings] Grok Build availability check failed:', error instanceof Error ? error.message : String(error));
    return [];
  }
  return GROK_BUILD_MODELS.map((id) => {
    const capability = MODEL_CAPABILITIES[id];
    return {
      id,
      name: capability.displayName,
      baseName: capability.displayName,
      costPer1MTokens: capability.costPer1MTokens,
      contextWindow: capability.contextWindow,
      harness: 'grok',
      effortLevels: capability.effortLevels,
    };
  });
}

/**
 * One "— Antigravity" row per Google row agy serves, only when the agy CLI is installed and a
 * Gemini API key or Agent Platform credential is ready (PAN-5587 D13). Plain Google rows stay.
 */
async function antigravityRows(google: readonly AvailableModel[]): Promise<AvailableModel[]> {
  try {
    if (!await resolveHarnessBinary('antigravity')) return [];
    if (!(await readAntigravityAuthStatus()).ready) return [];
  } catch (error) {
    console.warn('[settings] Antigravity availability check failed:', error instanceof Error ? error.message : String(error));
    return [];
  }
  const antigravityLevels: readonly string[] = getHarnessBehavior('antigravity').effortLevels ?? [];
  return google.filter((row) => isAntigravityModel(row.id)).map((row) => ({
    ...row,
    name: `${row.baseName ?? row.name} — Antigravity`,
    baseName: row.baseName ?? row.name,
    harness: 'antigravity',
    // A row without capability levels gets the harness levels: [] would mean "no adjustable effort".
    effortLevels: row.effortLevels ? row.effortLevels.filter((level) => antigravityLevels.includes(level)) : [...antigravityLevels],
  }));
}

export async function getAvailableModelsWithOpenCodeApi(): Promise<AvailableModelsApi> {
  const [models, grokModels] = await Promise.all([
    discoverOpenCodeModels().catch((error) => {
      console.warn('[settings] OpenCode model discovery failed:', error instanceof Error ? error.message : String(error));
      return [];
    }),
    availableGrokModels(),
  ]);
  const result = getAvailableModelsApi(models, grokModels);
  result.google.push(...await antigravityRows(result.google));
  return result;
}
