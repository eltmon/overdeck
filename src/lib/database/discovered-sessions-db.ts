/**
 * Discovered Sessions SQLite Storage (PAN-457)
 *
 * CRUD, FTS5 sync, embedding helpers, and filter-based search for
 * the discovered_sessions table — the index of all Claude Code JSONL
 * sessions found on disk, inside and outside Panopticon.
 */

import { getDatabase } from './index.js';

/** Escape LIKE metacharacters so user-supplied strings are matched literally. */
function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

// ─── Types ───────────────────────────────────────────────────────────────────

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

export interface UpsertDiscoveredSessionOpts {
  jsonlPath: string;
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
  panopticonManaged?: boolean;
  panIssueId?: string | null;
  panAgentId?: string | null;
  fileSize?: number | null;
  fileMtime?: string | null;
}

export interface ConversationFilter {
  workspacePath?: string;
  primaryModel?: string;
  managed?: boolean;
  unmanaged?: boolean;
  since?: string;           // ISO timestamp
  before?: string;          // ISO timestamp
  after?: string;           // ISO timestamp
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

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
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

type FtsRow = {
  enrichment_level: number;
  summary: string | null;
  summary_detailed: string | null;
  tags: string | null;
  files_touched: string | null;
};

function getFtsRow(id: number): FtsRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT enrichment_level, summary, summary_detailed, tags, files_touched
       FROM discovered_sessions WHERE id = ?`,
    )
    .get(id) as FtsRow | undefined;
}

function replaceFtsRow(id: number, oldRow: FtsRow | undefined): void {
  const db = getDatabase();
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

// ─── Read operations ──────────────────────────────────────────────────────────

export function getDiscoveredSessionByJsonlPath(jsonlPath: string): DiscoveredSession | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM discovered_sessions WHERE jsonl_path = ?`)
    .get(jsonlPath) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export const getByJsonlPath = getDiscoveredSessionByJsonlPath;

export function getDiscoveredSessionById(id: number): DiscoveredSession | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM discovered_sessions WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

// ─── Filter SQL builder (shared by find + count) ─────────────────────────────

