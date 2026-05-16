import { withMemoryFtsDatabase } from './fts-db.js';

const DEFAULT_LIMIT = 20;
const OVERFETCH_RATIO = 3;

export interface SearchMemoryInput {
  query: string;
  projectId: string;
  workspaceId?: string;
  issueId?: string;
  limit?: number;
  tags?: string[];
  includeArchived?: boolean;
}

export interface MemorySearchHit {
  rowid: number;
  content: string;
  displayContent: string;
  source: string;
  branch: string;
  entryDate: string;
  entryTime: string;
  entryType: string;
  files: string[];
  tags: string[];
  docType: string;
  scope: string;
  projectId: string;
  workspaceId: string;
  issueId: string;
  runId: string;
  sessionId: string;
  agentRole: string;
  agentHarness: string;
  bm25: number;
}

interface MemorySearchRow {
  rowid: number;
  content: string;
  display_content: string;
  source: string;
  branch: string;
  entry_date: string;
  entry_time: string;
  entry_type: string;
  files: string;
  tags: string;
  doc_type: string;
  scope: string;
  project_id: string;
  workspace_id: string;
  issue_id: string;
  run_id: string;
  session_id: string;
  agent_role: string;
  agent_harness: string;
  bm25: number;
}

export async function searchMemory(input: SearchMemoryInput): Promise<MemorySearchHit[]> {
  const matchQuery = buildMatchQuery(input.query);
  if (!matchQuery) return [];

  const limit = normalizeLimit(input.limit);
  const rows = await withMemoryFtsDatabase(input.projectId, (db) => db.prepare(`
    SELECT
      rowid,
      content,
      display_content,
      source,
      branch,
      entry_date,
      entry_time,
      entry_type,
      files,
      tags,
      doc_type,
      scope,
      project_id,
      workspace_id,
      issue_id,
      run_id,
      session_id,
      agent_role,
      agent_harness,
      bm25(memory_fts) AS bm25
    FROM memory_fts
    WHERE memory_fts MATCH ?
      AND project_id = ?
      AND (? IS NULL OR workspace_id = ?)
      AND (? IS NULL OR issue_id = ?)
      AND (? = 1 OR (entry_date || 'T' || entry_time) > COALESCE((
        SELECT MAX(from_timestamp)
        FROM reset_markers
        WHERE (scope = 'project' AND scope_id = memory_fts.project_id)
           OR (scope = 'workspace' AND scope_id = memory_fts.workspace_id)
           OR (scope = 'issue' AND scope_id = memory_fts.issue_id)
           OR (scope = 'session' AND scope_id = memory_fts.session_id)
      ), ''))
    ORDER BY bm25(memory_fts) ASC
    LIMIT ?
  `).all(
    matchQuery,
    input.projectId,
    input.workspaceId ?? null,
    input.workspaceId ?? null,
    input.issueId ?? null,
    input.issueId ?? null,
    input.includeArchived ? 1 : 0,
    limit * OVERFETCH_RATIO,
  ) as MemorySearchRow[]);

  return rows
    .map(rowToHit)
    .filter((hit) => matchesTags(hit, input.tags))
    .slice(0, limit);
}

export function buildMatchQuery(query: string): string {
  const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' ');
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_LIMIT;
  return limit;
}

function rowToHit(row: MemorySearchRow): MemorySearchHit {
  return {
    rowid: row.rowid,
    content: row.content,
    displayContent: row.display_content,
    source: row.source,
    branch: row.branch,
    entryDate: row.entry_date,
    entryTime: row.entry_time,
    entryType: row.entry_type,
    files: splitList(row.files),
    tags: splitList(row.tags),
    docType: row.doc_type,
    scope: row.scope,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    issueId: row.issue_id,
    runId: row.run_id,
    sessionId: row.session_id,
    agentRole: row.agent_role,
    agentHarness: row.agent_harness,
    bm25: row.bm25,
  };
}

function splitList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function matchesTags(hit: MemorySearchHit, tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) return true;
  return tags.every((tag) => hit.tags.includes(tag));
}
