/**
 * Overdeck door for discovered_sessions — the index of all Claude Code JSONL
 * sessions found on disk, inside and outside Overdeck.
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

/** Reset the schema-bootstrapped flag (e.g. after closing a DB handle in tests). */
export function resetDiscoveredSessionsSchemaBootstrap(): void {
  _schemaBootstrapped = false;
}

/** Ensure discovered_sessions schema tables exist (idempotent). */
export function ensureDiscoveredSessionsSchema(): void {
  ensureSchema();
}

function ensureSchema(): void {
  if (_schemaBootstrapped) return;
  const db = getOverdeckDatabaseSync();
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
  harness: string;
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
  /** Title of the tracked conversation this session belongs to (matched by session id), or null. */
  conversationTitle: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentModel: string | null;
  enrichedAt: string | null;
  enrichmentFailed: boolean;
  overdeckManaged: boolean;
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

function toMillis(value: string | null | undefined): number | null {
  if (value == null) return null;
  return new Date(value).getTime();
}

function toIso(value: number | null | undefined): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

function rowToSession(row: Record<string, unknown>): DiscoveredSession {
  function parseJsonArray(val: unknown): string[] {
    if (!val) return [];
    try { return JSON.parse(val as string) as string[]; } catch { return []; }
  }
  return {
    id: row['id'] as number,
    jsonlPath: row['jsonl_path'] as string,
    harness: (row['harness'] as string | null) ?? 'claude-code',
    sessionId: (row['session_id'] as string | null) ?? null,
    workspacePath: (row['workspace_path'] as string | null) ?? null,
    workspaceHash: (row['workspace_hash'] as string | null) ?? null,
    messageCount: (row['message_count'] as number) ?? 0,
    firstTs: toIso(row['first_ts'] as number | null),
    lastTs: toIso(row['last_ts'] as number | null),
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
    conversationTitle: (row['conversation_title'] as string | null) ?? null,
    enrichmentLevel: ((row['enrichment_level'] as number) ?? 0) as 0 | 1 | 2 | 3,
    enrichmentModel: (row['enrichment_model'] as string | null) ?? null,
    enrichedAt: toIso(row['enriched_at'] as number | null),
    enrichmentFailed: Boolean(row['enrichment_failed']),
    overdeckManaged: Boolean(row['overdeck_managed']),
    panIssueId: (row['pan_issue_id'] as string | null) ?? null,
    panAgentId: (row['pan_agent_id'] as string | null) ?? null,
    fileSize: (row['file_size'] as number | null) ?? null,
    fileMtime: toIso(row['file_mtime'] as number | null),
    scannedAt: toIso(row['scanned_at'] as number) ?? new Date(0).toISOString(),
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
  if (filter.managed === true) conditions.push(`${col('overdeck_managed')} = 1`);
  if (filter.unmanaged === true) conditions.push(`${col('overdeck_managed')} = 0`);
  if (filter.since !== undefined) { conditions.push(`${col('last_ts')} >= ?`); params.push(toMillis(filter.since)); }
  if (filter.before !== undefined) { conditions.push(`${col('last_ts')} < ?`); params.push(toMillis(filter.before)); }
  if (filter.after !== undefined) { conditions.push(`${col('first_ts')} >= ?`); params.push(toMillis(filter.after)); }
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

/**
 * Fill in `conversationTitle` for any sessions whose `sessionId` matches a tracked
 * conversation (via conversation_files.locator → conversations.title). One batched
 * query for the whole list — no N+1. Sessions with no matching conversation are
 * returned unchanged (conversationTitle stays null).
 */
function attachConversationTitles(sessions: DiscoveredSession[]): DiscoveredSession[] {
  const ids = [...new Set(sessions.map((s) => s.sessionId).filter((x): x is string => !!x))];
  if (ids.length === 0) return sessions;
  const placeholders = ids.map(() => '?').join(',');
  const rows = overdeckDb()
    .prepare(
      `SELECT cf.locator AS sid, c.title AS title
       FROM conversation_files cf
       JOIN conversations c ON c.id = cf.conversation_id
       WHERE cf.locator IN (${placeholders}) AND c.title IS NOT NULL`,
    )
    .all(...ids) as { sid: string; title: string }[];
  if (rows.length === 0) return sessions;
  const byId = new Map<string, string>();
  for (const r of rows) if (!byId.has(r.sid)) byId.set(r.sid, r.title);
  return sessions.map((s) =>
    s.sessionId && byId.has(s.sessionId) ? { ...s, conversationTitle: byId.get(s.sessionId)! } : s,
  );
}

export function getDiscoveredSessionById(id: number): DiscoveredSession | null {
  const db = overdeckDb();
  const row = db.prepare(`SELECT * FROM discovered_sessions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? attachConversationTitles([rowToSession(row)])[0]! : null;
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
  return attachConversationTitles(rows.map(rowToSession));
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
      case 'day':       return `COALESCE(strftime('%Y-%m-%d', last_ts / 1000, 'unixepoch'), '(unknown)')`;
      case 'month':     return `COALESCE(strftime('%Y-%m', last_ts / 1000, 'unixepoch'), '(unknown)')`;
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
  const managedCount = (db.prepare(`SELECT COUNT(*) AS n FROM discovered_sessions WHERE overdeck_managed = 1`).get() as { n: number }).n;
  const embeddingModels = db.prepare(
    `SELECT model, COUNT(DISTINCT session_id) AS embedded FROM session_embeddings GROUP BY model ORDER BY embedded DESC, model ASC`,
  ).all() as Array<{ model: string; embedded: number }>;
  return { total, enriched, embedded, managedCount, embeddingModels };
}

// ─── Additional read operations ────────────────────────────────────────────────

export function getDiscoveredSessionByJsonlPath(jsonlPath: string): DiscoveredSession | null {
  const db = overdeckDb();
  const row = db.prepare(`SELECT * FROM discovered_sessions WHERE jsonl_path = ?`).get(jsonlPath) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function findDiscoveredSessionIds(filter: ConversationFilter = {}): number[] {
  const db = overdeckDb();
  const { where, params } = buildFilterSql(filter);
  const safeLimit = Number.isFinite(filter.limit) && filter.limit! >= 0 ? filter.limit! : undefined;
  const safeOffset = Number.isFinite(filter.offset) && filter.offset! >= 0 ? filter.offset! : undefined;
  const limit = safeLimit !== undefined ? `LIMIT ${safeLimit}` : '';
  const offset = safeOffset !== undefined ? `OFFSET ${safeOffset}` : '';
  const rows = db.prepare(
    `SELECT id FROM discovered_sessions ${where} ORDER BY last_ts DESC NULLS LAST ${limit} ${offset}`,
  ).all(...params) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

export function findEnrichedSessionIdsMissingEmbedding(model: string): number[] {
  const db = overdeckDb();
  const rows = db.prepare(
    `SELECT ds.id
     FROM discovered_sessions ds
     WHERE ds.enrichment_level > 0
       AND NOT EXISTS (
         SELECT 1 FROM session_embeddings se
         WHERE se.session_id = ds.id AND se.model = ?
       )
     ORDER BY ds.last_ts DESC NULLS LAST`,
  ).all(model) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

// ─── Write operations ─────────────────────────────────────────────────────────

export interface UpsertDiscoveredSessionOpts {
  jsonlPath: string;
  harness: string;
  sessionId?: string | null;
  workspacePath?: string | null;
  workspaceHash?: string | null;
  messageCount?: number;
  firstTs?: string | null;
  lastTs?: string | null;
  modelsUsed?: string[];
  primaryModel?: string | null;
  tokenInput?: number;
  tokenOutput?: number;
  estimatedCost?: number;
  toolsUsed?: string[];
  filesTouched?: string[];
  tags?: string[];
  overdeckManaged?: boolean;
  panIssueId?: string | null;
  panAgentId?: string | null;
  fileSize?: number | null;
  fileMtime?: string | null;
}

type FtsRow = {
  enrichment_level: number;
  summary: string | null;
  summary_detailed: string | null;
  tags: string | null;
  files_touched: string | null;
};

function getFtsRow(id: number): FtsRow | undefined {
  return overdeckDb()
    .prepare(
      `SELECT enrichment_level, summary, summary_detailed, tags, files_touched
       FROM discovered_sessions WHERE id = ?`,
    )
    .get(id) as FtsRow | undefined;
}

function replaceFtsRow(id: number, oldRow: FtsRow | undefined): void {
  const db = overdeckDb();
  if (oldRow && oldRow.enrichment_level > 0) {
    db.prepare(
      `INSERT INTO sessions_fts(sessions_fts, rowid, summary, summary_detailed, tags, files_touched)
       VALUES('delete', ?, ?, ?, ?, ?)`,
    ).run(id, oldRow.summary, oldRow.summary_detailed, oldRow.tags, oldRow.files_touched);
  }
  const newRow = getFtsRow(id);
  if (!newRow || newRow.enrichment_level === 0) return;
  db.prepare(
    `INSERT INTO sessions_fts(rowid, summary, summary_detailed, tags, files_touched)
     VALUES(?, ?, ?, ?, ?)`,
  ).run(id, newRow.summary, newRow.summary_detailed, newRow.tags, newRow.files_touched);
}

function replaceSessionArrayIndex(
  target: ArrayIndexTarget,
  sessionId: number,
  values: string[],
): void {
  const db = overdeckDb();
  const replace = db.transaction((items: string[]) => {
    db.prepare(`DELETE FROM ${target.table} WHERE session_id = ?`).run(sessionId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO ${target.table} (session_id, ${target.column}) VALUES (?, ?)`,
    );
    for (const value of uniqueStrings(items)) insert.run(sessionId, value);
  });
  replace(values);
}

function replaceDiscoveredSessionArrayIndexes(session: DiscoveredSession): void {
  replaceSessionArrayIndex({ table: 'discovered_session_tags', column: 'tag' }, session.id, session.tags);
  replaceSessionArrayIndex({ table: 'discovered_session_tools', column: 'tool' }, session.id, session.toolsUsed);
  replaceSessionArrayIndex({ table: 'discovered_session_files', column: 'file_path' }, session.id, session.filesTouched);
}

/**
 * Insert or update a discovered session by jsonl_path.
 * Idempotent: re-inserting the same path updates metadata without duplicates.
 */
export function upsertDiscoveredSession(opts: UpsertDiscoveredSessionOpts): DiscoveredSession {
  const db = overdeckDb();
  const now = Date.now();
  const oldRow = db.prepare(
    `SELECT id, enrichment_level, summary, summary_detailed, tags, files_touched
     FROM discovered_sessions WHERE jsonl_path = ?`,
  ).get(opts.jsonlPath) as (FtsRow & { id: number }) | undefined;

  db.prepare(
    `INSERT INTO discovered_sessions (
       jsonl_path, harness, session_id, workspace_path, workspace_hash,
       message_count, first_ts, last_ts, models_used, primary_model,
       token_input, token_output, estimated_cost,
       tools_used, files_touched, tags,
       overdeck_managed, pan_issue_id, pan_agent_id,
       file_size, file_mtime, scanned_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )
     ON CONFLICT(jsonl_path) DO UPDATE SET
       harness            = excluded.harness,
       session_id         = excluded.session_id,
       workspace_path     = excluded.workspace_path,
       workspace_hash     = excluded.workspace_hash,
       message_count      = excluded.message_count,
       first_ts           = excluded.first_ts,
       last_ts            = excluded.last_ts,
       models_used        = excluded.models_used,
       primary_model      = excluded.primary_model,
       token_input        = excluded.token_input,
       token_output       = excluded.token_output,
       estimated_cost     = excluded.estimated_cost,
       tools_used         = excluded.tools_used,
       files_touched      = excluded.files_touched,
       tags               = CASE WHEN ? = 1 THEN excluded.tags ELSE discovered_sessions.tags END,
       overdeck_managed = excluded.overdeck_managed,
       pan_issue_id       = excluded.pan_issue_id,
       pan_agent_id       = excluded.pan_agent_id,
       file_size          = excluded.file_size,
       file_mtime         = excluded.file_mtime,
       scanned_at         = excluded.scanned_at`,
  ).run(
    opts.jsonlPath,
    opts.harness ?? 'claude-code',
    opts.sessionId ?? null,
    opts.workspacePath ?? null,
    opts.workspaceHash ?? null,
    opts.messageCount ?? 0,
    toMillis(opts.firstTs),
    toMillis(opts.lastTs),
    JSON.stringify(opts.modelsUsed ?? []),
    opts.primaryModel ?? null,
    opts.tokenInput ?? 0,
    opts.tokenOutput ?? 0,
    opts.estimatedCost ?? 0,
    JSON.stringify(opts.toolsUsed ?? []),
    JSON.stringify(opts.filesTouched ?? []),
    JSON.stringify(opts.tags ?? []),
    opts.overdeckManaged ? 1 : 0,
    opts.panIssueId ?? null,
    opts.panAgentId ?? null,
    opts.fileSize ?? null,
    toMillis(opts.fileMtime),
    now,
    opts.tags !== undefined ? 1 : 0,
  );

  const row = db.prepare(`SELECT * FROM discovered_sessions WHERE jsonl_path = ?`).get(opts.jsonlPath) as Record<string, unknown>;
  const session = rowToSession(row);
  replaceDiscoveredSessionArrayIndexes(session);
  if (oldRow && oldRow.enrichment_level > 0) {
    replaceFtsRow(session.id, oldRow);
  }
  return session;
}

/**
 * Update enrichment fields for a discovered session.
 * Also updates the FTS5 index for the session.
 */
export function updateEnrichment(
  id: number,
  opts: {
    enrichmentLevel: 1 | 2 | 3;
    enrichmentModel: string;
    summary?: string | null;
    summaryDetailed?: string | null;
    tags?: string[];
    enrichmentFailed?: boolean;
  },
): void {
  const db = overdeckDb();
  const oldRow = getFtsRow(id);
  db.prepare(
    `UPDATE discovered_sessions SET
       enrichment_level  = ?,
       enrichment_model  = ?,
       enriched_at       = ?,
       summary           = CASE WHEN ? IS NOT NULL THEN ? ELSE summary END,
       summary_detailed  = CASE WHEN ? IS NOT NULL THEN ? ELSE summary_detailed END,
       tags              = CASE WHEN ? IS NOT NULL THEN ? ELSE tags END,
       enrichment_failed = ?
     WHERE id = ?`,
  ).run(
    opts.enrichmentLevel,
    opts.enrichmentModel,
    Date.now(),
    opts.summary ?? null,
    opts.summary ?? null,
    opts.summaryDetailed ?? null,
    opts.summaryDetailed ?? null,
    opts.tags ? JSON.stringify(opts.tags) : null,
    opts.tags ? JSON.stringify(opts.tags) : null,
    opts.enrichmentFailed ? 1 : 0,
    id,
  );
  if (opts.tags) {
    replaceSessionArrayIndex({ table: 'discovered_session_tags', column: 'tag' }, id, opts.tags);
  }
  replaceFtsRow(id, oldRow);
}

/**
 * Mark a session's enrichment as failed without changing level.
 */
export function markEnrichmentFailed(id: number): void {
  overdeckDb().prepare(`UPDATE discovered_sessions SET enrichment_failed = 1 WHERE id = ?`).run(id);
}

// ─── FTS5 operations ──────────────────────────────────────────────────────────

export function searchFtsSessions(
  query: string,
  filter: ConversationFilter = {},
  limit = 50,
  offset = 0,
): DiscoveredSession[] {
  const db = overdeckDb();
  const { where, params } = buildFilterSql(filter, 'ds');
  const whereClause = where ? `${where} AND sessions_fts MATCH ?` : 'WHERE sessions_fts MATCH ?';
  try {
    const rows = db.prepare(
      `SELECT ds.* FROM sessions_fts
       JOIN discovered_sessions ds ON ds.id = sessions_fts.rowid
       ${whereClause}
       ORDER BY sessions_fts.rank
       LIMIT ? OFFSET ?`,
    ).all(...params, query, limit, offset) as Record<string, unknown>[];
    return attachConversationTitles(rows.map(rowToSession));
  } catch {
    return [];
  }
}

export function countFtsSessions(query: string, filter: ConversationFilter = {}): number {
  const db = overdeckDb();
  const { where, params } = buildFilterSql(filter, 'ds');
  const whereClause = where ? `${where} AND sessions_fts MATCH ?` : 'WHERE sessions_fts MATCH ?';
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS cnt FROM sessions_fts
       JOIN discovered_sessions ds ON ds.id = sessions_fts.rowid
       ${whereClause}`,
    ).get(...params, query) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

// ─── Embedding operations ─────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function getDiscoveredSessionsByIds(ids: number[]): Map<number, DiscoveredSession> {
  if (ids.length === 0) return new Map();
  const db = overdeckDb();
  const rows = db.prepare(
    `SELECT * FROM discovered_sessions WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids) as Record<string, unknown>[];
  return new Map(rows.map((row) => {
    const session = rowToSession(row);
    return [session.id, session];
  }));
}

