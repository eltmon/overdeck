/** Server-wide snapshots for recurring UI polls; no ledger/corpus reads on HTTP threads. */
import { runDashboardDbJob } from './dashboard-db-task.js';
import { createRefreshingSnapshot } from './refreshing-snapshot.js';
import type { getCostsByIssueSnapshot as readCostSnapshot } from './dashboard-cost-snapshot.js';
import type { getConversationSearchStats } from '../../../lib/overdeck/conversations-search.js';

type SearchStats = ReturnType<typeof getConversationSearchStats>;
type LedgerCosts = Array<[string, { cost: number; tokens: number }]>;
const costOptions = { ttlMs: 15_000, maxAgeMs: 300_000, retryMs: 5_000 };
const costs = createRefreshingSnapshot(
  () => runDashboardDbJob<ReturnType<typeof readCostSnapshot>>('getCostsByIssueSnapshot'), costOptions,
);
const ledgerCosts = createRefreshingSnapshot(
  () => runDashboardDbJob<LedgerCosts>('getConversationLedgerCosts'), costOptions,
);

export const getCostsByIssueSnapshot = costs.get;
export const getConversationLedgerCostsSnapshot = ledgerCosts.get;

// Retain only the active database/model, so configuration changes cannot reuse old stats.
let search: { key: string; get: () => Promise<SearchStats> } | undefined;
export function getConversationSearchStatsSnapshot(input: { dbPath: string; model: string }): Promise<SearchStats> {
  const payload = { dbPath: input.dbPath, model: input.model };
  const key = JSON.stringify(payload);
  if (search?.key !== key) {
    search = { key, ...createRefreshingSnapshot(
      () => runDashboardDbJob<SearchStats>('getConversationSearchStats', payload),
      { ttlMs: 60_000, maxAgeMs: 300_000, retryMs: 5_000 },
    ) };
  }
  return search.get();
}
