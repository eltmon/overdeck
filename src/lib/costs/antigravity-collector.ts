/**
 * Antigravity cost sweep (PAN-5587 D12): turn_completed entries the ACP host wrote
 * with Antigravity turn usage (`usage.source === "antigravity"`) into
 * `$OVERDECK_HOME/agents/<id>/acp-session.jsonl`. agy reports tokens but no cost,
 * so each turn is priced from the `google` pricing rows on the Overdeck Google id the
 * host launched with. These are estimates at Gemini API list prices: free-tier usage
 * and Agent Platform contract pricing are not modeled. Overdeck never reads agy's
 * private `<gemini dir>/antigravity-cli/conversations/*.db`.
 */
import type { AcpTurnUsage } from '../acp/transcript.js';
import { calculateCost, getPricing } from '../cost.js';
import { getOverdeckHome } from '../paths.js';
import { collectAcpTurnUsageCostEvents, type AcpCollectedCostEvent, type AcpTurnUsageCollection } from './acp-turn-usage-collector.js';

export type AntigravityCollectedCostEvent = AcpCollectedCostEvent<'antigravity', 'google'>;

function turnCost(usage: AcpTurnUsage): number {
  const pricing = getPricing('google', usage.model);
  if (!pricing) return 0;
  return calculateCost({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  }, pricing);
}

export async function collectAntigravityCostEvents(home = getOverdeckHome()): Promise<AcpTurnUsageCollection<'antigravity', 'google'>> {
  return collectAcpTurnUsageCostEvents({
    home,
    matches: (usage) => usage.source === 'antigravity',
    sessionType: 'antigravity',
    requestIdPrefix: 'antigravity',
    provider: 'google',
    price: turnCost,
  });
}
