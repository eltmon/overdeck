/**
 * Embedding providers for semantic search (PAN-457).
 *
 * Supported providers:
 *   openai  — text-embedding-3-small (default) via api.openai.com
 *   voyage  — voyage-3-lite via api.voyageai.com
 *   ollama  — configurable model via localhost:11434
 *
 * All providers return a normalized Float32Array.
 */

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

export async function embedOpenAI(opts: EmbedOptions): Promise<EmbeddingResult> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const resp = await fetch(OPENAI_EMBED_URL, {
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
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI embed error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };

  const embedding = normalizeEmbedding(data.data[0].embedding);
  return {
    embedding,
    model: opts.model,
    tokenCount: data.usage?.total_tokens,
  };
}

// ─── Voyage provider ──────────────────────────────────────────────────────────

const VOYAGE_EMBED_URL = 'https://api.voyageai.com/v1/embeddings';

export async function embedVoyage(opts: EmbedOptions): Promise<EmbeddingResult> {
  const apiKey = opts.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not set');

  const resp = await fetch(VOYAGE_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      input: [opts.text],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Voyage embed error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };

  const embedding = normalizeEmbedding(data.data[0].embedding);
  return {
    embedding,
    model: opts.model,
    tokenCount: data.usage?.total_tokens,
  };
}

// ─── Ollama provider ──────────────────────────────────────────────────────────

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

const SAFE_OLLAMA_HOST_RE = /^https?:\/\/(localhost|127(?:\.\d+){3}|::1)(:\d+)?\/?$/;

export async function embedOllama(opts: EmbedOptions): Promise<EmbeddingResult> {
  const baseUrl = opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  if (!SAFE_OLLAMA_HOST_RE.test(baseUrl)) {
    throw new Error(`Ollama baseUrl must be a localhost address (got: ${baseUrl})`);
  }
  const url = `${baseUrl.replace(/\/$/, '')}/api/embeddings`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, prompt: opts.text }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Ollama embed error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { embedding: number[] };
  const embedding = normalizeEmbedding(data.embedding);
  return { embedding, model: opts.model };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Call the appropriate embedding provider based on provider name.
 */
export async function embed(
  provider: EmbeddingProviderName,
  opts: EmbedOptions,
): Promise<EmbeddingResult> {
  switch (provider) {
    case 'openai': return embedOpenAI(opts);
    case 'voyage': return embedVoyage(opts);
    case 'ollama': return embedOllama(opts);
  }
}
