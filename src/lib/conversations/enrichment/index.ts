/**
 * Bulk enrichment engine (PAN-457).
 *
 * Orchestrates L1/L2/L3 enrichment for discovered sessions:
 *   - Filters sessions needing enrichment at the requested tier
 *   - Estimates API cost before running
 *   - Runs via bounded work pool for parallelism
 *   - Reports progress via optional callback
 */

import { findDiscoveredSessions, getDiscoveredSessionById } from '../../database/discovered-sessions-db.js';
import type { ConversationFilter, DiscoveredSession } from '../../database/discovered-sessions-db.js';
import { runWithPool } from '../work-pool.js';
import { enrichSession } from './enrich-session.js';
import { embedSessions } from '../embeddings/index.js';
import type { EnrichSessionOptions } from './enrich-session.js';
import { getConversationsConfig } from '../../config-yaml.js';
import type { RuntimeConversationsConfig } from '../../config-yaml.js';
import type { EnrichmentTier } from './model-fallback.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnrichOptions {
  /** Enrichment tier to apply (default: 1) */
  tier?: EnrichmentTier;
  /** Specific session IDs to enrich (default: all not yet enriched at tier) */
  sessionIds?: number[];
  /** Maximum concurrent enrichment tasks */
  maxParallel?: number;
  /** Structured filter used when sessionIds is omitted */
  filter?: ConversationFilter;
  /** Cap selected sessions after filtering */
  limit?: number;
  /** If true, skip sessions already enriched at this tier or higher */
  skipAlreadyEnriched?: boolean;
  /** If true, bypass the cost confirmation threshold */
  force?: boolean;
  /** Override the model used for enrichment (ignores tier-based model selection) */
  modelOverride?: string;
  /** Append custom text to the enrichment prompt */
  promptSuffix?: string;
  /** Read every JSONL line for literal full-transcript enrichment */
  fullTranscript?: boolean;
  /** Injected API caller for testing */
  callApi?: EnrichSessionOptions['callApi'];
  /** Preloaded conversations config for dashboard callers */
  config?: RuntimeConversationsConfig;
  /** Progress callback */
  onProgress?: (progress: EnrichProgress) => void | Promise<void>;
}

export interface EnrichProgress {
  processed: number;
  total: number;
  errors: number;
  elapsedMs: number;
  /** Per-session details for the session that just completed (optional) */
  session?: {
    sessionId: number;
    tier: EnrichmentTier;
    model: string;
    cost?: number;
    success: boolean;
    error?: string;
  };
}

export interface EnrichResult {
  enriched: number;
  skipped: number;
  errors: number;
  durationMs: number;
  estimatedCost: number;
  actualCost: number | null;
  embedded: number;
}

// ─── Cost estimation ──────────────────────────────────────────────────────────

/**
 * Rough cost estimate for enrichment batch.
 * Assumes ~500 input tokens per session + ~200 output tokens at Sonnet rate.
 * Used only for the cost confirmation threshold check.
 */
export function estimateEnrichmentCost(sessionCount: number, tier: EnrichmentTier): number {
  // Approximate token counts per session per tier
  const inputTokens = tier === 1 ? 300 : tier === 2 ? 700 : 2000;
  const outputTokens = tier === 1 ? 150 : tier === 2 ? 300 : 600;
  // Approximate cost per 1M tokens (blended input/output)
  const costPer1M = tier === 1 ? 0.80 : 3.00; // Haiku vs Sonnet
  return ((inputTokens + outputTokens) * sessionCount * costPer1M) / 1_000_000;
}

// ─── Session selection ────────────────────────────────────────────────────────

function selectSessionsForEnrichment(
  opts: EnrichOptions,
  tier: EnrichmentTier,
): DiscoveredSession[] {
  if (opts.sessionIds && opts.sessionIds.length > 0) {
    // Explicit session list
    return opts.sessionIds
      .map((id) => getDiscoveredSessionById(id))
      .filter((s): s is DiscoveredSession => s != null);
  }

  const baseFilter = opts.filter ?? {};
  const limited = (sessions: DiscoveredSession[]) =>
    opts.limit !== undefined ? sessions.slice(0, Math.max(0, opts.limit)) : sessions;

  const skipAlready = opts.skipAlreadyEnriched !== false; // default true
  if (skipAlready) {
    return limited(findDiscoveredSessions({ ...baseFilter, enrichmentLevelLessThan: tier }));
  }

  return limited(findDiscoveredSessions(baseFilter));
}

// ─── Main bulk enrichment ─────────────────────────────────────────────────────

