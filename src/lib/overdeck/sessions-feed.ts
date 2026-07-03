import { buildFilterSql, ensureDiscoveredSessionsSchema, type ConversationFilter } from './discovered-sessions.js';
import { getOverdeckDatabaseSync } from './infra.js';

export type SessionsFeedSource = 'discovered' | 'managed-archived';

export interface SessionsFeedFilter extends ConversationFilter {
  cursor?: string;
  source?: SessionsFeedSource;
}

export interface SessionsFeedRow {
  id: number;
  source: SessionsFeedSource;
  discoveredId: number | null;
  jsonlPath: string | null;
  sessionId: string | null;
  workspacePath: string | null;
  messageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  primaryModel: string | null;
  tokenInput: number;
  tokenOutput: number;
  estimatedCost: number;
  tags: string[];
  summary: string | null;
  enrichmentLevel: number;
  enrichmentFailed: boolean;
  overdeckManaged: boolean;
  panIssueId: string | null;
  archivedAt: string | null;
  conversationId: string | null;
  conversationName: string | null;
  conversationTitle: string | null;
  harness: string | null;
}

export interface SessionsFeedPage {
  rows: SessionsFeedRow[];
  nextCursor: string | null;
}

export interface SessionsFeedFacetBucket<T extends string | number = string> {
  value: T;
  count: number;
}

export interface SessionsFeedFacets {
  primaryModels: SessionsFeedFacetBucket[];
  tags: SessionsFeedFacetBucket[];
  tools: SessionsFeedFacetBucket[];
  files: SessionsFeedFacetBucket[];
  enrichmentLevels: SessionsFeedFacetBucket<number>[];
  timeBuckets: SessionsFeedFacetBucket<'24h' | '7d' | '30d' | 'older'>[];
  costBuckets: SessionsFeedFacetBucket<'<$0.10' | '$0.10-1' | '$1-10' | '>$10'>[];
  sources: SessionsFeedFacetBucket<SessionsFeedSource>[];
}

interface CursorPayload {
  lastTs: number | null;
  id: number;
  source: SessionsFeedSource;
}

interface FeedSql {
  cte: string;
  params: unknown[];
  cursorWhere: string;
}

interface BranchSql {
  sql: string;
  params: unknown[];
}

type FeedRowRecord = {
  id: number;
  source: SessionsFeedSource;
  discovered_id: number | null;
  jsonl_path: string | null;
  session_id: string | null;
  workspace_path: string | null;
  message_count: number | null;
  first_ts: number | null;
  last_ts: number | null;
  primary_model: string | null;
  token_input: number | null;
  token_output: number | null;
  estimated_cost: number | null;
  tags: string | null;
  summary: string | null;
  enrichment_level: number | null;
  enrichment_failed: number | null;
  overdeck_managed: number | null;
  pan_issue_id: string | null;
  archived_at: number | null;
  conversation_id: string | null;
  conversation_name: string | null;
  conversation_title: string | null;
  harness: string | null;
};

function toIso(value: number | null | undefined): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rowToFeedRow(row: FeedRowRecord): SessionsFeedRow {
  return {
    id: row.id,
    source: row.source,
    discoveredId: row.discovered_id ?? null,
    jsonlPath: row.jsonl_path ?? null,
    sessionId: row.session_id ?? null,
    workspacePath: row.workspace_path ?? null,
    messageCount: row.message_count ?? 0,
    firstTs: toIso(row.first_ts),
    lastTs: toIso(row.last_ts),
    primaryModel: row.primary_model ?? null,
    tokenInput: row.token_input ?? 0,
    tokenOutput: row.token_output ?? 0,
    estimatedCost: row.estimated_cost ?? 0,
    tags: parseJsonArray(row.tags),
    summary: row.summary ?? null,
    enrichmentLevel: row.enrichment_level ?? 0,
    enrichmentFailed: Boolean(row.enrichment_failed),
    overdeckManaged: Boolean(row.overdeck_managed),
    panIssueId: row.pan_issue_id ?? null,
    archivedAt: toIso(row.archived_at),
    conversationId: row.conversation_id ?? null,
    conversationName: row.conversation_name ?? null,
    conversationTitle: row.conversation_title ?? null,
    harness: row.harness ?? null,
  };
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (!Number.isFinite(parsed.id)) return null;
    if (parsed.lastTs !== null && !Number.isFinite(parsed.lastTs)) return null;
    if (parsed.source !== 'discovered' && parsed.source !== 'managed-archived') return null;
    return { lastTs: parsed.lastTs ?? null, id: parsed.id!, source: parsed.source };
  } catch {
    return null;
  }
}

function stripPaging(filter: SessionsFeedFilter): ConversationFilter {
  const { cursor: _cursor, source: _source, limit: _limit, offset: _offset, ...rest } = filter;
  return rest;
}

