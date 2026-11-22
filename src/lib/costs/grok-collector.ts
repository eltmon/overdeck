/**
 * Grok Build cost sweep (PAN-5078 D9): turn_completed entries that the ACP host
 * wrote with Grok turn usage into `$OVERDECK_HOME/agents/<id>/acp-session.jsonl`,
 * parsed into cost events for the CostWriter `record()` door, which deduplicates
 * by requestId. Overdeck never reads Grok's private ~/.grok/sessions store.
 * ACP transcripts of other providers (Kimi, OpenCode) carry no grok/* usage and
 * contribute nothing. The walk and parsing live in acp-turn-usage-collector.ts.
 */
import type { AcpTurnUsage } from '../acp/transcript.js';
import { calculateCost, getPricing } from '../cost.js';
import { getOverdeckHome } from '../paths.js';
import { collectAcpTurnUsageCostEvents, type AcpCollectedCostEvent, type AcpTurnUsageCollection } from './acp-turn-usage-collector.js';

export type GrokCollectedCostEvent = AcpCollectedCostEvent<'grok', 'custom'>;

/** The vendor-reported cost, else the pricing table on the bare CLI model id. */
function turnCost(usage: AcpTurnUsage): number {
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) return usage.costUsd;
  const pricing = getPricing('custom', usage.model.slice('grok/'.length));
  if (!pricing) return 0;
  return calculateCost({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  }, pricing);
}

export async function collectGrokCostEvents(home = getOverdeckHome()): Promise<AcpTurnUsageCollection<'grok', 'custom'>> {
  return collectAcpTurnUsageCostEvents({
    home,
    matches: (usage) => usage.model.startsWith('grok/'),
    sessionType: 'grok',
    requestIdPrefix: 'grok',
    provider: 'custom',
    price: turnCost,
  });
}