function buildFilterSql(filter: ConversationFilter, tableAlias?: string): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const col = (name: string) => tableAlias ? `${tableAlias}.${name}` : name;

  if (filter.workspacePath !== undefined) {
    conditions.push(`${col('workspace_path')} = ?`);
    params.push(filter.workspacePath);
  }
  if (filter.primaryModel !== undefined) {
    conditions.push(`${col('primary_model')} = ?`);
    params.push(filter.primaryModel);
  }
  if (filter.managed === true) {
    conditions.push(`${col('panopticon_managed')} = 1`);
  }
  if (filter.unmanaged === true) {
    conditions.push(`${col('panopticon_managed')} = 0`);
  }
  if (filter.since !== undefined) {
    conditions.push(`${col('last_ts')} >= ?`);
    params.push(filter.since);
  }
  if (filter.before !== undefined) {
    conditions.push(`${col('last_ts')} < ?`);
    params.push(filter.before);
  }
  if (filter.after !== undefined) {
    conditions.push(`${col('first_ts')} >= ?`);
    params.push(filter.after);
  }
  if (filter.minCost !== undefined) {
    conditions.push(`${col('estimated_cost')} >= ?`);
    params.push(filter.minCost);
  }
  if (filter.maxCost !== undefined) {
    conditions.push(`${col('estimated_cost')} <= ?`);
    params.push(filter.maxCost);
  }
  if (filter.minMessages !== undefined) {
    conditions.push(`${col('message_count')} >= ?`);
    params.push(filter.minMessages);
  }
  if (filter.issueId !== undefined) {
    conditions.push(`${col('pan_issue_id')} = ?`);
    params.push(filter.issueId);
  }
  if (filter.enriched === true) {
    conditions.push(`${col('enrichment_level')} > 0`);
  }
  if (filter.notEnriched === true) {
    conditions.push(`${col('enrichment_level')} = 0`);
  }
  if (filter.enrichmentLevel !== undefined) {
    conditions.push(`${col('enrichment_level')} = ?`);
    params.push(filter.enrichmentLevel);
  }
  if (filter.enrichmentLevelLessThan !== undefined) {
    conditions.push(`${col('enrichment_level')} < ?`);
    params.push(filter.enrichmentLevelLessThan);
  }
  if (filter.tags && filter.tags.length > 0) {
    const tagConditions = filter.tags.map(() => `${col('tags')} LIKE ? ESCAPE '\\'`);
    conditions.push(`(${tagConditions.join(' OR ')})`);
    for (const tag of filter.tags) {
      params.push(`%"${escapeLike(tag)}"%`);
    }
  }
  if (filter.tools && filter.tools.length > 0) {
    const toolConditions = filter.tools.map(() => `${col('tools_used')} LIKE ? ESCAPE '\\'`);
    conditions.push(`(${toolConditions.join(' OR ')})`);
    for (const tool of filter.tools) {
      params.push(`%"${escapeLike(tool)}"%`);
    }
  }
  if (filter.files && filter.files.length > 0) {
    const fileConditions = filter.files.map(() => `${col('files_touched')} LIKE ? ESCAPE '\\'`);
    conditions.push(`(${fileConditions.join(' OR ')})`);
    for (const file of filter.files) {
      params.push(`%${escapeLike(file)}%`);
    }
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Find sessions matching structured filters. Returns rows ordered by last_ts DESC.
 */
export function findDiscoveredSessions(filter: ConversationFilter = {}): DiscoveredSession[] {
  const db = getDatabase();
  const { where, params } = buildFilterSql(filter);
  const safeLimit = Number.isFinite(filter.limit) && filter.limit! >= 0 ? filter.limit! : undefined;
  const safeOffset = Number.isFinite(filter.offset) && filter.offset! >= 0 ? filter.offset! : undefined;
  const limit = safeLimit !== undefined ? `LIMIT ${safeLimit}` : '';
  const offset = safeOffset !== undefined ? `OFFSET ${safeOffset}` : '';

  const rows = db
    .prepare(
      `SELECT * FROM discovered_sessions
       ${where}
       ORDER BY last_ts DESC NULLS LAST
       ${limit} ${offset}`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export const findByFilters = findDiscoveredSessions;

export function findEnrichedSessionsMissingEmbedding(model: string): DiscoveredSession[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT ds.*
       FROM discovered_sessions ds
       WHERE ds.enrichment_level > 0
         AND NOT EXISTS (
           SELECT 1 FROM session_embeddings se
           WHERE se.session_id = ds.id AND se.model = ?
         )
       ORDER BY ds.last_ts DESC NULLS LAST`,
    )
    .all(model) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

/**
 * Count sessions matching filters using a SQL COUNT(*) — no rows materialized.
 */
export function countDiscoveredSessions(filter: ConversationFilter = {}): number {
  const db = getDatabase();
  const { where, params } = buildFilterSql(filter);
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM discovered_sessions ${where}`)
    .get(...params) as { cnt: number };
  return row.cnt;
}

export function aggregateDiscoveredSessionCost(filter: ConversationFilter = {}): {
  sessionCount: number;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
} {
  const db = getDatabase();
  const { where, params } = buildFilterSql(filter);
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS sessionCount,
         COALESCE(SUM(estimated_cost), 0) AS totalCost,
         COALESCE(SUM(token_input), 0) AS totalTokensIn,
         COALESCE(SUM(token_output), 0) AS totalTokensOut
       FROM discovered_sessions ${where}`,
    )
    .get(...params) as {
    sessionCount: number;
    totalCost: number;
    totalTokensIn: number;
    totalTokensOut: number;
  };
  return row;
}

export function aggregateDiscoveredSessionCostBy(groupBy: 'workspace' | 'model'): {
  entries: Array<{ key: string; totalCost: number; sessionCount: number }>;
  grandTotal: number;
} {
  const db = getDatabase();
  const column = groupBy === 'workspace' ? 'workspace_path' : 'primary_model';
  const rows = db
    .prepare(
      `SELECT
         COALESCE(${column}, 'unknown') AS key,
         COALESCE(SUM(estimated_cost), 0) AS totalCost,
         COUNT(*) AS sessionCount
       FROM discovered_sessions
       GROUP BY COALESCE(${column}, 'unknown')
       ORDER BY totalCost DESC`,
    )
    .all() as Array<{ key: string; totalCost: number; sessionCount: number }>;
  const total = db
    .prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS grandTotal FROM discovered_sessions`)
    .get() as { grandTotal: number };
  return { entries: rows, grandTotal: total.grandTotal };
}

// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Insert or update a discovered session by jsonl_path.
 * Idempotent: re-inserting the same path updates metadata without duplicates.
 */
export function upsertDiscoveredSession(opts: UpsertDiscoveredSessionOpts): DiscoveredSession {
  const db = getDatabase();
  const now = new Date().toISOString();
  const oldRow = db
    .prepare(
      `SELECT id, enrichment_level, summary, summary_detailed, tags, files_touched
       FROM discovered_sessions WHERE jsonl_path = ?`,
    )
    .get(opts.jsonlPath) as (FtsRow & { id: number }) | undefined;

  db.prepare(
    `INSERT INTO discovered_sessions (
       jsonl_path, session_id, workspace_path, workspace_hash,
       message_count, first_ts, last_ts, models_used, primary_model,
       token_input, token_output, estimated_cost,
       tools_used, files_touched, tags,
       panopticon_managed, pan_issue_id, pan_agent_id,
       file_size, file_mtime, scanned_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )
     ON CONFLICT(jsonl_path) DO UPDATE SET
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
       panopticon_managed = excluded.panopticon_managed,
       pan_issue_id       = excluded.pan_issue_id,
       pan_agent_id       = excluded.pan_agent_id,
       file_size          = excluded.file_size,
       file_mtime         = excluded.file_mtime,
       scanned_at         = excluded.scanned_at`,
  ).run(
    opts.jsonlPath,
    opts.sessionId ?? null,
    opts.workspacePath ?? null,
    opts.workspaceHash ?? null,
    opts.messageCount ?? 0,
    opts.firstTs ?? null,
    opts.lastTs ?? null,
    JSON.stringify(opts.modelsUsed ?? []),
    opts.primaryModel ?? null,
    opts.tokenInput ?? 0,
    opts.tokenOutput ?? 0,
    opts.estimatedCost ?? 0,
    JSON.stringify(opts.toolsUsed ?? []),
    JSON.stringify(opts.filesTouched ?? []),
    JSON.stringify(opts.tags ?? []),
    opts.panopticonManaged ? 1 : 0,
    opts.panIssueId ?? null,
    opts.panAgentId ?? null,
    opts.fileSize ?? null,
    opts.fileMtime ?? null,
    now,
    opts.tags !== undefined ? 1 : 0,
  );

  const row = db
    .prepare(`SELECT * FROM discovered_sessions WHERE jsonl_path = ?`)
    .get(opts.jsonlPath) as Record<string, unknown>;
  const session = rowToSession(row);
  if (oldRow && oldRow.enrichment_level > 0) {
    replaceFtsRow(session.id, oldRow);
  }
  return session;
}

export const insert = upsertDiscoveredSession;

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
  const db = getDatabase();

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
    new Date().toISOString(),
    opts.summary ?? null,
    opts.summary ?? null,
    opts.summaryDetailed ?? null,
    opts.summaryDetailed ?? null,
    opts.tags ? JSON.stringify(opts.tags) : null,
    opts.tags ? JSON.stringify(opts.tags) : null,
    opts.enrichmentFailed ? 1 : 0,
    id,
  );

  replaceFtsRow(id, oldRow);
}

