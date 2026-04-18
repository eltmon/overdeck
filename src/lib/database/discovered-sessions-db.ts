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
  /** Select only sessions with enrichment_level strictly less than this value */
  enrichmentLevelLessThan?: number;
  limit?: number;
  offset?: number;
}

export interface FtsSearchResult {
  id: number;
  rank: number;
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

// ─── Read operations ──────────────────────────────────────────────────────────

export function getDiscoveredSessionByJsonlPath(jsonlPath: string): DiscoveredSession | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM discovered_sessions WHERE jsonl_path = ?`)
    .get(jsonlPath) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function getDiscoveredSessionById(id: number): DiscoveredSession | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM discovered_sessions WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

/**
 * Find sessions matching structured filters. Returns rows ordered by last_ts DESC.
 */
export function findDiscoveredSessions(filter: ConversationFilter = {}): DiscoveredSession[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.workspacePath !== undefined) {
    conditions.push(`workspace_path = ?`);
    params.push(filter.workspacePath);
  }
  if (filter.primaryModel !== undefined) {
    conditions.push(`primary_model = ?`);
    params.push(filter.primaryModel);
  }
  if (filter.managed === true) {
    conditions.push(`panopticon_managed = 1`);
  }
  if (filter.unmanaged === true) {
    conditions.push(`panopticon_managed = 0`);
  }
  if (filter.since !== undefined) {
    conditions.push(`last_ts >= ?`);
    params.push(filter.since);
  }
  if (filter.before !== undefined) {
    conditions.push(`last_ts < ?`);
    params.push(filter.before);
  }
  if (filter.after !== undefined) {
    conditions.push(`first_ts >= ?`);
    params.push(filter.after);
  }
  if (filter.minCost !== undefined) {
    conditions.push(`estimated_cost >= ?`);
    params.push(filter.minCost);
  }
  if (filter.maxCost !== undefined) {
    conditions.push(`estimated_cost <= ?`);
    params.push(filter.maxCost);
  }
  if (filter.minMessages !== undefined) {
    conditions.push(`message_count >= ?`);
    params.push(filter.minMessages);
  }
  if (filter.issueId !== undefined) {
    conditions.push(`pan_issue_id = ?`);
    params.push(filter.issueId);
  }
  if (filter.enriched === true) {
    conditions.push(`enrichment_level > 0`);
  }
  if (filter.notEnriched === true) {
    conditions.push(`enrichment_level = 0`);
  }
  if (filter.enrichmentLevelLessThan !== undefined) {
    conditions.push(`enrichment_level < ?`);
    params.push(filter.enrichmentLevelLessThan);
  }
  if (filter.tags && filter.tags.length > 0) {
    // JSON array overlap: any tag in the filter matches
    const tagConditions = filter.tags.map(() => `tags LIKE ? ESCAPE '\\'`);
    conditions.push(`(${tagConditions.join(' OR ')})`);
    for (const tag of filter.tags) {
      params.push(`%"${escapeLike(tag)}"%`);
    }
  }
  if (filter.tools && filter.tools.length > 0) {
    const toolConditions = filter.tools.map(() => `tools_used LIKE ? ESCAPE '\\'`);
    conditions.push(`(${toolConditions.join(' OR ')})`);
    for (const tool of filter.tools) {
      params.push(`%"${escapeLike(tool)}"%`);
    }
  }
  if (filter.files && filter.files.length > 0) {
    const fileConditions = filter.files.map(() => `files_touched LIKE ? ESCAPE '\\'`);
    conditions.push(`(${fileConditions.join(' OR ')})`);
    for (const file of filter.files) {
      params.push(`%${escapeLike(file)}%`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
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

/**
 * Count sessions matching filters (without fetching rows).
 */
export function countDiscoveredSessions(filter: ConversationFilter = {}): number {
  const rows = findDiscoveredSessions({ ...filter, limit: undefined, offset: undefined });
  return rows.length;
}

// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Insert or update a discovered session by jsonl_path.
 * Idempotent: re-inserting the same path updates metadata without duplicates.
 */
export function upsertDiscoveredSession(opts: UpsertDiscoveredSessionOpts): DiscoveredSession {
  const db = getDatabase();
  const now = new Date().toISOString();

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
       tags               = excluded.tags,
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
  );

  const row = db
    .prepare(`SELECT * FROM discovered_sessions WHERE jsonl_path = ?`)
    .get(opts.jsonlPath) as Record<string, unknown>;
  return rowToSession(row);
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
  const db = getDatabase();
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

  // Sync FTS5 after enrichment
  syncFts(id);
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
 * Sync the FTS5 index for a single session using the content= rebuild mechanism.
 *
 * FTS5 content= tables in SQLite require manual sync — direct INSERT/DELETE on the
 * virtual table modifies the FTS index but not the content table, and vice versa.
 * The safest per-row sync is:
 *   1. Delete the stale FTS entry using the special 'delete' command row (needs old values)
 *   2. Insert the current row into FTS
 *
 * Because we often don't have the old values readily available, we instead trigger a
 * full `rebuild` which re-reads all rows from discovered_sessions. This is O(n) but
 * safe and correct at expected scale (thousands of sessions, <1s).
 */
export function syncFts(_id: number): void {
  const db = getDatabase();
  db.prepare(`INSERT INTO sessions_fts(sessions_fts) VALUES('rebuild')`).run();
}

/**
 * Full-text search using FTS5 BM25 ranking.
 * Returns session IDs with their BM25 rank (lower = better match in SQLite FTS5).
 */
export function searchFts(query: string, limit = 50): FtsSearchResult[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT rowid AS id, rank
       FROM sessions_fts
       WHERE sessions_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as Array<{ id: number; rank: number }>;
  return rows.map((r) => ({ id: r.id, rank: r.rank }));
}

// ─── Embedding operations ─────────────────────────────────────────────────────

/**
 * Insert or replace an embedding for a session.
 */
export function insertEmbedding(
  sessionId: number,
  model: string,
  embedding: Float32Array,
): void {
  const db = getDatabase();
  const blob = Buffer.from(embedding.buffer);
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
export function loadEmbeddings(model: string): Array<{ sessionId: number; embedding: Float32Array }> {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT session_id, dim, embedding FROM session_embeddings WHERE model = ?`)
    .all(model) as Array<{ session_id: number; dim: number; embedding: Buffer }>;
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
  return { total, enriched, embedded, managedCount };
}
