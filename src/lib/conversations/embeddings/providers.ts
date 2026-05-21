/**
 * Embedding providers for semantic search (PAN-457).
 *
 * Supported providers:
 *   openai  — text-embedding-3-small (default) via api.openai.com
 *   voyage  — voyage-code-3 via api.voyageai.com
 *   ollama  — configurable model via localhost:11434
 *
 * All providers return a normalized Float32Array.
 */

import { Data, Effect } from 'effect';
import { ConfigError } from '../../errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmbeddingProviderName = 'openai' | 'voyage' | 'ollama';

export interface EmbeddingResult {
  embedding: Float32Array;
  model: string;
  tokenCount?: number;
}

export interface EmbedOptions {
  text: string;
  model: string;
  baseUrl?: string;    // Ollama only
  apiKey?: string;     // Override env var
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class EmbedHttpError extends Data.TaggedError('EmbedHttpError')<{
  readonly provider: EmbeddingProviderName;
  readonly status: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Normalize a float array to unit length (L2 norm).
 * Returns the original if already zero.
 */
export function normalizeEmbedding(values: number[]): Float32Array {
  const arr = new Float32Array(values);
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return arr;
  for (let i = 0; i < arr.length; i++) arr[i] /= norm;
  return arr;
}

// ─── OpenAI provider ──────────────────────────────────────────────────────────

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

export function embedOpenAI(opts: EmbedOptions): Effect.Effect<EmbeddingResult, ConfigError | EmbedHttpError> {
  return Effect.gen(function* () {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return yield* Effect.fail(new ConfigError({ message: 'OPENAI_API_KEY is not set' }));
    }

    const resp = yield* Effect.tryPromise({
      try: () =>
        fetch(OPENAI_EMBED_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: opts.model,
            input: opts.text,
            encoding_format: 'float',
          }),
        }),
      catch: (cause) =>
        new EmbedHttpError({ provider: 'openai', status: 0, message: `Fetch failed: ${String(cause)}`, cause }),
    });

    if (!resp.ok) {
      const body = yield* Effect.tryPromise({
        try: () => resp.text(),
        catch: () => new EmbedHttpError({ provider: 'openai', status: resp.status, message: 'Failed to read error body' }),
      });
      return yield* Effect.fail(new EmbedHttpError({ provider: 'openai', status: resp.status, message: body.slice(0, 200) }));
    }

    const data = yield* Effect.tryPromise({
      try: () =>
        resp.json() as Promise<{
          data: Array<{ embedding: number[] }>;
          usage?: { total_tokens?: number };
        }>,
      catch: (cause) =>
        new EmbedHttpError({ provider: 'openai', status: resp.status, message: 'Failed to parse response JSON', cause }),
    });

    const embedding = normalizeEmbedding(data.data[0].embedding);
    return { embedding, model: opts.model, tokenCount: data.usage?.total_tokens };
  });
}

// ─── Voyage provider ──────────────────────────────────────────────────────────

const VOYAGE_EMBED_URL = 'https://api.voyageai.com/v1/embeddings';

export function embedVoyage(opts: EmbedOptions): Effect.Effect<EmbeddingResult, ConfigError | EmbedHttpError> {
  return Effect.gen(function* () {
    const apiKey = opts.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      return yield* Effect.fail(new ConfigError({ message: 'VOYAGE_API_KEY is not set' }));
    }

    const resp = yield* Effect.tryPromise({
      try: () =>
        fetch(VOYAGE_EMBED_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: opts.model,
            input: [opts.text],
          }),
        }),
      catch: (cause) =>
        new EmbedHttpError({ provider: 'voyage', status: 0, message: `Fetch failed: ${String(cause)}`, cause }),
    });

    if (!resp.ok) {
      const body = yield* Effect.tryPromise({
        try: () => resp.text(),
        catch: () => new EmbedHttpError({ provider: 'voyage', status: resp.status, message: 'Failed to read error body' }),
      });
      return yield* Effect.fail(new EmbedHttpError({ provider: 'voyage', status: resp.status, message: body.slice(0, 200) }));
    }

    const data = yield* Effect.tryPromise({
      try: () =>
        resp.json() as Promise<{
          data: Array<{ embedding: number[] }>;
          usage?: { total_tokens?: number };
        }>,
      catch: (cause) =>
        new EmbedHttpError({ provider: 'voyage', status: resp.status, message: 'Failed to parse response JSON', cause }),
    });

    const embedding = normalizeEmbedding(data.data[0].embedding);
    return { embedding, model: opts.model, tokenCount: data.usage?.total_tokens };
  });
}

// ─── Ollama provider ──────────────────────────────────────────────────────────

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

const SAFE_OLLAMA_HOST_RE = /^https?:\/\/(localhost|127(?:\.\d+){3}|::1)(:\d+)?\/?$/;

export function embedOllama(opts: EmbedOptions): Effect.Effect<EmbeddingResult, ConfigError | EmbedHttpError> {
  return Effect.gen(function* () {
    const baseUrl = opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
    if (!SAFE_OLLAMA_HOST_RE.test(baseUrl)) {
      return yield* Effect.fail(
        new ConfigError({ message: `Ollama baseUrl must be a localhost address (got: ${baseUrl})` }),
      );
    }
    const url = `${baseUrl.replace(/\/$/, '')}/api/embeddings`;

    const resp = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: opts.model, prompt: opts.text }),
        }),
      catch: (cause) =>
        new EmbedHttpError({ provider: 'ollama', status: 0, message: `Fetch failed: ${String(cause)}`, cause }),
    });

    if (!resp.ok) {
      const body = yield* Effect.tryPromise({
        try: () => resp.text(),
        catch: () => new EmbedHttpError({ provider: 'ollama', status: resp.status, message: 'Failed to read error body' }),
      });
      return yield* Effect.fail(new EmbedHttpError({ provider: 'ollama', status: resp.status, message: body.slice(0, 200) }));
    }

    const data = yield* Effect.tryPromise({
      try: () => resp.json() as Promise<{ embedding: number[] }>,
      catch: (cause) =>
        new EmbedHttpError({ provider: 'ollama', status: resp.status, message: 'Failed to parse response JSON', cause }),
    });

    const embedding = normalizeEmbedding(data.embedding);
    return { embedding, model: opts.model };
  });
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Call the appropriate embedding provider based on provider name.
 */
export function embed(
  provider: EmbeddingProviderName,
  opts: EmbedOptions,
): Effect.Effect<EmbeddingResult, ConfigError | EmbedHttpError> {
  switch (provider) {
    case 'openai': return embedOpenAI(opts);
    case 'voyage': return embedVoyage(opts);
    case 'ollama': return embedOllama(opts);
  }
}