const MAX_SEMANTIC_RESULT_WINDOW = 1_000;

function insertScoredCandidate(
  heap: Array<{ sessionId: number; score: number }>,
  candidate: { sessionId: number; score: number },
  maxSize: number,
): void {
  if (maxSize === 0) return;
  if (heap.length < maxSize) { heap.push(candidate); return; }
  let minIndex = 0;
  for (let i = 1; i < heap.length; i++) {
    if (heap[i]!.score < heap[minIndex]!.score) minIndex = i;
  }
  if (candidate.score > heap[minIndex]!.score) heap[minIndex] = candidate;
}

export function topKCosine(
  queryEmbedding: Float32Array,
  model: string,
  filter: ConversationFilter = {},
  limit = 50,
  offset = 0,
): { results: CosineSearchResult[]; total: number } {
  const db = overdeckDb();
  const { where, params } = buildFilterSql({ ...filter, limit: undefined, offset: undefined }, 'ds');
  const modelClause = where ? `${where} AND se.model = ?` : 'WHERE se.model = ?';
  const safeLimit = Number.isFinite(limit) && limit >= 0 ? limit : 50;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  const windowSize = safeOffset + safeLimit;
  if (windowSize > MAX_SEMANTIC_RESULT_WINDOW) {
    throw new Error(`Semantic search result window exceeds ${MAX_SEMANTIC_RESULT_WINDOW}`);
  }

  const countRow = db.prepare(
    `SELECT COUNT(*) AS cnt
     FROM session_embeddings se
     JOIN discovered_sessions ds ON ds.id = se.session_id
     ${modelClause}`,
  ).get(...params, model) as { cnt: number } | undefined;

  const rows = db.prepare(
    `SELECT se.session_id, se.dim AS embedding_dim, se.embedding AS embedding_blob
     FROM session_embeddings se
     JOIN discovered_sessions ds ON ds.id = se.session_id
     ${modelClause}`,
  );

  const top: Array<{ sessionId: number; score: number }> = [];
  for (const row of rows.iterate(...params, model) as Iterable<{ session_id: number; embedding_dim: number; embedding_blob: Buffer }>) {
    insertScoredCandidate(top, {
      sessionId: row.session_id,
      score: cosineSimilarity(
        queryEmbedding,
        new Float32Array(row.embedding_blob.buffer, row.embedding_blob.byteOffset, row.embedding_dim),
      ),
    }, windowSize);
  }

  const page = top.sort((a, b) => b.score - a.score).slice(safeOffset, safeOffset + safeLimit);
  const sessionsById = getDiscoveredSessionsByIds(page.map((item) => item.sessionId));
  const results = page.flatMap((item) => {
    const session = sessionsById.get(item.sessionId);
    return session ? [{ session, score: item.score }] : [];
  });

  return { results, total: countRow?.cnt ?? top.length };
}

