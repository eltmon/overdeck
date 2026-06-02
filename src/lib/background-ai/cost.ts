/**
 * Background AI cost capture (PAN-1583).
 *
 * Before this module, background model calls recorded their token spend
 * inconsistently: memory extraction and enrichment computed cost, while the
 * TTS summarizer captured nothing and the `claude -p` title/compaction spawns
 * discarded their usage block. Those calls were invisible to the cost ledger.
 *
 * `recordBackgroundAiCost()` is the single seam every background caller routes
 * its usage through. It computes USD cost from the model's pricing table and
 * appends a `CostEvent` tagged `background:<feature>` so background spend shows
 * up in the same ledger as pipeline-agent spend, broken out by source.
 *
 * Background calls have no agent or issue, so synthetic identifiers are used:
 *   agentId = 'background', issueId = 'background'.
 */

import { appendCostEventSync, type CostEvent } from '../costs/events.js';
import { calculateCostSync, getPricingSync, type AIProvider, type TokenUsage } from '../cost.js';
import type { BackgroundAiFeature } from './features.js';

export const BACKGROUND_COST_AGENT_ID = 'background';
export const BACKGROUND_COST_ISSUE_ID = 'background';

export interface RecordBackgroundAiCostInput {
  /** Which background feature spent the tokens. */
  feature: BackgroundAiFeature;
  /** Provider that served the request (defaults to 'anthropic'). */
  provider?: AIProvider;
  /** Model that served the request. */
  model: string;
  /** Token usage for the call. */
  usage: TokenUsage;
  /**
   * Pre-computed cost in USD. When provided it is used verbatim (e.g. when the
   * provider returned a cost). Otherwise cost is derived from the pricing
   * table; if the model is unpriced the cost is recorded as 0.
   */
  costUsd?: number;
  /** Optional ISO timestamp (defaults to now). */
  ts?: string;
  /** Optional request id for dedup. */
  requestId?: string;
}

/** The cost-source tag prefix used for every background AI event. */
export function backgroundCostSource(feature: BackgroundAiFeature): string {
  return `background:${feature}`;
}

/**
 * Record the token spend of a single background AI call. Best-effort: never
 * throws into the caller's hot path (a failure to record cost must not break
 * the feature). Returns the computed cost in USD (0 when unpriced).
 */
export function recordBackgroundAiCost(input: RecordBackgroundAiCostInput): number {
  const provider: AIProvider = input.provider ?? 'anthropic';
  const usage = input.usage;

  let cost = input.costUsd;
  if (cost === undefined) {
    const pricing = getPricingSync(provider, input.model);
    cost = pricing ? calculateCostSync(usage, pricing) : 0;
  }

  const event: CostEvent = {
    ts: input.ts ?? new Date().toISOString(),
    type: 'cost',
    agentId: BACKGROUND_COST_AGENT_ID,
    issueId: BACKGROUND_COST_ISSUE_ID,
    sessionType: 'background',
    source: backgroundCostSource(input.feature),
    provider,
    model: input.model,
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    cost,
    requestId: input.requestId,
  };

  try {
    appendCostEventSync(event);
  } catch (err) {
    console.warn(`[background-ai] failed to record cost for ${input.feature}:`, err);
  }

  return cost;
}