/**
 * Mark a session's enrichment as failed without changing level.
 */
export function markEnrichmentFailed(id: number): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE discovered_sessions SET enrichment_failed = 1 WHERE id = ?`,
  ).run(id);
}

// ─── FTS5 operations ──────────────────────────────────────────────────────────

/**
 * Rebuild the entire FTS5 index from discovered_sessions. O(n) — use sparingly.
 * Useful after direct SQL edits that bypass updateEnrichment (e.g. in tests).
 * Normal enrichment uses per-row sync inside updateEnrichment instead.
 */
export function syncFts(_id: number): void {
  const db = getDatabase();
  db.prepare(`INSERT INTO sessions_fts(sessions_fts) VALUES('rebuild')`).run();
}

/**
 * Full-text search using FTS5 BM25 ranking.
 * Returns session IDs with their BM25 rank (lower = better match in SQLite FTS5).
 * Returns [] for malformed queries instead of throwing — FTS5 MATCH rejects invalid
 * syntax (unbalanced parens, trailing operators, column: prefixes, etc.) at runtime.
 */
export function searchFts(query: string, limit?: number): FtsSearchResult[] {
  const db = getDatabase();
  try {
    const sql =
      `SELECT rowid AS id, rank FROM sessions_fts WHERE sessions_fts MATCH ? ORDER BY rank` +
      (limit != null ? ' LIMIT ?' : '');
    const rows = (
      limit != null ? db.prepare(sql).all(query, limit) : db.prepare(sql).all(query)
    ) as Array<{ id: number; rank: number }>;
    return rows.map((r) => ({ id: r.id, rank: r.rank }));
  } catch {
    return [];
  }
}

export const searchFTS = searchFts;

/**
 * Count total FTS5 matches for a query without a LIMIT.
 * Returns 0 for malformed queries instead of throwing.
 */
export function countFts(query: string): number {
  const db = getDatabase();
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS cnt FROM sessions_fts WHERE sessions_fts MATCH ?`)
      .get(query) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

