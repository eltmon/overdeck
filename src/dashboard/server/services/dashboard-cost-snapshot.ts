/** Heavy polling reads run only inside the dashboard database worker. */
import { getCostsByIssueSync } from '../../../lib/overdeck/cost-sync.js';

export function getCostsByIssueSnapshot() {
  const dbIssues = getCostsByIssueSync();

  const issues = Object.entries(dbIssues).map(([issueId, d]) => {
    return {
      issueId,
      totalCost: d.totalCost,
      tokenCount: d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheWriteTokens,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheReadTokens: d.cacheReadTokens,
      cacheWriteTokens: d.cacheWriteTokens,
      models: d.models,
      byModel: Object.fromEntries(
        Object.entries(d.models).map(([model, stats]) => [model, { cost: stats.cost, tokens: stats.tokens }])
      ),
      byStage: Object.fromEntries(
        Object.entries(d.stages || {}).map(([stage, stats]) => [stage, { cost: stats.cost, tokens: stats.tokens }])
      ),
      budgetWarning: d.budgetWarning,
      lastUpdated: d.lastUpdated,
    };
  });

  issues.sort((a, b) => b.totalCost - a.totalCost);

  return { status: 'live' as const, eventCount: issues.length, issues };
}
