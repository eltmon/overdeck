/** Canonical resource-cost read: aggregate in SQLite; never materialize ledger events. */
import { getOverdeckDatabaseSync } from './infra.js';

export interface AgentCostStats {
  burnUsdPerHour: number;
  hypotheticalUsdPerHour: number;
  totalUsd: number;
}

export function getAgentCostStatsSync(input: {
  agentIds: string[];
  nowMs: number;
}): Array<[string, AgentCostStats]> {
  if (input.agentIds.length === 0) return [];
  const rows = getOverdeckDatabaseSync().prepare(`
    SELECT agent_id AS agentId,
      SUM(CASE WHEN source_file IS 'subscription-covered' THEN 0 ELSE COALESCE(cost, 0) END) AS totalUsd,
      SUM(CASE WHEN ts >= ? AND source_file IS NOT 'subscription-covered' THEN COALESCE(cost, 0) ELSE 0 END) AS recentBillable,
      SUM(CASE WHEN ts >= ? AND source_file IS 'subscription-covered' THEN COALESCE(cost, 0) ELSE 0 END) AS recentHypothetical
    FROM cost_events
    WHERE agent_id IN (${input.agentIds.map(() => '?').join(',')})
    GROUP BY agent_id
  `).all(input.nowMs - 30 * 60_000, input.nowMs - 30 * 60_000, ...input.agentIds) as Array<{
    agentId: string; totalUsd: number; recentBillable: number; recentHypothetical: number;
  }>;
  // Preserve the resource builder's JS rounding, inclusive 30-minute window,
  // and omission of subscription-covered charges from lifetime billable cost.
  // The ledger stores covered usage in source_file; hypotheticalCost and
  // subscriptionCovered are only fields on the pure builder's input events.
  return rows.map(row => [row.agentId, {
    burnUsdPerHour: Math.round(row.recentBillable * 2 * 100) / 100,
    hypotheticalUsdPerHour: Math.round(row.recentHypothetical * 2 * 100) / 100,
    totalUsd: Math.round(row.totalUsd * 100) / 100,
  }]);
}
