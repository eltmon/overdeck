/**
 * Overdeck door for discovered_sessions — the index of all Claude Code JSONL
 * sessions found on disk, inside and outside Panopticon.
 *
 * Public API mirrors the old database/discovered-sessions-db.ts to keep
 * consumers unchanged. All reads/writes go through getOverdeckDatabaseSync().
 *
 * Note: sessions_fts is a FTS5 virtual table created inline here (not in the
 * migration SQL) so it stays outside the OVERDECK_TABLE_COUNT check.
 */

import { getOverdeckDatabaseSync } from './infra.js';

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

let _schemaBootstrapped = false;

function ensureSchema(): void {
  if (_schemaBootstrapped) return;
  const db = getOverdeckDatabaseSync();
  // The five regular tables are in the migration SQL (0000_overdeck_init.sql)
  // and will already exist on new overdeck.db instances. The IF NOT EXISTS guard
  // handles existing databases that predate this migration addition.
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      jsonl_path        TEXT    NOT NULL UNIQUE,
      session_id        TEXT,
      workspace_path    TEXT,
      workspace_hash    TEXT,
      message_count     INTEGER NOT NULL DEFAULT 0,
      first_ts          TEXT,
      last_ts           TEXT,
      models_used       TEXT,
      primary_model     TEXT,
      token_input       INTEGER NOT NULL DEFAULT 0,
      token_output      INTEGER NOT NULL DEFAULT 0,
      estimated_cost    REAL    NOT NULL DEFAULT 0,
      tools_used        TEXT,
      files_touched     TEXT,
      tags              TEXT,
      summary           TEXT,
      summary_detailed  TEXT,
      enrichment_level  INTEGER NOT NULL DEFAULT 0,
      enrichment_model  TEXT,
      enriched_at       TEXT,
      enrichment_failed INTEGER NOT NULL DEFAULT 0,
      panopticon_managed INTEGER NOT NULL DEFAULT 0,
      pan_issue_id      TEXT,
      pan_agent_id      TEXT,
      file_size         INTEGER,
      file_mtime        TEXT,
      scanned_at        TEXT    NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_workspace ON discovered_sessions(workspace_path)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_last_ts ON discovered_sessions(last_ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_enrichment ON discovered_sessions(enrichment_level, enriched_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_managed ON discovered_sessions(panopticon_managed, pan_issue_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_model ON discovered_sessions(primary_model)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_session_id ON discovered_sessions(session_id) WHERE session_id IS NOT NULL`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_session_tags (
      session_id INTEGER NOT NULL REFERENCES discovered_sessions(id) ON DELETE CASCADE,
      tag        TEXT    NOT NULL,
      PRIMARY KEY (session_id, tag)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_session_tags_tag ON discovered_session_tags(tag, session_id)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_session_tools (
      session_id INTEGER NOT NULL REFERENCES discovered_sessions(id) ON DELETE CASCADE,
      tool       TEXT    NOT NULL,
      PRIMARY KEY (session_id, tool)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_session_tools_tool ON discovered_session_tools(tool, session_id)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_session_files (
      session_id INTEGER NOT NULL REFERENCES discovered_sessions(id) ON DELETE CASCADE,
      file_path  TEXT    NOT NULL,
      PRIMARY KEY (session_id, file_path)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovered_session_files_file_path ON discovered_session_files(file_path, session_id)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_embeddings (
      session_id INTEGER NOT NULL REFERENCES discovered_sessions(id) ON DELETE CASCADE,
      model      TEXT    NOT NULL,
      dim        INTEGER NOT NULL,
      embedding  BLOB    NOT NULL,
      created_at TEXT    NOT NULL,
      PRIMARY KEY (session_id, model)
    )
  `);
  // FTS5 virtual table — not in migration SQL, created inline.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      summary,
      summary_detailed,
      tags,
      files_touched,
      content='discovered_sessions',
      content_rowid='id'
    )
  `);
  _schemaBootstrapped = true;
}

function overdeckDb() {
  ensureSchema();
  return getOverdeckDatabaseSync();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredSession {
  id: number;
  jsonlPath: string;
  sessionId: string | null;
  workspacePath: string | null;
  workspaceHash: string | null;
  messageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  modelsUsed: string[];
  primaryModel: string | null;
  tokenInput: number;
  tokenOutput: number;
  estimatedCost: number;
  toolsUsed: string[];
  filesTouched: string[];
  tags: string[];
  summary: string | null;
  summaryDetailed: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentModel: string | null;
  enrichedAt: string | null;
  enrichmentFailed: boolean;
  panopticonManaged: boolean;
  panIssueId: string | null;
  panAgentId: string | null;
  fileSize: number | null;
  fileMtime: string | null;
  scannedAt: string;
}

export interface ConversationFilter {
  workspacePath?: string;
  primaryModel?: string;
  managed?: boolean;
  unmanaged?: boolean;
  since?: string;          // ISO timestamp
  before?: string;         // ISO timestamp
  after?: string;          // ISO timestamp
  minCost?: number;
  maxCost?: number;
  minMessages?: number;
  tags?: string[];
  tools?: string[];
  files?: string[];
  issueId?: string;
  enriched?: boolean;
  notEnriched?: boolean;
  enrichmentLevel?: number;
  /** Select only sessions with enrichment_level strictly less than this value */
  enrichmentLevelLessThan?: number;
  limit?: number;
  offset?: number;
}

export interface FtsSearchResult {
  id: number;
  rank: number;
}

export interface CosineSearchResult {
  session: DiscoveredSession;
  score: number;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): DiscoveredSession {
  function parseJsonArray(val: unknown): string[] {
    if (!val) return [];
    try { return JSON.parse(val as string) as string[]; } catch { return []; }
  }
  return {
    id: row['id'] as number,
    jsonlPath: row['jsonl_path'] as string,
    sessionId: (row['session_id'] as string | null) ?? null,
    workspacePath: (row['workspace_path'] as string | null) ?? null,
    workspaceHash: (row['workspace_hash'] as string | null) ?? null,
    messageCount: (row['message_count'] as number) ?? 0,
    firstTs: (row['first_ts'] as string | null) ?? null,
    lastTs: (row['last_ts'] as string | null) ?? null,
    modelsUsed: parseJsonArray(row['models_used']),
    primaryModel: (row['primary_model'] as string | null) ?? null,
    tokenInput: (row['token_input'] as number) ?? 0,
    tokenOutput: (row['token_output'] as number) ?? 0,
    estimatedCost: (row['estimated_cost'] as number) ?? 0,
    toolsUsed: parseJsonArray(row['tools_used']),
    filesTouched: parseJsonArray(row['files_touched']),
    tags: parseJsonArray(row['tags']),
    summary: (row['summary'] as string | null) ?? null,
    summaryDetailed: (row['summary_detailed'] as string | null) ?? null,
    enrichmentLevel: ((row['enrichment_level'] as number) ?? 0) as 0 | 1 | 2 | 3,
    enrichmentModel: (row['enrichment_model'] as string | null) ?? null,
    enrichedAt: (row['enriched_at'] as string | null) ?? null,
    enrichmentFailed: Boolean(row['enrichment_failed']),
    panopticonManaged: Boolean(row['panopticon_managed']),
    panIssueId: (row['pan_issue_id'] as string | null) ?? null,
    panAgentId: (row['pan_agent_id'] as string | null) ?? null,
    fileSize: (row['file_size'] as number | null) ?? null,
    fileMtime: (row['file_mtime'] as string | null) ?? null,
    scannedAt: row['scanned_at'] as string,
  };
}

// ─── Filter SQL builder ───────────────────────────────────────────────────────

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

type ArrayIndexTarget =
  | { table: 'discovered_session_tags'; column: 'tag' }
  | { table: 'discovered_session_tools'; column: 'tool' }
  | { table: 'discovered_session_files'; column: 'file_path' };

function arrayIndexCondition(target: ArrayIndexTarget, sessionIdExpression: string, values: string[]): { sql: string; params: string[] } | null {
  const filtered = uniqueStrings(values);
  if (filtered.length === 0) return null;
  return {
    sql: `EXISTS (SELECT 1 FROM ${target.table} idx WHERE idx.session_id = ${sessionIdExpression} AND idx.${target.column} IN (${filtered.map(() => '?').join(',')}))`,
    params: filtered,
  };
}

function buildFilterSql(filter: ConversationFilter, tableAlias?: string): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const col = (name: string) => tableAlias ? `${tableAlias}.${name}` : name;

  if (filter.workspacePath !== undefined) { conditions.push(`${col('workspace_path')} = ?`); params.push(filter.workspacePath); }
  if (filter.primaryModel !== undefined) { conditions.push(`${col('primary_model')} = ?`); params.push(filter.primaryModel); }
  if (filter.managed === true) conditions.push(`${col('panopticon_managed')} = 1`);
  if (filter.unmanaged === true) conditions.push(`${col('panopticon_managed')} = 0`);
  if (filter.since !== undefined) { conditions.push(`${col('last_ts')} >= ?`); params.push(filter.since); }
  if (filter.before !== undefined) { conditions.push(`${col('last_ts')} < ?`); params.push(filter.before); }
  if (filter.after !== undefined) { conditions.push(`${col('first_ts')} >= ?`); params.push(filter.after); }
  if (filter.minCost !== undefined) { conditions.push(`${col('estimated_cost')} >= ?`); params.push(filter.minCost); }
  if (filter.maxCost !== undefined) { conditions.push(`${col('estimated_cost')} <= ?`); params.push(filter.maxCost); }
  if (filter.minMessages !== undefined) { conditions.push(`${col('message_count')} >= ?`); params.push(filter.minMessages); }
  if (filter.issueId !== undefined) { conditions.push(`${col('pan_issue_id')} = ?`); params.push(filter.issueId); }
  if (filter.enriched === true) conditions.push(`${col('enrichment_level')} > 0`);
  if (filter.notEnriched === true) conditions.push(`${col('enrichment_level')} = 0`);
  if (filter.enrichmentLevel !== undefined) { conditions.push(`${col('enrichment_level')} = ?`); params.push(filter.enrichmentLevel); }
  if (filter.enrichmentLevelLessThan !== undefined) { conditions.push(`${col('enrichment_level')} < ?`); params.push(filter.enrichmentLevelLessThan); }

  const tagCondition = filter.tags ? arrayIndexCondition({ table: 'discovered_session_tags', column: 'tag' }, col('id'), filter.tags) : null;
  if (tagCondition) { conditions.push(tagCondition.sql); params.push(...tagCondition.params); }
  const toolCondition = filter.tools ? arrayIndexCondition({ table: 'discovered_session_tools', column: 'tool' }, col('id'), filter.tools) : null;
  if (toolCondition) { conditions.push(toolCondition.sql); params.push(...toolCondition.params); }
  const fileCondition = filter.files ? arrayIndexCondition({ table: 'discovered_session_files', column: 'file_path' }, col('id'), filter.files) : null;
  if (fileCondition) { conditions.push(fileCondition.sql); params.push(...fileCondition.params); }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

// ─── Read operations ──────────────────────────────────────────────────────────

export function getDiscoveredSessionById(id: number): DiscoveredSession | null {
  const db = overdeckDb();
  const row = db.prepare(`SELECT * FROM discovered_sessions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function findDiscoveredSessions(filter: ConversationFilter = {}): DiscoveredSession[] {
  const db = overdeckDb();
  const { where, params } = buildFilterSql(filter);
  const safeLimit = Number.isFinite(filter.limit) && filter.limit! >= 0 ? filter.limit! : undefined;
  const safeOffset = Number.isFinite(filter.offset) && filter.offset! >= 0 ? filter.offset! : undefined;
  const limit = safeLimit !== undefined ? `LIMIT ${safeLimit}` : '';
  const offset = safeOffset !== undefined ? `OFFSET ${safeOffset}` : '';
  const rows = db.prepare(
    `SELECT * FROM discovered_sessions ${where} ORDER BY last_ts DESC NULLS LAST ${limit} ${offset}`,
  ).all(...params) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function countDiscoveredSessions(filter: ConversationFilter = {}): number {
  const db = overdeckDb();
  const { where, params } = buildFilterSql(filter);
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM discovered_sessions ${where}`).get(...params) as { cnt: number };
  return row.cnt;
}

export function aggregateDiscoveredSessionCost(filter: ConversationFilter = {}): {
  sessionCount: number;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
} {
  const db = overdeckDb();
  const { where, params } = buildFilterSql(filter);
  const row = db.prepare(
    `SELECT COUNT(*) AS sessionCount,
            COALESCE(SUM(estimated_cost), 0) AS totalCost,
            COALESCE(SUM(token_input), 0) AS totalTokensIn,
            COALESCE(SUM(token_output), 0) AS totalTokensOut
     FROM discovered_sessions ${where}`,
  ).get(...params) as { sessionCount: number; totalCost: number; totalTokensIn: number; totalTokensOut: number };
  return row;
}

export function aggregateDiscoveredSessionCostBy(
  groupBy: 'workspace' | 'model' | 'day' | 'month',
  filter: ConversationFilter = {},
): {
  groupBy: 'workspace' | 'model' | 'day' | 'month';
  entries: Array<{ key: string; totalCost: number; sessionCount: number; totalTokensIn: number; totalTokensOut: number }>;
  grandTotal: number;
  totalTokensIn: number;
  totalTokensOut: number;
} {
  const db = overdeckDb();
  const { where, params } = buildFilterSql({ ...filter, limit: undefined, offset: undefined });
  const keyExpr = (() => {
    switch (groupBy) {
      case 'workspace': return `COALESCE(workspace_path, '(unknown)')`;
      case 'model':     return `COALESCE(primary_model, '(unknown)')`;
      case 'day':       return `COALESCE(substr(last_ts, 1, 10), '(unknown)')`;
      case 'month':     return `COALESCE(substr(last_ts, 1, 7), '(unknown)')`;
    }
  })();
  const rows = db.prepare(
    `SELECT ${keyExpr} AS key,
            COALESCE(SUM(estimated_cost), 0) AS totalCost,
            COUNT(*) AS sessionCount,
            COALESCE(SUM(token_input), 0) AS totalTokensIn,
            COALESCE(SUM(token_output), 0) AS totalTokensOut
     FROM discovered_sessions ${where}
     GROUP BY ${keyExpr}
     ORDER BY totalCost DESC`,
  ).all(...params) as Array<{ key: string; totalCost: number; sessionCount: number; totalTokensIn: number; totalTokensOut: number }>;
  const total = aggregateDiscoveredSessionCost(filter);
  return { groupBy, entries: rows, grandTotal: total.totalCost, totalTokensIn: total.totalTokensIn, totalTokensOut: total.totalTokensOut };
}

export function getDiscoveredStats(): {
  total: number;
  enriched: number;
  embedded: number;
  managedCount: number;
  embeddingModels: Array<{ model: string; embedded: number }>;
} {
  const db = overdeckDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM discovered_sessions`).get() as { n: number }).n;
  const enriched = (db.prepare(`SELECT COUNT(*) AS n FROM discovered_sessions WHERE enrichment_level > 0`).get() as { n: number }).n;
  const embedded = (db.prepare(`SELECT COUNT(DISTINCT session_id) AS n FROM session_embeddings`).get() as { n: number }).n;
  const managedCount = (db.prepare(`SELECT COUNT(*) AS n FROM discovered_sessions WHERE panopticon_managed = 1`).get() as { n: number }).n;
  const embeddingModels = db.prepare(
    `SELECT model, COUNT(DISTINCT session_id) AS embedded FROM session_embeddings GROUP BY model ORDER BY embedded DESC, model ASC`,
  ).all() as Array<{ model: string; embedded: number }>;
  return { total, enriched, embedded, managedCount, embeddingModels };
}