export function searchFtsSessions(
  query: string,
  filter: ConversationFilter = {},
  limit = 50,
  offset = 0,
): DiscoveredSession[] {
  const db = getDatabase();
  const { where, params } = buildFilterSql(filter, 'ds');
  const whereClause = where ? `${where} AND sessions_fts MATCH ?` : 'WHERE sessions_fts MATCH ?';
  try {
    const rows = db
      .prepare(
        `SELECT ds.* FROM sessions_fts
         JOIN discovered_sessions ds ON ds.id = sessions_fts.rowid
         ${whereClause}
         ORDER BY sessions_fts.rank
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query, limit, offset) as Record<string, unknown>[];
    return rows.map(rowToSession);
  } catch {
    return [];
  }
}

export function countFtsSessions(
  query: string,
  filter: ConversationFilter = {},
): number {
  const db = getDatabase();
  const { where, params } = buildFilterSql(filter, 'ds');
  const whereClause = where ? `${where} AND sessions_fts MATCH ?` : 'WHERE sessions_fts MATCH ?';
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM sessions_fts
         JOIN discovered_sessions ds ON ds.id = sessions_fts.rowid
         ${whereClause}`,
      )
      .get(...params, query) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Count sessions that match both a FTS5 query and a restricted set of row IDs.
 * Queries discovered_sessions (not the FTS virtual table) to avoid FTS5 quirks
 * with COUNT(*) and rowid IN constraints on content= tables.
 */
export function countFtsInSet(query: string, ids: number[]): number {
  if (ids.length === 0) return 0;
  const db = getDatabase();
  const placeholders = ids.map(() => '?').join(',');
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM discovered_sessions
         WHERE id IN (${placeholders})
         AND id IN (SELECT rowid FROM sessions_fts WHERE sessions_fts MATCH ?)`,
      )
      .get(...ids, query) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

// ─── Embedding operations ─────────────────────────────────────────────────────

const MAX_SEMANTIC_RESULT_WINDOW = 1_000;

function insertScoredCandidate(
  heap: Array<{ sessionId: number; score: number }>,
  candidate: { sessionId: number; score: number },
  maxSize: number,
): void {
  if (maxSize === 0) return;
  if (heap.length < maxSize) {
    heap.push(candidate);
    return;
  }
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
  const db = getDatabase();
  const { where, params } = buildFilterSql({ ...filter, limit: undefined, offset: undefined }, 'ds');
  const modelClause = where ? `${where} AND se.model = ?` : 'WHERE se.model = ?';
  const safeLimit = Number.isFinite(limit) && limit >= 0 ? limit : 50;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  const windowSize = safeOffset + safeLimit;
  if (windowSize > MAX_SEMANTIC_RESULT_WINDOW) {
    throw new Error(`Semantic search result window exceeds ${MAX_SEMANTIC_RESULT_WINDOW}`);
  }

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM session_embeddings se
       JOIN discovered_sessions ds ON ds.id = se.session_id
       ${modelClause}`,
    )
    .get(...params, model) as { cnt: number } | undefined;
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

  const page = top
    .sort((a, b) => b.score - a.score)
    .slice(safeOffset, safeOffset + safeLimit);
  const results = page.flatMap((item) => {
    const session = getDiscoveredSessionById(item.sessionId);
    return session ? [{ session, score: item.score }] : [];
  });

  return { results, total: countRow?.cnt ?? top.length };
}

/**
 * Insert or replace an embedding for a session.
 */
export function insertEmbedding(
  sessionId: number,
  model: string,
  embedding: Float32Array,
): void {
  const db = getDatabase();
  const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  db.prepare(
    `INSERT INTO session_embeddings (session_id, model, dim, embedding, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, model) DO UPDATE SET
       dim       = excluded.dim,
       embedding = excluded.embedding,
       created_at = excluded.created_at`,
  ).run(sessionId, model, embedding.length, blob, new Date().toISOString());
}

/**
 * Load all embeddings for a given model.
 * Returns an array of { sessionId, embedding } for cosine search.
 */
export function loadEmbeddings(
  model: string,
  sessionIds?: number[],
): Array<{ sessionId: number; embedding: Float32Array }> {
  if (sessionIds && sessionIds.length === 0) return [];
  const db = getDatabase();
  const idClause = sessionIds ? ` AND session_id IN (${sessionIds.map(() => '?').join(',')})` : '';
  const rows = db
    .prepare(`SELECT session_id, dim, embedding FROM session_embeddings WHERE model = ?${idClause}`)
    .all(...(sessionIds ? [model, ...sessionIds] : [model])) as Array<{ session_id: number; dim: number; embedding: Buffer }>;
  return rows.map((r) => ({
    sessionId: r.session_id,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.dim),
  }));
}

