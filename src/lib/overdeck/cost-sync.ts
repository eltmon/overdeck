/**
 * Sync primitives for overdeck cost_events — used by the hot path
 * appendCostEventSync() in lib/costs/events.ts, which must stay sync
 * (the caller is a fire-and-forget best-effort write after JSONL append).
 *
 * The Effect-based CostWriter.record() path goes through CostArchiveLive;
 * this sync path mirrors only the cache-table insert into overdeck.db.
 */
import type { CostEvent } from '../costs/events.js';
import { getOverdeckDatabaseSync } from './infra.js';
import { deriveTieredAgentCostRole } from '../agents/tier-metrics.js';

/**
 * Query total memory-extraction cost in USD for an issue within a time window.
 * Mirrors the queryMemoryExtractionCostUsd function from cost-events-db.
 * startTs/endTs are ISO timestamp strings; overdeck stores ts as epoch milliseconds.
 */
export function queryMemoryExtractionCostUsdSync(opts: {
  issueId: string;
  startTs: string;
  endTs?: string;
}): number {
  const db = getOverdeckDatabaseSync();
  const startMillis = new Date(opts.startTs).getTime();
  const conditions = [
    'UPPER(issue_id) = UPPER(?)',
    "source_file = 'memory-extraction'",
    'ts >= ?',
  ];
  const params: (string | number)[] = [opts.issueId, startMillis];
  if (opts.endTs) {
    conditions.push('ts <= ?');
    params.push(new Date(opts.endTs).getTime());
  }
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost), 0) AS total FROM cost_events WHERE ${conditions.join(' AND ')}`,
    )
    .get(...params) as { total: number } | undefined;
  return row?.total ?? 0;
}

/**
 * Best-effort sync insert of a cost event into overdeck.db.
 * Returns true on success, false if row was a duplicate (request_id conflict).
 * Throws on unexpected errors — caller wraps in try/catch.
 */
export function insertCostEventSync(event: CostEvent): boolean {
  const db = getOverdeckDatabaseSync();
  const tsMillis = new Date(event.ts).getTime();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO cost_events
        (ts, issue_id, agent_id, session_id, session_type, provider, model,
         input, output, cache_read, cache_write, cost, request_id, source_file)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tsMillis,
      event.issueId ?? null,
      event.agentId ?? null,
      event.sessionId ?? null,
      event.sessionType ?? null,
      event.provider ?? null,
      event.model ?? null,
      event.input,
      event.output,
      event.cacheRead,
      event.cacheWrite,
      event.cost,
      event.requestId ?? null,
      event.source ?? null,
    );
  return result.changes > 0;
}

// ── Records-layer helpers ─────────────────────────────────────────────────────

export function getCostSinceSync(startTs: Date): number {
  const db = getOverdeckDatabaseSync();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost), 0) AS total_cost FROM cost_events
       WHERE ts >= ?`,
    )
    .get(startTs.getTime()) as { total_cost: number } | undefined;
  return row?.total_cost ?? 0;
}

export function getTodayCostSync(now = new Date()): number {
  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return getCostSinceSync(utcMidnight);
}

/**
 * Returns the total cost in USD for an issue (for records.ts projectUsage).
 * Returns null if no cost events exist.
 */