/**
 * Insert or replace an embedding for a session.
 */
export function insertEmbedding(sessionId: number, model: string, embedding: Float32Array): void {
  const db = overdeckDb();
  const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  db.prepare(
    `INSERT INTO session_embeddings (session_id, model, dim, embedding, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, model) DO UPDATE SET
       dim        = excluded.dim,
       embedding  = excluded.embedding,
       created_at = excluded.created_at`,
  ).run(sessionId, model, embedding.length, blob, Date.now());
}

/**
 * Load all embeddings for a given model, optionally filtered by session IDs.
 */
export function loadEmbeddings(
  model: string,
  sessionIds?: number[],
): Array<{ sessionId: number; embedding: Float32Array }> {
  if (sessionIds && sessionIds.length === 0) return [];
  const db = overdeckDb();
  const idClause = sessionIds ? ` AND session_id IN (${sessionIds.map(() => '?').join(',')})` : '';
  const rows = db.prepare(
    `SELECT session_id, dim, embedding FROM session_embeddings WHERE model = ?${idClause}`,
  ).all(...(sessionIds ? [model, ...sessionIds] : [model])) as Array<{ session_id: number; dim: number; embedding: Buffer }>;
  return rows.map((r) => ({
    sessionId: r.session_id,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.dim),
  }));
}

/**
 * Get the embedding for a specific session + model combination.
 */
export function getEmbedding(sessionId: number, model: string): Float32Array | null {
  const db = overdeckDb();
  const row = db.prepare(
    `SELECT dim, embedding FROM session_embeddings WHERE session_id = ? AND model = ?`,
  ).get(sessionId, model) as { dim: number; embedding: Buffer } | undefined;
  if (!row) return null;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dim);
}
