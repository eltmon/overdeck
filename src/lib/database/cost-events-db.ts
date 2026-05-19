/**
 * Cost Events SQLite Storage
 *
 * Provides SQLite-backed storage for CostEvent records.
 * Deduplication is enforced via UNIQUE index on request_id.
 *
 * PAN-1249: Effect migration pass — synchronous public API preserved so
 * existing call sites stay unchanged. The hot insert paths are wrapped in
 * Effect.try with a local DatabaseError tag, matching prior best-effort
 * semantics (insert failures are logged and surfaced as `null`).
 * Full conversion to @effect/sql-sqlite-bun is deferred to PAN-447.
 */

import { Data, Effect } from 'effect';
import { getDatabase } from './index.js';
import type { CostEvent } from '../costs/events.js';

/** A SQLite operation against panopticon.db failed. */
class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}

// ============== Daily spend cache (avoids sync SQLite on event loop) ==============

const DAILY_SPEND_CACHE_TTL_MS = 30_000;
const dailySpendCache = new Map<string, { total: number; updatedAt: number }>();

function dailySpendCacheKey(issueId: string, startTs: string): string {
  return `${issueId}:${startTs}`;
}

function startOfLocalDayIso(ts: string): string {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

export function recordMemoryExtractionSpend(issueId: string, startTs: string, cost: number): void {
  const key = dailySpendCacheKey(issueId, startTs);
  const existing = dailySpendCache.get(key);
  if (existing) {
    existing.total += cost;
    existing.updatedAt = Date.now();
  } else {
    dailySpendCache.set(key, { total: cost, updatedAt: Date.now() });
  }
}

export function invalidateMemorySpendCache(issueId: string, startTs: string): void {
  dailySpendCache.delete(dailySpendCacheKey(issueId, startTs));
}

export function getCachedMemoryExtractionCostUsd(opts: { issueId: string; startTs: string }): number | null {
  const cached = dailySpendCache.get(dailySpendCacheKey(opts.issueId, opts.startTs));
  if (cached && Date.now() - cached.updatedAt < DAILY_SPEND_CACHE_TTL_MS) {
    return cached.total;
  }
  return null;
}

// ============== Write operations ==============

/**
 * Insert a cost event. Returns the new row ID, or null if it was a duplicate.
 * Deduplication is handled by the UNIQUE index on request_id.
 */
export function insertCostEvent(event: CostEvent, sourceFile?: string): number | null {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const result = db.prepare(`
          INSERT OR IGNORE INTO cost_events (
            ts, agent_id, issue_id, session_type, provider, model,
            input, output, cache_read, cache_write, cost, request_id,
            session_id,
            tldr_interceptions, tldr_bypasses, tldr_tokens_saved, tldr_bypass_reasons,
            source_file, caveman_variant
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.ts,
          event.agentId,
          event.issueId,
          event.sessionType || 'unknown',
          event.provider || 'anthropic',
          event.model,
          event.input,
          event.output,
          event.cacheRead,
          event.cacheWrite,
          event.cost,
          event.requestId ?? null,
          event.sessionId ?? null,
          event.tldrInterceptions ?? null,
          event.tldrBypasses ?? null,
          event.tldrTokensSaved ?? null,
          event.tldrBypassReasons ? JSON.stringify(event.tldrBypassReasons) : null,
          event.source ?? sourceFile ?? null,
          event.cavemanVariant ?? null,
        );
        if (result.changes === 0) return null; // Duplicate

        // Keep the daily spend cache warm for memory-extraction events
        if (event.source === 'memory-extraction' || sourceFile === 'memory-extraction') {
          recordMemoryExtractionSpend(event.issueId, startOfLocalDayIso(event.ts), event.cost);
        }

        return result.lastInsertRowid as number;
      },
      catch: (cause) => new DatabaseError({ operation: 'insertCostEvent', cause }),
    }).pipe(
      Effect.catchTag('DatabaseError', (err) => {
        // Handle non-requestId duplicates gracefully (preserves prior behaviour)
        console.error('[cost-events-db] Insert failed:', err.cause);
        return Effect.succeed<number | null>(null);
      }),
    ),
  );
}

/**
 * Insert multiple cost events in a single transaction.
 * Returns { inserted, duplicates } counts.
 */
export function insertCostEvents(
  events: CostEvent[],
  sourceFile?: string,
): { inserted: number; duplicates: number } {
  const db = getDatabase();
  let inserted = 0;
  let duplicates = 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO cost_events (
      ts, agent_id, issue_id, session_type, provider, model,
      input, output, cache_read, cache_write, cost, request_id,
      session_id,
      tldr_interceptions, tldr_bypasses, tldr_tokens_saved, tldr_bypass_reasons,
      source_file, caveman_variant
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((evs: CostEvent[]) => {
    for (const ev of evs) {
      const result = insert.run(
        ev.ts,
        ev.agentId,
        ev.issueId,
        ev.sessionType || 'unknown',
        ev.provider || 'anthropic',
        ev.model,
        ev.input,
        ev.output,
        ev.cacheRead,
        ev.cacheWrite,
        ev.cost,
        ev.requestId ?? null,
        ev.sessionId ?? null,
        ev.tldrInterceptions ?? null,
        ev.tldrBypasses ?? null,
        ev.tldrTokensSaved ?? null,
        ev.tldrBypassReasons ? JSON.stringify(ev.tldrBypassReasons) : null,
        ev.source ?? sourceFile ?? null,
        ev.cavemanVariant ?? null,
      );
      if (result.changes > 0) {
        inserted++;
      } else {
        duplicates++;
      }
    }
  });

  insertMany(events);
  return { inserted, duplicates };
}

// ============== Read operations ==============

/**
 * Get all cost events, optionally filtered.
 */
export function queryMemoryExtractionCostUsd(opts: {
  issueId: string;
  startTs: string;
  endTs?: string;
}): number {
  // Fast-path: cached daily total avoids sync SQLite on the event loop
  if (!opts.endTs) {
    const cached = getCachedMemoryExtractionCostUsd(opts);
    if (cached !== null) return cached;
  }

  const db = getDatabase();
  const conditions = [
    'UPPER(issue_id) = UPPER(?)',
    "source_file = 'memory-extraction'",
    'ts >= ?',
  ];
  const params: string[] = [opts.issueId, opts.startTs];
  if (opts.endTs) {
    conditions.push('ts <= ?');
    params.push(opts.endTs);
  }

  const row = db.prepare(`
    SELECT COALESCE(SUM(cost), 0) AS total
    FROM cost_events
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as { total: number } | undefined;
  const result = row?.total ?? 0;

  if (!opts.endTs) {
    dailySpendCache.set(dailySpendCacheKey(opts.issueId, opts.startTs), { total: result, updatedAt: Date.now() });
  }

  return result;
}

export function queryCostEvents(opts: {
  issueId?: string;
  agentId?: string;
  startTs?: string;
  endTs?: string;
  limit?: number;
  offset?: number;
} = {}): CostEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.issueId) {
    conditions.push('UPPER(issue_id) = UPPER(?)');
    params.push(opts.issueId);
  }
  if (opts.agentId) {
    conditions.push('agent_id = ?');
    params.push(opts.agentId);
  }
  if (opts.startTs) {
    conditions.push('ts >= ?');
    params.push(opts.startTs);
  }
  if (opts.endTs) {
    conditions.push('ts <= ?');
    params.push(opts.endTs);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // SQLite requires LIMIT before OFFSET. Use LIMIT -1 (unlimited) when only offset is set.
  let limitClause = '';
  if (opts.limit !== undefined) {
    limitClause = 'LIMIT ?';
    params.push(Math.max(0, Math.floor(opts.limit)));
  } else if (opts.offset !== undefined) {
    limitClause = 'LIMIT -1'; // unlimited — required to precede OFFSET in SQLite
  }
  const offsetClause = opts.offset !== undefined ? 'OFFSET ?' : '';
  if (opts.offset !== undefined) params.push(Math.max(0, Math.floor(opts.offset)));

  const sql = `
    SELECT ts, agent_id, issue_id, session_type, provider, model,
           input, output, cache_read, cache_write, cost, request_id,
           session_id,
           tldr_interceptions, tldr_bypasses, tldr_tokens_saved, tldr_bypass_reasons,
           source_file
    FROM cost_events
    ${where}
    ORDER BY ts ASC
    ${limitClause} ${offsetClause}
  `;

  const rows = db.prepare(sql).all(...params) as DbCostRow[];
  return rows.map(rowToCostEvent);
}

/**
 * Get aggregated costs by issue.
 */
export function getCostsByIssueFromDb(): Record<string, IssueAggregate> {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT
      UPPER(issue_id) as issue_id,
      SUM(cost)        as total_cost,
      SUM(input)       as input_tokens,
      SUM(output)      as output_tokens,
      SUM(cache_read)  as cache_read_tokens,
      SUM(cache_write) as cache_write_tokens,
      MAX(ts)          as last_updated
    FROM cost_events
    GROUP BY UPPER(issue_id)
    ORDER BY total_cost DESC
  `).all() as DbIssueSummaryRow[];

  const result: Record<string, IssueAggregate> = {};

  for (const row of rows) {
    const models = getModelBreakdownForIssue(db, row.issue_id);
    const stages = getStageBreakdownForIssue(db, row.issue_id);
    result[row.issue_id] = {
      issueId: row.issue_id,
      totalCost: row.total_cost,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      lastUpdated: row.last_updated,
      budgetWarning: false, // Set externally
      models,
      stages,
    };
  }

  return result;
}

/**
 * Get aggregated costs for a single issue.
 */
export function getCostForIssueFromDb(issueId: string): IssueAggregate | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT
      UPPER(issue_id) as issue_id,
      SUM(cost)        as total_cost,
      SUM(input)       as input_tokens,
      SUM(output)      as output_tokens,
      SUM(cache_read)  as cache_read_tokens,
      SUM(cache_write) as cache_write_tokens,
      MAX(ts)          as last_updated
    FROM cost_events
    WHERE UPPER(issue_id) = UPPER(?)
    GROUP BY UPPER(issue_id)
  `).get(issueId) as DbIssueSummaryRow | undefined;

  if (!row) return null;

  const models = getModelBreakdownForIssue(db, row.issue_id);
  const stages = getStageBreakdownForIssue(db, row.issue_id);

  return {
    issueId: row.issue_id,
    totalCost: row.total_cost,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    lastUpdated: row.last_updated,
    budgetWarning: false,
    models,
    stages,
  };
}

