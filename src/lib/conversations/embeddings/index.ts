/**
 * Embedding engine for discovered sessions (PAN-457).
 *
 * Builds embedding text from a session's enriched metadata (summary, tags,
 * workspace path, tools used) and stores in session_embeddings as a Float32 BLOB.
 *
 * Integrates with the search composer for --semantic and --similar queries.
 */

import {
  findDiscoveredSessionIds,
  findEnrichedSessionIdsMissingEmbedding,
  getDiscoveredSessionById,
  insertEmbedding,
} from '../../database/discovered-sessions-db.js';
import type { DiscoveredSession } from '../../database/discovered-sessions-db.js';
import { runWithPool } from '../work-pool.js';
import { embed } from './providers.js';
import { getConversationsConfig } from '../../config-yaml.js';
import type { RuntimeConversationsConfig } from '../../config-yaml.js';
import type { EmbeddingProviderName } from './providers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmbedSessionsOptions {
  /** Session IDs to embed (default: all enriched sessions without embeddings) */
  sessionIds?: number[];
  /** Override provider from config */
  provider?: EmbeddingProviderName;
  /** Override model from config */
  model?: string;
  /** Override Ollama base URL */
  ollamaBaseUrl?: string;
  /** Max concurrent embedding tasks */
  maxParallel?: number;
  /** Replace existing embeddings instead of selecting only missing ones */
  regenerate?: boolean;
  /** Preloaded conversations config for dashboard callers */
  config?: RuntimeConversationsConfig;
  /** Injected embed function for testing */
  embedFn?: typeof embed;
  /** Progress callback */
  onProgress?: (progress: EmbedProgress) => void;
}

export interface EmbedProgress {
  processed: number;
  total: number;
  errors: number;
  elapsedMs: number;
  session?: {
    sessionId: number;
    model: string;
    success: boolean;
    error?: string;
  };
}

export interface EmbedResult {
  embedded: number;
  skipped: number;
  errors: number;
  durationMs: number;
  errorMessages?: string[];
}

// ─── Text builder ─────────────────────────────────────────────────────────────

/**
 * Build embedding input text from session metadata.
 * Combines enriched fields first (summary, tags) then structural metadata.
 */
export function buildEmbeddingText(session: DiscoveredSession): string {
  const parts: string[] = [];

  if (session.summary) parts.push(session.summary);
  if (session.summaryDetailed) parts.push(session.summaryDetailed);
  if (session.tags.length > 0) parts.push(`Tags: ${session.tags.join(', ')}`);
  if (session.workspacePath) parts.push(`Workspace: ${session.workspacePath}`);
  if (session.toolsUsed.length > 0) parts.push(`Tools: ${session.toolsUsed.join(', ')}`);
  if (session.primaryModel) parts.push(`Model: ${session.primaryModel}`);

  return parts.join('\n').trim();
}

// ─── Session selection ────────────────────────────────────────────────────────

function selectSessionIdsForEmbedding(
  sessionIds: number[] | undefined,
  model: string,
  regenerate: boolean,
): number[] {
  if (sessionIds && sessionIds.length > 0) return sessionIds;

  if (regenerate) return findDiscoveredSessionIds({ enriched: true });
  return findEnrichedSessionIdsMissingEmbedding(model);
}

// ─── Main embed function ──────────────────────────────────────────────────────

/**
 * Generate and store embeddings for discovered sessions.
 *
 * @param opts.sessionIds     Optional specific session IDs (default: unenriched sessions)
 * @param opts.provider       Embedding provider ('openai', 'voyage', 'ollama')
 * @param opts.model          Model name for the provider
 * @param opts.maxParallel    Max concurrent embedding tasks
 * @param opts.onProgress     Progress callback
 */
export async function embedSessions(opts: EmbedSessionsOptions = {}): Promise<EmbedResult> {
  const startTs = Date.now();
  const result: EmbedResult = { embedded: 0, skipped: 0, errors: 0, durationMs: 0, errorMessages: [] };

  const config = opts.config ?? getConversationsConfig();
  const provider = (opts.provider ?? config.embeddingProvider) as EmbeddingProviderName;
  const providerDefaultModel = provider === 'voyage' ? 'voyage-code-3' : provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small';
  const model = opts.model ?? (opts.provider || provider !== config.embeddingProvider ? providerDefaultModel : config.embeddingModel);
  const maxParallel = opts.maxParallel ?? config.enrichment.maxParallel;
  const embedFn = opts.embedFn ?? embed;

  const sessionIds = selectSessionIdsForEmbedding(opts.sessionIds, model, opts.regenerate === true);

  if (sessionIds.length === 0) {
    result.durationMs = Date.now() - startTs;
    return result;
  }

  let processed = 0;
  const total = sessionIds.length;

  const tasks = sessionIds.map((sessionId) => async () => {
    const emitProgress = (success: boolean, error?: string) => {
      processed++;
      opts.onProgress?.({
        processed,
        total,
        errors: result.errors,
        elapsedMs: Date.now() - startTs,
        session: {
          sessionId,
          model,
          success,
          error,
        },
      });
    };

    const session = getDiscoveredSessionById(sessionId);
    if (!session) {
      result.skipped++;
      emitProgress(false, 'Session not found');
      return;
    }

    const text = buildEmbeddingText(session);
    if (!text.trim()) {
      result.skipped++;
      emitProgress(false, 'No embedding text available');
      return;
    }

    try {
      const embedResult = await embedFn(provider, {
        text,
        model,
        baseUrl: opts.ollamaBaseUrl,
        apiKey: provider === 'ollama' ? undefined : config.apiKeys?.[provider],
      });

      insertEmbedding(session.id, model, embedResult.embedding);
      result.embedded++;
      emitProgress(true);
    } catch (err) {
      result.errors++;
      const message = err instanceof Error ? err.message : String(err);
      if (result.errorMessages && result.errorMessages.length < 5 && !result.errorMessages.includes(message)) {
        result.errorMessages.push(message);
      }
      emitProgress(false, message);
    }
  });

  await runWithPool(tasks, maxParallel);
  result.durationMs = Date.now() - startTs;
  return result;
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { embed, embedOpenAI, embedVoyage, embedOllama, normalizeEmbedding } from './providers.js';
export type { EmbeddingProviderName, EmbeddingResult, EmbedOptions } from './providers.js';
