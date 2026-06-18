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

/**
 * Query total memory-extraction cost in USD for an issue within a time window.
 * Mirrors the queryMemoryExtractionCostUsd function from cost-events-db.
 * startTs/endTs are ISO timestamp strings; overdeck stores ts as unix seconds.
 */
export function queryMemoryExtractionCostUsdSync(opts: {
  issueId: string;
  startTs: string;
  endTs?: string;
}): number {
  const db = getOverdeckDatabaseSync();
  const startSeconds = Math.floor(new Date(opts.startTs).getTime() / 1000);
  const conditions = [
    'UPPER(issue_id) = UPPER(?)',
    "source_file = 'memory-extraction'",
    'ts >= ?',
  ];
  const params: (string | number)[] = [opts.issueId, startSeconds];
  if (opts.endTs) {
    conditions.push('ts <= ?');
    params.push(Math.floor(new Date(opts.endTs).getTime() / 1000));
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
  // overdeck stores ts as integer unix seconds
  const tsSeconds = Math.floor(new Date(event.ts).getTime() / 1000);
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO cost_events
        (ts, issue_id, agent_id, session_id, session_type, provider, model,
         input, output, cache_read, cache_write, cost, request_id, source_file)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tsSeconds,
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
 * overdeck stores ts as unix int (not text), but the GROUP BY query is the same.
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
