/**
 * Cost Monitor
 *
 * Monitors agent costs against configured limits and emits alerts.
 * Does NOT automatically stop agents - just provides visibility and warnings.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { Effect } from 'effect';
import { FsError } from '../errors.js';
import { PANOPTICON_HOME } from '../paths.js';
import { loadCloisterConfig, type CostLimitsConfig } from './config.js';

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
 * Cost tracking data (persisted format)
 */
interface CostDataPersisted {
  perAgent: Record<string, number>;
  perIssue: Record<string, number>;
  dailyTotal: number;
  lastResetDate: string; // ISO date string (YYYY-MM-DD)
}

/**
 * Cost tracking data (runtime format)
 */
interface CostData {
  perAgent: Map<string, number>;
  perIssue: Map<string, number>;
  dailyTotal: number;
  lastResetDate: string; // ISO date string (YYYY-MM-DD)
}

/**
 * Path to cost data file
 */
const COST_DATA_FILE = join(PANOPTICON_HOME, 'cost-data.json');

/**
 * Load cost data from file
 */
function loadCostData(): CostData {
  if (!existsSync(COST_DATA_FILE)) {
    return {
      perAgent: new Map(),
      perIssue: new Map(),
      dailyTotal: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
    };
  }

  try {
    const fileContent = readFileSync(COST_DATA_FILE, 'utf-8');
    const persisted: CostDataPersisted = JSON.parse(fileContent);

    return {
      perAgent: new Map(Object.entries(persisted.perAgent || {})),
      perIssue: new Map(Object.entries(persisted.perIssue || {})),
      dailyTotal: persisted.dailyTotal || 0,
      lastResetDate: persisted.lastResetDate || new Date().toISOString().split('T')[0],
    };
  } catch (error) {
    console.error('Failed to load cost data, starting fresh:', error);
    return {
      perAgent: new Map(),
      perIssue: new Map(),
      dailyTotal: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
    };
  }
}

/**
 * Save cost data to file (atomic write)
 */