function branchSql(source: SessionsFeedSource, filter: ConversationFilter): BranchSql | null {
  if (source === 'discovered') {
    const { where, params } = buildFilterSql(filter, 'df');
    return {
      sql: `
        SELECT
          df.id AS id,
          'discovered' AS source,
          df.id AS discovered_id,
          df.jsonl_path,
          df.session_id,
          df.workspace_path,
          df.message_count,
          df.first_ts,
          df.last_ts,
          df.primary_model,
          df.token_input,
          df.token_output,
          df.estimated_cost,
          df.tags,
          df.summary,
          df.enrichment_level,
          df.enrichment_failed,
          df.overdeck_managed,
          df.pan_issue_id,
          NULL AS archived_at,
          NULL AS conversation_id,
          NULL AS conversation_name,
          NULL AS conversation_title,
          df.harness
        FROM discovered_sessions df
        ${where}
        ${where ? 'AND' : 'WHERE'} NOT EXISTS (
          SELECT 1
          FROM conversation_files cf
          JOIN conversations c ON c.id = cf.conversation_id
          WHERE c.archived_at IS NOT NULL
            AND cf.locator = df.session_id
        )
      `,
      params,
    };
  }

  const { where, params } = buildFilterSql(filter, 'af');
  return {
    sql: `
      SELECT
        af.feed_id AS id,
        'managed-archived' AS source,
        af.id AS discovered_id,
        af.jsonl_path,
        af.session_id,
        af.workspace_path,
        af.message_count,
        af.first_ts,
        af.last_ts,
        af.primary_model,
        af.token_input,
        af.token_output,
        af.estimated_cost,
        af.tags,
        af.summary,
        af.enrichment_level,
        af.enrichment_failed,
        af.overdeck_managed,
        af.pan_issue_id,
        af.archived_at,
        af.conversation_id,
        af.conversation_name,
        af.conversation_title,
        af.harness
      FROM (
        SELECT
          ds.id AS id,
          c.rowid AS feed_id,
          ds.jsonl_path,
          cf.locator AS session_id,
          COALESCE(ds.workspace_path, c.cwd) AS workspace_path,
          COALESCE(ds.message_count, 0) AS message_count,
          COALESCE(ds.first_ts, c.created_at) AS first_ts,
          COALESCE(ds.last_ts, c.archived_at) AS last_ts,
          COALESCE(ds.primary_model, c.model) AS primary_model,
          COALESCE(ds.token_input, 0) AS token_input,
          COALESCE(ds.token_output, 0) AS token_output,
          COALESCE(ds.estimated_cost, c.total_cost, 0) AS estimated_cost,
          COALESCE(ds.tags, '[]') AS tags,
          ds.summary,
          COALESCE(ds.enrichment_level, 0) AS enrichment_level,
          COALESCE(ds.enrichment_failed, 0) AS enrichment_failed,
          1 AS overdeck_managed,
          c.issue_id AS pan_issue_id,
          c.archived_at,
          c.id AS conversation_id,
          c.name AS conversation_name,
          c.title AS conversation_title,
          c.harness
        FROM conversations c
        LEFT JOIN conversation_files cf ON cf.id = (
          SELECT cf2.id
          FROM conversation_files cf2
          WHERE cf2.conversation_id = c.id
          ORDER BY (cf2.harness = 'claude-code') DESC, cf2.created_at ASC, cf2.id ASC
          LIMIT 1
        )
        LEFT JOIN discovered_sessions ds ON ds.session_id = cf.locator
        WHERE c.archived_at IS NOT NULL
      ) af
      ${where}
    `,
    params,
  };
}

function feedSql(filter: SessionsFeedFilter, includeCursor: boolean): FeedSql {
  const filterWithoutPaging = stripPaging(filter);
  const branches = [
    filter.source === undefined || filter.source === 'discovered' ? branchSql('discovered', filterWithoutPaging) : null,
    filter.source === undefined || filter.source === 'managed-archived' ? branchSql('managed-archived', filterWithoutPaging) : null,
  ].filter((branch): branch is BranchSql => branch !== null);

  if (branches.length === 0) {
    return { cte: 'WITH feed AS (SELECT NULL AS id WHERE 0 = 1)', params: [], cursorWhere: '' };
  }

  const params = branches.flatMap((branch) => branch.params);
  const cursor = decodeCursor(filter.cursor);
  const cursorWhere: string[] = [];
  if (includeCursor && cursor) {
    if (cursor.lastTs === null) {
      cursorWhere.push('(last_ts IS NULL AND (id < ? OR (id = ? AND source < ?)))');
      params.push(cursor.id, cursor.id, cursor.source);
    } else {
      cursorWhere.push('(last_ts < ? OR (last_ts = ? AND (id < ? OR (id = ? AND source < ?))))');
      params.push(cursor.lastTs, cursor.lastTs, cursor.id, cursor.id, cursor.source);
    }
  }

  return {
    cte: `
      WITH feed AS (
        ${branches.map((branch) => branch.sql).join('\nUNION ALL\n')}
      )
    `,
    params,
    cursorWhere: cursorWhere.length > 0 ? `WHERE ${cursorWhere.join(' AND ')}` : '',
  };
}