/**
 * Enrich discovered sessions at the specified tier.
 *
 * @param opts.tier               1=quick/Haiku, 2=detailed/Sonnet, 3=deep/configurable
 * @param opts.sessionIds         Optional specific session IDs (default: all not enriched)
 * @param opts.maxParallel        Override parallelism (default: from config)
 * @param opts.skipAlreadyEnriched Skip sessions already at this tier or higher (default: true)
 * @param opts.onProgress         Progress callback
 */
export async function enrichSessions(opts: EnrichOptions = {}): Promise<EnrichResult> {
  const startTs = Date.now();
  const result: EnrichResult = { enriched: 0, skipped: 0, errors: 0, durationMs: 0, estimatedCost: 0, actualCost: null, embedded: 0 };

  const tier = opts.tier ?? 1;
  const config = opts.config ?? getConversationsConfig();
  const tierConfig = {
    quickModel: config.enrichment.quickModel,
    deepModel: config.enrichment.deepModel,
  };
  const maxParallel = opts.maxParallel ?? config.enrichment.maxParallel;

  // Select sessions to enrich
  const sessions = selectSessionsForEnrichment(opts, tier);

  if (sessions.length === 0) {
    result.durationMs = Date.now() - startTs;
    return result;
  }

  // Cost gate: check against threshold
  const estimatedCost = estimateEnrichmentCost(sessions.length, tier);
  result.estimatedCost = estimatedCost;
  const threshold = config.enrichment.costConfirmThreshold;
  if (estimatedCost > threshold && !opts.force) {
    // Callers can check the threshold themselves before calling.
    // We throw to make the gate explicit — CLI will catch and prompt user.
    throw new CostThresholdError(estimatedCost, threshold, sessions.length);
  }

  let processed = 0;
  let actualCost = 0;
  let actualCostCount = 0;
  const total = sessions.length;
  const enrichedIds: number[] = [];

  const taskStates = sessions.map((session) => ({ session, accounted: false }));
  const tasks = taskStates.map((state) => async () => {
    const { session } = state;
    const sessionResult = await enrichSession({
      sessionId: session.id,
      jsonlPath: session.jsonlPath,
      tier,
      modelOverride: opts.modelOverride,
      promptSuffix: opts.promptSuffix,
      fullTranscript: opts.fullTranscript,
      config: tierConfig,
      callApi: opts.callApi,
    });

    processed++;
    state.accounted = true;
    if (sessionResult.error) {
      result.errors++;
    } else {
      result.enriched++;
      enrichedIds.push(session.id);
      if (sessionResult.cost !== undefined) {
        actualCost += sessionResult.cost;
        actualCostCount++;
      }
    }

    try {
      await opts.onProgress?.({
        processed,
        total,
        errors: result.errors,
        elapsedMs: Date.now() - startTs,
        session: {
          sessionId: session.id,
          tier,
          model: sessionResult.model,
          cost: sessionResult.error ? undefined : sessionResult.cost ?? estimateEnrichmentCost(1, tier),
          success: !sessionResult.error,
          error: sessionResult.error,
        },
      });
    } catch {
      result.errors++;
    }
  });

  const taskResults = await runWithPool(tasks, maxParallel);
  for (let i = 0; i < taskResults.length; i++) {
    const taskResult = taskResults[i];
    if (!(taskResult instanceof Error)) continue;
    const state = taskStates[i];
    if (!state.accounted) {
      processed++;
      result.errors++;
    }
  }

  if (tier >= 2 && config.embeddings && config.embeddingAutoOnDeep) {
    if (enrichedIds.length > 0) {
      const embedded = await embedSessions({ sessionIds: enrichedIds, config });
      result.embedded = embedded.embedded;
    }
  }

  result.actualCost = actualCostCount > 0 ? actualCost : null;
  result.durationMs = Date.now() - startTs;
  return result;
}

// ─── Cost threshold error ─────────────────────────────────────────────────────

export class CostThresholdError extends Error {
  constructor(
    public readonly estimatedCost: number,
    public readonly threshold: number,
    public readonly sessionCount: number,
  ) {
    super(
      `Estimated enrichment cost $${estimatedCost.toFixed(4)} exceeds threshold $${threshold.toFixed(2)} for ${sessionCount} sessions`,
    );
    this.name = 'CostThresholdError';
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { enrichSession, callClaudeApi } from './enrich-session.js';
export { selectModelForTier, maxMessagesForTier } from './model-fallback.js';
export type { EnrichmentTier, TierConfig } from './model-fallback.js';