function saveCostData(data: CostData): void {
  try {
    // Ensure directory exists
    const dir = dirname(COST_DATA_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const persisted: CostDataPersisted = {
      perAgent: Object.fromEntries(data.perAgent),
      perIssue: Object.fromEntries(data.perIssue),
      dailyTotal: data.dailyTotal,
      lastResetDate: data.lastResetDate,
    };

    // Atomic write: write to temp file, then rename
    const tempFile = `${COST_DATA_FILE}.tmp`;
    writeFileSync(tempFile, JSON.stringify(persisted, null, 2));
    writeFileSync(COST_DATA_FILE, readFileSync(tempFile));

    // Clean up temp file
    try {
      unlinkSync(tempFile);
    } catch (unlinkError: unknown) {
      // Non-critical: temp file cleanup failure is logged but doesn't block operation
      console.debug('Failed to cleanup temp file:', unlinkError instanceof Error ? unlinkError.message : unlinkError);
    }
  } catch (error) {
    console.error('Failed to save cost data:', error);
  }
}

// Load cost data on module initialization
let costData: CostData = loadCostData();

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Reset daily totals if it's a new day
 */
function checkDailyReset(): void {
  const today = getTodayDate();
  if (costData.lastResetDate !== today) {
    costData.dailyTotal = 0;
    costData.lastResetDate = today;
    console.log(`🔔 Cost monitor: Daily totals reset for ${today}`);
    saveCostData(costData);
  }
}

/**
 * Record a cost event
 *
 * @param agentId - Agent ID
 * @param cost - Cost in USD
 * @param issueId - Optional issue ID
 */
export function recordCost(agentId: string, cost: number, issueId?: string): void {
  checkDailyReset();

  // Update per-agent cost
  const currentAgentCost = costData.perAgent.get(agentId) || 0;
  costData.perAgent.set(agentId, currentAgentCost + cost);

  // Update per-issue cost
  if (issueId) {
    const currentIssueCost = costData.perIssue.get(issueId) || 0;
    costData.perIssue.set(issueId, currentIssueCost + cost);
  }

  // Update daily total
  costData.dailyTotal += cost;

  // Persist to disk
  saveCostData(costData);
}

/**
 * Check if any cost limits are being approached or exceeded
 *
 * @param agentId - Agent ID to check
 * @param issueId - Optional issue ID to check
 * @param config - Cost limits configuration
 * @returns Array of alerts (empty if no limits exceeded)
 */
export function checkCostLimits(
  agentId: string,
  issueId: string | undefined,
  config: CostLimitsConfig = loadCloisterConfig().cost_limits || {
    per_agent_usd: 10.0,
    per_issue_usd: 25.0,
    daily_total_usd: 100.0,
    alert_threshold: 0.8,
  }
): CostAlert[] {
  checkDailyReset();

  const alerts: CostAlert[] = [];
  const now = new Date().toISOString();

  // Check per-agent limit
  const agentCost = costData.perAgent.get(agentId) || 0;
  if (config.per_agent_usd > 0) {
    const agentPercent = agentCost / config.per_agent_usd;

    if (agentPercent >= 1.0) {
      alerts.push({
        type: 'per_agent',
        level: 'limit_reached',
        agentId,
        currentCost: agentCost,
        limit: config.per_agent_usd,
        percentUsed: agentPercent * 100,
        timestamp: now,
      });
    } else if (agentPercent >= config.alert_threshold) {
      alerts.push({
        type: 'per_agent',
        level: 'warning',
        agentId,
        currentCost: agentCost,
        limit: config.per_agent_usd,
        percentUsed: agentPercent * 100,
        timestamp: now,
      });
    }
  }

  // Check per-issue limit
  if (issueId && config.per_issue_usd > 0) {
    const issueCost = costData.perIssue.get(issueId) || 0;
    const issuePercent = issueCost / config.per_issue_usd;

    if (issuePercent >= 1.0) {
      alerts.push({
        type: 'per_issue',
        level: 'limit_reached',
        issueId,
        currentCost: issueCost,
        limit: config.per_issue_usd,
        percentUsed: issuePercent * 100,
        timestamp: now,
      });
    } else if (issuePercent >= config.alert_threshold) {
      alerts.push({
        type: 'per_issue',
        level: 'warning',
        issueId,
        currentCost: issueCost,
        limit: config.per_issue_usd,
        percentUsed: issuePercent * 100,
        timestamp: now,
      });
    }
  }

  // Check daily total limit
  if (config.daily_total_usd > 0) {
    const dailyPercent = costData.dailyTotal / config.daily_total_usd;

    if (dailyPercent >= 1.0) {
      alerts.push({
        type: 'daily_total',
        level: 'limit_reached',
        currentCost: costData.dailyTotal,
        limit: config.daily_total_usd,
        percentUsed: dailyPercent * 100,
        timestamp: now,
      });
    } else if (dailyPercent >= config.alert_threshold) {
      alerts.push({
        type: 'daily_total',
        level: 'warning',
        currentCost: costData.dailyTotal,
        limit: config.daily_total_usd,
        percentUsed: dailyPercent * 100,
        timestamp: now,
      });
    }
  }

  return alerts;
}

/**
 * Get current cost data for an agent
 *
 * @param agentId - Agent ID
 * @returns Current cost
 */
export function getAgentCost(agentId: string): number {
  return costData.perAgent.get(agentId) || 0;
}

/**
 * Get current cost data for an issue
 *
 * @param issueId - Issue ID
 * @returns Current cost
 */
export function getIssueCost(issueId: string): number {
  return costData.perIssue.get(issueId) || 0;
}

/**
 * Get current daily total cost
 *
 * @returns Current daily total
 */
export function getDailyTotal(): number {
  checkDailyReset();
  return costData.dailyTotal;
}

/**
 * Get cost summary
 *
 * @returns Cost summary with top spenders
 */
export function getCostSummary(): {
  dailyTotal: number;
  topAgents: Array<{ agentId: string; cost: number }>;
  topIssues: Array<{ issueId: string; cost: number }>;
} {
  checkDailyReset();

  // Sort agents by cost
  const topAgents = Array.from(costData.perAgent.entries())
    .map(([agentId, cost]) => ({ agentId, cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Sort issues by cost
  const topIssues = Array.from(costData.perIssue.entries())
    .map(([issueId, cost]) => ({ issueId, cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  return {
    dailyTotal: costData.dailyTotal,
    topAgents,
    topIssues,
  };
}

/**
 * Reset cost tracking (for testing)
 */
export function resetCostTracking(): void {
  costData = {
    perAgent: new Map(),
    perIssue: new Map(),
    dailyTotal: 0,
    lastResetDate: getTodayDate(),
  };
  saveCostData(costData);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect variants for cost-monitor I/O. The sync variants remain in
// place because the module-level `costData` cache is populated synchronously at
// import time; new callers (route handlers, services in the dashboard server)
// can use these to avoid blocking the event loop on cost ledger writes.

/** Persist the in-memory cost ledger to disk using fs/promises. */
const saveCostDataAsync = (data: CostData): Effect.Effect<void, FsError> =>
  Effect.gen(function* () {
    const dir = dirname(COST_DATA_FILE);
    yield* Effect.tryPromise({
      try: () => mkdir(dir, { recursive: true }),
      catch: (cause) => new FsError({ path: dir, operation: 'mkdir', cause }),
    });

    const persisted: CostDataPersisted = {
      perAgent: Object.fromEntries(data.perAgent),
      perIssue: Object.fromEntries(data.perIssue),
      dailyTotal: data.dailyTotal,
      lastResetDate: data.lastResetDate,
    };

    const tempFile = `${COST_DATA_FILE}.tmp`;
    yield* Effect.tryPromise({
      try: () => writeFile(tempFile, JSON.stringify(persisted, null, 2), 'utf-8'),
      catch: (cause) => new FsError({ path: tempFile, operation: 'writeFile', cause }),
    });

    yield* Effect.tryPromise({
      try: () => rename(tempFile, COST_DATA_FILE),
      catch: (cause) => new FsError({ path: COST_DATA_FILE, operation: 'rename', cause }),
    });

    // Best-effort temp cleanup if rename was a no-op on a foreign FS.
    yield* Effect.tryPromise({
      try: () => unlink(tempFile),
      catch: (cause) => new FsError({ path: tempFile, operation: 'unlink', cause }),
    }).pipe(Effect.catch(() => Effect.succeed(undefined)));
  });

/** Effect variant of `recordCost`. */
export const recordCostEffect = (
  agentId: string,
  cost: number,
  issueId?: string,
): Effect.Effect<void, FsError> =>
  Effect.gen(function* () {
    const today = getTodayDate();
    if (costData.lastResetDate !== today) {
      costData.dailyTotal = 0;
      costData.lastResetDate = today;
      console.log(`🔔 Cost monitor: Daily totals reset for ${today}`);
    }

    const currentAgentCost = costData.perAgent.get(agentId) || 0;
    costData.perAgent.set(agentId, currentAgentCost + cost);

    if (issueId) {
      const currentIssueCost = costData.perIssue.get(issueId) || 0;
      costData.perIssue.set(issueId, currentIssueCost + cost);
    }

    costData.dailyTotal += cost;

    yield* saveCostDataAsync(costData);
  });

/** Effect variant of `resetCostTracking`. */
export const resetCostTrackingEffect = (): Effect.Effect<void, FsError> =>
  Effect.gen(function* () {
    costData = {
      perAgent: new Map(),
      perIssue: new Map(),
      dailyTotal: 0,
      lastResetDate: getTodayDate(),
    };
    yield* saveCostDataAsync(costData);
  });

// Re-export FsError so callers don't need to import it from the shared module.
export { FsError } from '../errors.js';
// Silence "unused" warnings for the async fs imports we may use in future
// extensions of this module.
void readFile;