/**
 * Get daily cost totals for trend charts.
 */
export function getDailyTrends(opts: { days?: number; issueId?: string } = {}): DailyTrend[] {
  const db = getDatabase();
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const conditions = ['ts >= ?'];
  const params: (string | number)[] = [since];

  if (opts.issueId) {
    conditions.push('UPPER(issue_id) = UPPER(?)');
    params.push(opts.issueId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT
      DATE(ts) as date,
      SUM(cost) as total_cost,
      COUNT(*) as event_count,
      SUM(input + output + cache_read + cache_write) as total_tokens
    FROM cost_events
    ${where}
    GROUP BY DATE(ts)
    ORDER BY date ASC
  `).all(...params) as Array<{ date: string; total_cost: number; event_count: number; total_tokens: number }>;

  return rows.map(r => ({
    date: r.date,
    totalCost: r.total_cost,
    eventCount: r.event_count,
    totalTokens: r.total_tokens,
  }));
}

/**
 * Get model-level rollup across all issues or for a specific issue.
 */
export function getModelRollup(issueId?: string): ModelRollup[] {
  const db = getDatabase();
  const where = issueId ? 'WHERE UPPER(issue_id) = UPPER(?)' : '';
  const params = issueId ? [issueId] : [];

  const rows = db.prepare(`
    SELECT
      model,
      SUM(cost) as total_cost,
      COUNT(*) as calls,
      SUM(input + output + cache_read + cache_write) as total_tokens
    FROM cost_events
    ${where}
    GROUP BY model
    ORDER BY total_cost DESC
  `).all(...params) as Array<{ model: string; total_cost: number; calls: number; total_tokens: number }>;

  return rows.map(r => ({
    model: r.model,
    totalCost: r.total_cost,
    calls: r.calls,
    totalTokens: r.total_tokens,
  }));
}

/**
 * Get per-agent (developer) cost rollup for multi-developer display.
 */
export function getAgentRollup(issueId?: string): AgentRollup[] {
  const db = getDatabase();
  const where = issueId ? 'WHERE UPPER(issue_id) = UPPER(?)' : '';
  const params = issueId ? [issueId] : [];

  const rows = db.prepare(`
    SELECT
      agent_id,
      SUM(cost) as total_cost,
      COUNT(*) as calls,
      SUM(input + output + cache_read + cache_write) as total_tokens,
      MIN(ts) as first_event,
      MAX(ts) as last_event
    FROM cost_events
    ${where}
    GROUP BY agent_id
    ORDER BY total_cost DESC
  `).all(...params) as Array<{
    agent_id: string;
    total_cost: number;
    calls: number;
    total_tokens: number;
    first_event: string;
    last_event: string;
  }>;

  return rows.map(r => ({
    agentId: r.agent_id,
    totalCost: r.total_cost,
    calls: r.calls,
    totalTokens: r.total_tokens,
    firstEvent: r.first_event,
    lastEvent: r.last_event,
  }));
}

// ============== Helpers ==============

function getModelBreakdownForIssue(db: import('better-sqlite3').Database, issueId: string): Record<string, ModelBreakdown> {
  const rows = db.prepare(`
    SELECT model, SUM(cost) as cost, COUNT(*) as calls,
           SUM(input + output + cache_read + cache_write) as tokens
    FROM cost_events
    WHERE UPPER(issue_id) = ?
    GROUP BY model
  `).all(issueId.toUpperCase()) as Array<{ model: string; cost: number; calls: number; tokens: number }>;

  const result: Record<string, ModelBreakdown> = {};
  for (const r of rows) {
    result[r.model] = { cost: r.cost, calls: r.calls, tokens: r.tokens };
  }
  return result;
}

function getStageBreakdownForIssue(db: import('better-sqlite3').Database, issueId: string): Record<string, StageBreakdown> {
  const rows = db.prepare(`
    SELECT session_type as stage, SUM(cost) as cost, COUNT(*) as calls,
           SUM(input + output + cache_read + cache_write) as tokens
    FROM cost_events
    WHERE UPPER(issue_id) = ?
    GROUP BY session_type
  `).all(issueId.toUpperCase()) as Array<{ stage: string; cost: number; calls: number; tokens: number }>;

  const result: Record<string, StageBreakdown> = {};
  for (const r of rows) {
    result[r.stage] = { cost: r.cost, calls: r.calls, tokens: r.tokens };
  }
  return result;
}

/**
 * Get caveman A/B experiment data: median output tokens and first-try review pass rate
 * grouped by caveman_variant. Only returns rows where caveman_variant IS NOT NULL.
 */
export function getCavemanExperimentData(): CavemanExperimentRow[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT
      caveman_variant,
      COUNT(*) as event_count,
      AVG(output) as avg_output_tokens,
      SUM(output) as total_output_tokens,
      AVG(input) as avg_input_tokens,
      AVG(cost) as avg_cost,
      SUM(cost) as total_cost
    FROM cost_events
    WHERE caveman_variant IS NOT NULL
    GROUP BY caveman_variant
    ORDER BY caveman_variant
  `).all() as Array<{
    caveman_variant: string;
    event_count: number;
    avg_output_tokens: number;
    total_output_tokens: number;
    avg_input_tokens: number;
    avg_cost: number;
    total_cost: number;
  }>;

  return rows.map(r => ({
    variant: r.caveman_variant,
    eventCount: r.event_count,
    avgOutputTokens: Math.round(r.avg_output_tokens),
    totalOutputTokens: r.total_output_tokens,
    avgInputTokens: Math.round(r.avg_input_tokens),
    avgCost: r.avg_cost,
    totalCost: r.total_cost,
  }));
}

// ============== Row/type mapping ==============

interface DbCostRow {
  ts: string;
  agent_id: string;
  issue_id: string;
  session_type: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  request_id: string | null;
  session_id: string | null;
  tldr_interceptions: number | null;
  tldr_bypasses: number | null;
  tldr_tokens_saved: number | null;
  tldr_bypass_reasons: string | null;
  source_file: string | null;
  caveman_variant: string | null;
}

interface DbIssueSummaryRow {
  issue_id: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  last_updated: string;
}

function rowToCostEvent(row: DbCostRow): CostEvent {
  return {
    ts: row.ts,
    type: 'cost',
    agentId: row.agent_id,
    issueId: row.issue_id,
    sessionType: row.session_type,
    provider: row.provider,
    model: row.model,
    input: row.input,
    output: row.output,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    cost: row.cost,
    requestId: row.request_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    source: row.source_file ?? undefined,
    tldrInterceptions: row.tldr_interceptions ?? undefined,
    tldrBypasses: row.tldr_bypasses ?? undefined,
    tldrTokensSaved: row.tldr_tokens_saved ?? undefined,
    tldrBypassReasons: row.tldr_bypass_reasons ? JSON.parse(row.tldr_bypass_reasons) : undefined,
    // caveman_variant is written only by injectCavemanSettings/determineCavemanVariant,
    // which guarantee values in {'enabled','disabled','off'} — no unknown values in practice.
    cavemanVariant: (row.caveman_variant as 'enabled' | 'disabled' | 'off' | undefined) ?? undefined,
  };
}

// ============== Export types ==============

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

export interface CavemanExperimentRow {
  variant: string;
  eventCount: number;
  avgOutputTokens: number;
  totalOutputTokens: number;
  avgInputTokens: number;
  avgCost: number;
  totalCost: number;
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

export interface DailyTrend {
  date: string;
  totalCost: number;
  eventCount: number;
  totalTokens: number;
}

export interface ModelRollup {
  model: string;
  totalCost: number;
  calls: number;
  totalTokens: number;
}

export interface AgentRollup {
  agentId: string;
  totalCost: number;
  calls: number;
  totalTokens: number;
  firstEvent: string;
  lastEvent: string;
}