export function listSessionsFeed(filter: SessionsFeedFilter = {}): SessionsFeedPage {
  ensureDiscoveredSessionsSchema();
  const limit = Number.isFinite(filter.limit) && filter.limit! > 0 ? Math.floor(filter.limit!) : 50;
  const pageSize = Math.min(limit, 200);
  const { cte, params, cursorWhere } = feedSql(filter, true);
  const rows = getOverdeckDatabaseSync().prepare(`
    ${cte}
    SELECT * FROM feed
    ${cursorWhere}
    ORDER BY last_ts DESC NULLS LAST, id DESC, source DESC
    LIMIT ?
  `).all(...params, pageSize + 1) as FeedRowRecord[];

  const pageRows = rows.slice(0, pageSize);
  const last = pageRows.at(-1);
  return {
    rows: pageRows.map(rowToFeedRow),
    nextCursor: rows.length > pageSize && last ? encodeCursor({ lastTs: last.last_ts ?? null, id: last.id, source: last.source }) : null,
  };
}

function bucketRows<T extends string | number>(rows: { value: T; count: number }[]): SessionsFeedFacetBucket<T>[] {
  return rows.map((row) => ({ value: row.value, count: row.count }));
}

export function getSessionsFeedFacets(filter: SessionsFeedFilter = {}): SessionsFeedFacets {
  ensureDiscoveredSessionsSchema();
  const { cte, params } = feedSql({ ...filter, cursor: undefined }, false);
  const db = getOverdeckDatabaseSync();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const primaryModels = db.prepare(`
    ${cte}
    SELECT COALESCE(primary_model, '(unknown)') AS value, COUNT(*) AS count
    FROM feed
    GROUP BY COALESCE(primary_model, '(unknown)')
    ORDER BY count DESC, value ASC
  `).all(...params) as { value: string; count: number }[];

  const enrichmentLevels = db.prepare(`
    ${cte}
    SELECT enrichment_level AS value, COUNT(*) AS count
    FROM feed
    GROUP BY enrichment_level
    ORDER BY value ASC
  `).all(...params) as { value: number; count: number }[];

  const timeBuckets = db.prepare(`
    ${cte}
    SELECT
      CASE
        WHEN last_ts >= ? THEN '24h'
        WHEN last_ts >= ? THEN '7d'
        WHEN last_ts >= ? THEN '30d'
        ELSE 'older'
      END AS value,
      COUNT(*) AS count
    FROM feed
    GROUP BY value
    ORDER BY CASE value WHEN '24h' THEN 1 WHEN '7d' THEN 2 WHEN '30d' THEN 3 ELSE 4 END
  `).all(...params, now - day, now - 7 * day, now - 30 * day) as { value: '24h' | '7d' | '30d' | 'older'; count: number }[];

  const costBuckets = db.prepare(`
    ${cte}
    SELECT
      CASE
        WHEN estimated_cost < 0.1 THEN '<$0.10'
        WHEN estimated_cost < 1 THEN '$0.10-1'
        WHEN estimated_cost < 10 THEN '$1-10'
        ELSE '>$10'
      END AS value,
      COUNT(*) AS count
    FROM feed
    GROUP BY value
    ORDER BY CASE value WHEN '<$0.10' THEN 1 WHEN '$0.10-1' THEN 2 WHEN '$1-10' THEN 3 ELSE 4 END
  `).all(...params) as { value: '<$0.10' | '$0.10-1' | '$1-10' | '>$10'; count: number }[];

  const sources = db.prepare(`
    ${cte}
    SELECT source AS value, COUNT(*) AS count
    FROM feed
    GROUP BY source
    ORDER BY value ASC
  `).all(...params) as { value: SessionsFeedSource; count: number }[];

  const tags = db.prepare(`
    ${cte}
    SELECT idx.tag AS value, COUNT(*) AS count
    FROM feed
    JOIN discovered_session_tags idx ON idx.session_id = feed.discovered_id
    GROUP BY idx.tag
    ORDER BY count DESC, value ASC
  `).all(...params) as { value: string; count: number }[];

  const tools = db.prepare(`
    ${cte}
    SELECT idx.tool AS value, COUNT(*) AS count
    FROM feed
    JOIN discovered_session_tools idx ON idx.session_id = feed.discovered_id
    GROUP BY idx.tool
    ORDER BY count DESC, value ASC
  `).all(...params) as { value: string; count: number }[];

  const files = db.prepare(`
    ${cte}
    SELECT idx.file_path AS value, COUNT(*) AS count
    FROM feed
    JOIN discovered_session_files idx ON idx.session_id = feed.discovered_id
    GROUP BY idx.file_path
    ORDER BY count DESC, value ASC
  `).all(...params) as { value: string; count: number }[];

  return {
    primaryModels: bucketRows(primaryModels),
    tags: bucketRows(tags),
    tools: bucketRows(tools),
    files: bucketRows(files),
    enrichmentLevels: bucketRows(enrichmentLevels),
    timeBuckets: bucketRows(timeBuckets),
    costBuckets: bucketRows(costBuckets),
    sources: bucketRows(sources),
  };
}