/**
 * Get the embedding for a specific session + model combo.
 */
export function getEmbedding(
  sessionId: number,
  model: string,
): Float32Array | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT dim, embedding FROM session_embeddings WHERE session_id = ? AND model = ?`)
    .get(sessionId, model) as { dim: number; embedding: Buffer } | undefined;
  if (!row) return null;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dim);
}

/**
 * Get summary of discovered session counts and embedding coverage.
 */
export function getDiscoveredStats(): {
  total: number;
  enriched: number;
  embedded: number;
  managedCount: number;
  embeddingModels: Array<{ model: string; embedded: number }>;
} {
  const db = getDatabase();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM discovered_sessions`).get() as { n: number }
  ).n;
  const enriched = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM discovered_sessions WHERE enrichment_level > 0`)
      .get() as { n: number }
  ).n;
  const embedded = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT session_id) AS n FROM session_embeddings`,
      )
      .get() as { n: number }
  ).n;
  const managedCount = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM discovered_sessions WHERE panopticon_managed = 1`)
      .get() as { n: number }
  ).n;
  const embeddingModels = db
    .prepare(
      `SELECT model, COUNT(DISTINCT session_id) AS embedded
       FROM session_embeddings
       GROUP BY model
       ORDER BY embedded DESC, model ASC`,
    )
    .all() as Array<{ model: string; embedded: number }>;
  return { total, enriched, embedded, managedCount, embeddingModels };
}
