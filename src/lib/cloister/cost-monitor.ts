/**
 * Cost Monitor
 *
 * Monitors agent costs against configured limits and emits alerts.
 * Does NOT automatically stop agents - just provides visibility and warnings.
 * Every number is read from the cost_events table; this module stores nothing
 * (the old cost-data.json accumulator had no writer and was removed, PAN-4052).
 */

import { loadCloisterConfigSync, type CostLimitsConfig } from './config.js';
import {
  getDailyTrendsSync as getDailyTrends,
  getAgentDailyCost,
} from '../overdeck/cost-sync.js';

/**
 * Cost alert level
 */
export type CostAlertLevel = 'warning' | 'limit_reached';

/**
 * Cost alert
 */
export interface CostAlert {
  type: 'per_agent' | 'per_issue' | 'daily_total';
  level: CostAlertLevel;
  agentId?: string;
  issueId?: string;
  currentCost: number;
  limit: number;
  percentUsed: number;
  timestamp: string;
}

/**
 * Check if any cost limits are being approached or exceeded.
 *
 * Opt-in: with no operator-configured `cost_limits` this returns [] without
 * reading any cost data — there is deliberately no default limit (PAN-2642;
 * the old invented $10/$25/$100 fallback sat permanently exceeded and
 * produced pure alert noise, PAN-2319).
 *
 * @param agentId - Agent ID to check
 * @param issueId - Optional issue ID to check
 * @param config - Cost limits configuration
 * @returns Array of alerts (empty if no limits configured or exceeded)
 */
export function checkCostLimits(
  agentId: string,
  issueId: string | undefined,
  config: CostLimitsConfig | undefined = loadCloisterConfigSync().cost_limits
): CostAlert[] {
  const alerts: CostAlert[] = [];
  if (!config) return alerts;
  const alertThreshold = config.alert_threshold ?? 0.8;
  const perAgentUsd = config.per_agent_usd ?? 0;
  const perIssueUsd = config.per_issue_usd ?? 0;
  const dailyTotalUsd = config.daily_total_usd ?? 0;
  const now = new Date().toISOString();

  // Read agent cost from DB (scoped to today, matching the cap's window)
  // The accumulator should match the cap's window: per-agent daily cap compares daily spend
  if (perAgentUsd > 0) {
    const agentCost = getAgentDailyCost(agentId);
    const agentPercent = agentCost / perAgentUsd;

    if (agentPercent >= 1.0) {
      alerts.push({
        type: 'per_agent',
        level: 'limit_reached',
        agentId,
        currentCost: agentCost,
        limit: perAgentUsd,
        percentUsed: agentPercent * 100,
        timestamp: now,
      });
    } else if (agentPercent >= alertThreshold) {
      alerts.push({
        type: 'per_agent',
        level: 'warning',
        agentId,
        currentCost: agentCost,
        limit: perAgentUsd,
        percentUsed: agentPercent * 100,
        timestamp: now,
      });
    }
  }

  // Read issue cost from DB (scoped to today, matching the cap's window)
  if (issueId && perIssueUsd > 0) {
    const issueDailyTrends = getDailyTrends({ days: 1, issueId });
    const issueCost = issueDailyTrends.reduce((sum, t) => sum + t.totalCost, 0);
    const issuePercent = issueCost / perIssueUsd;

    if (issuePercent >= 1.0) {
      alerts.push({
        type: 'per_issue',
        level: 'limit_reached',
        issueId,
        currentCost: issueCost,
        limit: perIssueUsd,
        percentUsed: issuePercent * 100,
        timestamp: now,
      });
    } else if (issuePercent >= alertThreshold) {
      alerts.push({
        type: 'per_issue',
        level: 'warning',
        issueId,
        currentCost: issueCost,
        limit: perIssueUsd,
        percentUsed: issuePercent * 100,
        timestamp: now,
      });
    }
  }

  // Read today's total from DB (sum of today's events)
  if (dailyTotalUsd > 0) {
    const dailyTotal = getDailyTrends({ days: 1 }).reduce((sum, t) => sum + t.totalCost, 0);
    const dailyPercent = dailyTotal / dailyTotalUsd;

    if (dailyPercent >= 1.0) {
      alerts.push({
        type: 'daily_total',
        level: 'limit_reached',
        currentCost: dailyTotal,
        limit: dailyTotalUsd,
        percentUsed: dailyPercent * 100,
        timestamp: now,
      });
    } else if (dailyPercent >= alertThreshold) {
      alerts.push({
        type: 'daily_total',
        level: 'warning',
        currentCost: dailyTotal,
        limit: dailyTotalUsd,
        percentUsed: dailyPercent * 100,
        timestamp: now,
      });
    }
  }

  return alerts;
}