export function getCostForIssueSync(issueId: string): { totalCost: number } | null {
  const db = getOverdeckDatabaseSync();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost), 0) AS total_cost FROM cost_events
       WHERE UPPER(issue_id) = UPPER(?)`,
    )
    .get(issueId) as { total_cost: number } | undefined;
  if (!row || row.total_cost === 0) return null;
  return { totalCost: row.total_cost };
}

/**
 * Returns per-stage/per-model token breakdown for an issue.
 * Mirrors getCostBreakdownByStageAndModel from cost-events-db.
 * overdeck stores ts as integer milliseconds, but the GROUP BY query is the same.
 */
export function getCostBreakdownByStageAndModelSync(issueId: string): {
  byStage: Record<
    string,
    Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  >;
  totals: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
} {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(
      `SELECT
         CASE WHEN session_type IS NULL OR session_type = 'unknown' THEN 'other' ELSE session_type END AS stage,
         COALESCE(provider || '/' || model, 'unknown') AS provider_model,
         SUM(input) AS input,
         SUM(output) AS output,
         SUM(cache_read) AS cache_read,
         SUM(cache_write) AS cache_write
       FROM cost_events
       WHERE UPPER(issue_id) = UPPER(?)
       GROUP BY stage, provider_model`,
    )
    .all(issueId) as Array<{
    stage: string;
    provider_model: string;
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  }>;

  const byStage: Record<
    string,
    Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  > = {};
  const totals: Record<
    string,
    { input: number; output: number; cacheRead: number; cacheWrite: number }
  > = {};

  for (const row of rows) {
    if (!byStage[row.stage]) byStage[row.stage] = {};
    byStage[row.stage][row.provider_model] = {
      input: row.input,
      output: row.output,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
    };
    const t = totals[row.provider_model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    t.input += row.input;
    t.output += row.output;
    t.cacheRead += row.cache_read;
    t.cacheWrite += row.cache_write;
    totals[row.provider_model] = t;
  }

  return { byStage, totals };
}

// ── IssueAggregate helpers (for routes/costs.ts and cli/commands/cost.ts) ─────

export interface ModelBreakdown {
  cost: number;
  calls: number;
  tokens: number;
}

export interface StageBreakdown {
  cost: number;
  calls: number;
  tokens: number;
}

export interface IssueAggregate {
  issueId: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  lastUpdated: string;
  budgetWarning: boolean;
  models: Record<string, ModelBreakdown>;
  stages: Record<string, StageBreakdown>;
  budget?: number;
}

function getModelBreakdownForIssueSync(issueId: string): Record<string, ModelBreakdown> {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(
      `SELECT model,
              SUM(cost) AS cost,
              COUNT(*)  AS calls,
              SUM(input + output + cache_read + cache_write) AS tokens
       FROM cost_events
       WHERE UPPER(issue_id) = UPPER(?)
       GROUP BY model`,
    )
    .all(issueId) as Array<{ model: string; cost: number; calls: number; tokens: number }>;
  const result: Record<string, ModelBreakdown> = {};
  for (const r of rows) {
    result[r.model ?? 'unknown'] = { cost: r.cost ?? 0, calls: r.calls ?? 0, tokens: r.tokens ?? 0 };
  }
  return result;
}

function getStageBreakdownForIssueSync(issueId: string): Record<string, StageBreakdown> {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(
      `SELECT session_type AS stage,
              SUM(cost) AS cost,
              COUNT(*)  AS calls,
              SUM(input + output + cache_read + cache_write) AS tokens
       FROM cost_events
       WHERE UPPER(issue_id) = UPPER(?)
       GROUP BY session_type`,
    )
    .all(issueId) as Array<{ stage: string; cost: number; calls: number; tokens: number }>;
  const result: Record<string, StageBreakdown> = {};
  for (const r of rows) {
    result[r.stage ?? 'unknown'] = { cost: r.cost ?? 0, calls: r.calls ?? 0, tokens: r.tokens ?? 0 };
  }
  return result;
}

/**
 * Get aggregated costs by issue. Mirrors getCostsByIssueFromDb from cost-events-db.
 * overdeck stores ts as epoch milliseconds — MAX(ts) is converted to ISO string for lastUpdated.
 */
export function getCostsByIssueSync(): Record<string, IssueAggregate> {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(
      `SELECT UPPER(issue_id) AS issue_id,
              SUM(cost)        AS total_cost,
              SUM(input)       AS input_tokens,
              SUM(output)      AS output_tokens,
              SUM(cache_read)  AS cache_read_tokens,
              SUM(cache_write) AS cache_write_tokens,
              MAX(ts)          AS last_updated
       FROM cost_events
       GROUP BY UPPER(issue_id)
       ORDER BY total_cost DESC`,
    )
    .all() as Array<{
    issue_id: string;
    total_cost: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    last_updated: number;
  }>;

  // PAN-472: fetch the per-model and per-stage breakdowns for ALL issues in two
  // grouped queries instead of two full-table scans per issue. The old N+1 shape
  // ran 1 + 2×308 sync queries (~3.7s of event-loop blocking) per call — and the
  // Command Deck polls this every 15s.
  const modelRows = db
    .prepare(
      `SELECT UPPER(issue_id) AS issue_id,
              model,
              SUM(cost) AS cost,
              COUNT(*)  AS calls,
              SUM(input + output + cache_read + cache_write) AS tokens
       FROM cost_events
       GROUP BY UPPER(issue_id), model`,
    )
    .all() as Array<{ issue_id: string; model: string | null; cost: number; calls: number; tokens: number }>;
  const stageRows = db
    .prepare(
      `SELECT UPPER(issue_id) AS issue_id,
              session_type AS stage,
              SUM(cost) AS cost,
              COUNT(*)  AS calls,
              SUM(input + output + cache_read + cache_write) AS tokens
       FROM cost_events
       GROUP BY UPPER(issue_id), session_type`,
    )
    .all() as Array<{ issue_id: string; stage: string | null; cost: number; calls: number; tokens: number }>;

  const modelsByIssue: Record<string, Record<string, ModelBreakdown>> = {};
  for (const r of modelRows) {
    (modelsByIssue[r.issue_id] ??= {})[r.model ?? 'unknown'] = {
      cost: r.cost ?? 0,
      calls: r.calls ?? 0,
      tokens: r.tokens ?? 0,
    };
  }
  const stagesByIssue: Record<string, Record<string, StageBreakdown>> = {};
  for (const r of stageRows) {
    (stagesByIssue[r.issue_id] ??= {})[r.stage ?? 'unknown'] = {
      cost: r.cost ?? 0,
      calls: r.calls ?? 0,
      tokens: r.tokens ?? 0,
    };
  }

  const result: Record<string, IssueAggregate> = {};
  for (const row of rows) {
    result[row.issue_id] = {
      issueId: row.issue_id,
      totalCost: row.total_cost ?? 0,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      cacheReadTokens: row.cache_read_tokens ?? 0,
      cacheWriteTokens: row.cache_write_tokens ?? 0,
      lastUpdated: row.last_updated != null ? new Date(row.last_updated).toISOString() : new Date().toISOString(),
      budgetWarning: false,
      models: modelsByIssue[row.issue_id] ?? {},
      stages: stagesByIssue[row.issue_id] ?? {},
    };
  }
  return result;
}

/**
 * Get aggregated costs for a single issue. Mirrors getCostForIssueFromDb.
 */
export function getCostForIssueAggregateSync(issueId: string): IssueAggregate | null {
  const db = getOverdeckDatabaseSync();
  const row = db
    .prepare(
      `SELECT UPPER(issue_id) AS issue_id,
              SUM(cost)        AS total_cost,
              SUM(input)       AS input_tokens,
              SUM(output)      AS output_tokens,
              SUM(cache_read)  AS cache_read_tokens,
              SUM(cache_write) AS cache_write_tokens,
              MAX(ts)          AS last_updated
       FROM cost_events
       WHERE UPPER(issue_id) = UPPER(?)
       GROUP BY UPPER(issue_id)`,
    )
    .get(issueId) as {
    issue_id: string;
    total_cost: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    last_updated: number;
  } | undefined;

  if (!row) return null;

  return {
    issueId: row.issue_id,
    totalCost: row.total_cost ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    cacheReadTokens: row.cache_read_tokens ?? 0,
    cacheWriteTokens: row.cache_write_tokens ?? 0,
    lastUpdated: row.last_updated != null ? new Date(row.last_updated).toISOString() : new Date().toISOString(),
    budgetWarning: false,
    models: getModelBreakdownForIssueSync(row.issue_id),
    stages: getStageBreakdownForIssueSync(row.issue_id),
  };
}

export interface DailyTrend {
  date: string;
  totalCost: number;
  eventCount: number;
  totalTokens: number;
}

/**
 * Get daily cost totals for trend charts.
 */
export function getDailyTrendsSync(opts: { days?: number; issueId?: string } = {}): DailyTrend[] {
  const db = getOverdeckDatabaseSync();
  const days = opts.days ?? 30;
  const sinceMillis = Date.now() - days * 86_400_000;
  const conditions = ['ts >= ?'];
  const params: (string | number)[] = [sinceMillis];
  if (opts.issueId) {
    conditions.push('UPPER(issue_id) = UPPER(?)');
    params.push(opts.issueId);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db
    .prepare(
      `SELECT DATE(datetime(ts / 1000, 'unixepoch')) AS date,
              SUM(cost)  AS total_cost,
              COUNT(*)   AS event_count,
              SUM(input + output + cache_read + cache_write) AS total_tokens
       FROM cost_events
       ${where}
       GROUP BY DATE(datetime(ts / 1000, 'unixepoch'))
       ORDER BY date ASC`,
    )
    .all(...params) as Array<{ date: string; total_cost: number; event_count: number; total_tokens: number }>;
  return rows.map((r) => ({
    date: r.date,
    totalCost: r.total_cost ?? 0,
    eventCount: r.event_count ?? 0,
    totalTokens: r.total_tokens ?? 0,
  }));
}

export interface ModelRollup {
  model: string;
  totalCost: number;
  calls: number;
  totalTokens: number;
}

/**
 * Get model-level rollup across all issues or for a specific issue.
 * Mirrors getModelRollup from cost-events-db.
 */
export function getModelRollupSync(issueId?: string): ModelRollup[] {
  const db = getOverdeckDatabaseSync();
  const where = issueId ? 'WHERE UPPER(issue_id) = UPPER(?)' : '';
  const params = issueId ? [issueId] : [];
  const rows = db
    .prepare(
      `SELECT model,
              SUM(cost) AS total_cost,
              COUNT(*)  AS calls,
              SUM(input + output + cache_read + cache_write) AS total_tokens
       FROM cost_events
       ${where}
       GROUP BY model
       ORDER BY total_cost DESC`,
    )
    .all(...params) as Array<{ model: string; total_cost: number; calls: number; total_tokens: number }>;
  return rows.map((r) => ({
    model: r.model ?? 'unknown',
    totalCost: r.total_cost ?? 0,
    calls: r.calls ?? 0,
    totalTokens: r.total_tokens ?? 0,
  }));
}

/**
 * Get background cost by source_file for last N hours.
 * Mirrors getBackgroundCostBySource from cost-events-db.
 * overdeck stores ts as epoch milliseconds.
 */
export function getBackgroundCostBySourceSync(hours = 24): Record<string, number> {
  const db = getOverdeckDatabaseSync();
  const sinceMillis = Date.now() - hours * 3_600_000;
  const rows = db
    .prepare(
      `SELECT source_file AS source, COALESCE(SUM(cost), 0) AS cost
       FROM cost_events
       WHERE ts >= ?
         AND (source_file LIKE 'background:%' OR source_file = 'memory-extraction')
       GROUP BY source_file`,
    )
    .all(sinceMillis) as Array<{ source: string | null; cost: number }>;
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.source) out[row.source] = row.cost ?? 0;
  }
  return out;
}

/**
 * Get per-agent cost rollup. Mirrors getAgentRollup from cost-events-db.
 * Optional issueId narrows to events for that issue.
 * overdeck stores ts as epoch milliseconds — converted to ISO for firstEvent/lastEvent.
 */
export interface AgentRollup {
  agentId: string;
  role: string;
  totalCost: number;
  calls: number;
  totalTokens: number;
  firstEvent: string;
  lastEvent: string;
}

export function getAgentRollup(issueId?: string): AgentRollup[] {
  const db = getOverdeckDatabaseSync();
  const where = issueId ? 'WHERE UPPER(issue_id) = UPPER(?)' : '';
  const params = issueId ? [issueId] : [];
  const rows = db
    .prepare(
      `SELECT agent_id,
              SUM(cost)                                    AS total_cost,
              COUNT(*)                                     AS calls,
              SUM(input + output + cache_read + cache_write) AS total_tokens,
              MIN(ts)                                      AS first_event,
              MAX(ts)                                      AS last_event
       FROM cost_events
       ${where}
       GROUP BY agent_id
       ORDER BY total_cost DESC`,
    )
    .all(...params) as Array<{
    agent_id: string | null;
    total_cost: number;
    calls: number;
    total_tokens: number;
    first_event: number | null;
    last_event: number | null;
  }>;
  return rows
    .filter((r) => r.agent_id != null)
    .map((r) => ({
      agentId: r.agent_id as string,
      role: deriveTieredAgentCostRole(r.agent_id as string, issueId),
      totalCost: r.total_cost ?? 0,
      calls: r.calls ?? 0,
      totalTokens: r.total_tokens ?? 0,
      firstEvent: r.first_event != null ? new Date(r.first_event).toISOString() : new Date().toISOString(),
      lastEvent: r.last_event != null ? new Date(r.last_event).toISOString() : new Date().toISOString(),
    }));
}

/**
 * getCavemanExperimentData equivalent.
 * The overdeck cost_events table has no caveman_variant column — this column
 * was dropped as zero-read bloat in the overdeck schema (overdeck-schema.ts).
 * Returns empty array since there is nothing to query.
 */
export interface CavemanExperimentRow {
  variant: string;
  eventCount: number;
  avgOutputTokens: number;
  totalOutputTokens: number;
  avgInputTokens: number;
  avgCost: number;
  totalCost: number;
}

export function getCavemanExperimentDataSync(): CavemanExperimentRow[] {
  return [];
}
