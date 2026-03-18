/**
 * Cost Events SQLite Storage
 *
 * Provides SQLite-backed storage for CostEvent records.
 * Deduplication is enforced via UNIQUE index on request_id.
 */

import { getDatabase } from './index.js';
import type { CostEvent } from '../costs/events.js';

// ============== Write operations ==============

/**
 * Insert a cost event. Returns the new row ID, or null if it was a duplicate.
 * Deduplication is handled by the UNIQUE index on request_id.
 */
export function insertCostEvent(event: CostEvent): number | null {
  const db = getDatabase();
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO cost_events (
        ts, agent_id, issue_id, session_type, provider, model,
        input, output, cache_read, cache_write, cost, request_id,
        tldr_interceptions, tldr_bypasses, tldr_tokens_saved, tldr_bypass_reasons
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      event.tldrInterceptions ?? null,
      event.tldrBypasses ?? null,
      event.tldrTokensSaved ?? null,
      event.tldrBypassReasons ? JSON.stringify(event.tldrBypassReasons) : null,
    );
    if (result.changes === 0) return null; // Duplicate
    return result.lastInsertRowid as number;
  } catch (err) {
    // Handle non-requestId duplicates gracefully
    console.error('[cost-events-db] Insert failed:', err);
    return null;
  }
}

/**
 * Insert multiple cost events in a single transaction.
 * Returns { inserted, duplicates } counts.
 */
export function insertCostEvents(events: CostEvent[]): { inserted: number; duplicates: number } {
  const db = getDatabase();
  let inserted = 0;
  let duplicates = 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO cost_events (
      ts, agent_id, issue_id, session_type, provider, model,
      input, output, cache_read, cache_write, cost, request_id,
      tldr_interceptions, tldr_bypasses, tldr_tokens_saved, tldr_bypass_reasons,
      source_file
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((evs: CostEvent[], sourceFile?: string) => {
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
        ev.tldrInterceptions ?? null,
        ev.tldrBypasses ?? null,
        ev.tldrTokensSaved ?? null,
        ev.tldrBypassReasons ? JSON.stringify(ev.tldrBypassReasons) : null,
        sourceFile ?? null,
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
  const limit = opts.limit ? `LIMIT ${opts.limit}` : '';
  const offset = opts.offset ? `OFFSET ${opts.offset}` : '';

  const sql = `
    SELECT ts, agent_id, issue_id, session_type, provider, model,
           input, output, cache_read, cache_write, cost, request_id,
           tldr_interceptions, tldr_bypasses, tldr_tokens_saved, tldr_bypass_reasons
    FROM cost_events
    ${where}
    ORDER BY ts ASC
    ${limit} ${offset}
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
  tldr_interceptions: number | null;
  tldr_bypasses: number | null;
  tldr_tokens_saved: number | null;
  tldr_bypass_reasons: string | null;
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
    tldrInterceptions: row.tldr_interceptions ?? undefined,
    tldrBypasses: row.tldr_bypasses ?? undefined,
    tldrTokensSaved: row.tldr_tokens_saved ?? undefined,
    tldrBypassReasons: row.tldr_bypass_reasons ? JSON.parse(row.tldr_bypass_reasons) : undefined,
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
