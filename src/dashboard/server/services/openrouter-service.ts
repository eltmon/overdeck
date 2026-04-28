/**
 * OpenRouter Service
 *
 * Handles OpenRouter model discovery, API key validation, and model caching.
 * Fetches the full model catalog from the OpenRouter API and caches it in memory.
 */

import { Effect, Layer, Context } from 'effect';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface OpenRouterModel {
  /** Model identifier (e.g., "qwen/qwen3.6-plus:free") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Cost per 1M prompt tokens in USD (0 for free models) */
  readonly promptCostPer1M: number;
  /** Cost per 1M completion tokens in USD (0 for free models) */
  readonly completionCostPer1M: number;
  /** Maximum context window in tokens */
  readonly contextLength: number;
  /** Whether this model supports thinking/extended reasoning */
  readonly supportsThinking: boolean;
  /** Category hint for UI filtering */
  readonly category: 'free' | 'chat' | 'code' | 'other';
  /** Top provider name (e.g., "Qwen", "Anthropic") */
  readonly topProvider?: string;
}

export interface ApiKeyValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

// ─── Cache types ──────────────────────────────────────────────────────────────

interface ModelCache {
  readonly models: OpenRouterModel[];
  readonly fetchedAt: number;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface OpenRouterServiceShape {
  /**
   * Fetch available models from OpenRouter API.
   * Results are cached in memory with a 5-minute TTL.
   */
  readonly fetchModels: () => Effect.Effect<OpenRouterModel[], never>;

  /**
   * Validate an OpenRouter API key by making a lightweight authenticated request.
   * Returns success/error without throwing.
   */
  readonly validateApiKey: (apiKey: string) => Effect.Effect<ApiKeyValidationResult, never>;

  /**
   * Get model capabilities for a specific model ID.
   * Returns null if the model is not found in the cached list.
   */
  readonly getModelCapabilities: (modelId: string) => Effect.Effect<OpenRouterModel | null, never>;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class OpenRouterService extends Context.Service<
  OpenRouterService,
  OpenRouterServiceShape
>()('panopticon/dashboard/OpenRouterService') {}

// ─── Cache TTL ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Classify a model into a category based on its ID and name.
 */
function classifyModel(id: string, name: string): OpenRouterModel['category'] {
  const lower = `${id} ${name}`.toLowerCase();

  // Free models
  if (id.endsWith(':free') || lower.includes('free')) {
    return 'free';
  }

  // Code-focused models
  if (
    lower.includes('code') ||
    lower.includes('coder') ||
    lower.includes('codex') ||
    lower.includes('deepseek-coder') ||
    lower.includes('starcoder')
  ) {
    return 'code';
  }

  return 'chat';
}

/**
 * Determine if a model supports thinking/extended reasoning.
 * Based on model metadata architecture.modality and model name patterns.
 */
function detectThinkingSupport(raw: Record<string, unknown>): boolean {
  const architecture = raw['architecture'] as Record<string, unknown> | undefined;
  if (architecture) {
    const modality = architecture['modality'] as string | undefined;
    if (typeof modality === 'string' && modality.includes('text+reasoning')) return true;
  }

  const id = (raw['id'] as string ?? '').toLowerCase();
  const name = (raw['name'] as string ?? '').toLowerCase();

  return (
    id.includes('thinking') ||
    id.includes('r1') ||
    name.includes('thinking') ||
    name.includes('extended thinking') ||
    id.includes('qwq') ||
    id.includes('deepseek-r1')
  );
}

/**
 * Parse a raw OpenRouter model response into our typed model.
 */
function parseModel(raw: Record<string, unknown>): OpenRouterModel | null {
  const id = raw['id'] as string;
  const name = (raw['name'] as string) ?? id;
  if (!id) return null;

  const pricing = (raw['pricing'] as Record<string, string> | undefined) ?? {};
  const promptCostPer1M = parseFloat(pricing['prompt'] ?? '0') * 1_000_000;
  const completionCostPer1M = parseFloat(pricing['completion'] ?? '0') * 1_000_000;
  const contextLength = (raw['context_length'] as number) ?? 4096;
  const supportsThinking = detectThinkingSupport(raw);
  const category = classifyModel(id, name);

  // Extract provider display name from model ID (e.g., "qwen/..." -> "Qwen")
  const providerSlug = id.split('/')[0] ?? '';
  const providerDisplay = providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1);

  return {
    id,
    name,
    promptCostPer1M,
    completionCostPer1M,
    contextLength,
    supportsThinking,
    category,
    topProvider: providerDisplay || undefined,
  };
}

// ─── Live layer ───────────────────────────────────────────────────────────────

export const OpenRouterServiceLive = Layer.effect(
  OpenRouterService,
  Effect.sync(() => {
    let cache: ModelCache | null = null;

    async function fetchModelsFromApi(): Promise<OpenRouterModel[]> {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter models API returned ${response.status}`);
      }

      const json = await response.json() as { data?: unknown[] };
      const rawModels = Array.isArray(json.data) ? json.data : [];

      const models: OpenRouterModel[] = [];
      for (const raw of rawModels) {
        const parsed = parseModel(raw as Record<string, unknown>);
        if (parsed) models.push(parsed);
      }

      return models;
    }

    function isCacheValid(): boolean {
      return cache !== null && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
    }

    return {
      fetchModels: () =>
        Effect.tryPromise({
          try: async () => {
            if (isCacheValid()) {
              return cache!.models;
            }

            const models = await fetchModelsFromApi();
            cache = { models, fetchedAt: Date.now() };
            return models;
          },
          catch: (err) => {
            console.error('[openrouter-service] Failed to fetch models:', err);
            // Return cached data if available, empty array otherwise
            return err; // This will be caught as error — we handle below
          },
        }).pipe(
          Effect.catch((_err) =>
            Effect.sync(() => cache?.models ?? [])
          )
        ),

      validateApiKey: (apiKey: string) =>
        Effect.tryPromise({
          try: async (): Promise<ApiKeyValidationResult> => {
            // Use the generations endpoint to validate the key
            const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
              },
            });

            if (response.ok) {
              return { valid: true };
            }

            if (response.status === 401) {
              return { valid: false, error: 'Invalid API key' };
            }

            return { valid: false, error: `Unexpected response: ${response.status}` };
          },
          catch: (err) => err,
        }).pipe(
          Effect.catch((err) =>
            Effect.sync((): ApiKeyValidationResult => ({
              valid: false,
              error: err instanceof Error ? err.message : 'Network error',
            }))
          )
        ),

      getModelCapabilities: (modelId: string) =>
        Effect.tryPromise({
          try: async (): Promise<OpenRouterModel | null> => {
            if (isCacheValid()) {
              return cache!.models.find((m) => m.id === modelId) ?? null;
            }

            const models = await fetchModelsFromApi();
            cache = { models, fetchedAt: Date.now() };
            return models.find((m) => m.id === modelId) ?? null;
          },
          catch: (err) => err,
        }).pipe(
          Effect.catch((_err) =>
            Effect.sync(() => cache?.models.find((m) => m.id === modelId) ?? null)
          )
        ),
    };
  })
);
