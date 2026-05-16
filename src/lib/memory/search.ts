import { withMemoryFtsDatabase } from './fts-db.js';

const DEFAULT_LIMIT = 20;
const OVERFETCH_RATIO = 3;
const DEFAULT_SIBLING_TOKEN_BUDGET = 1500;
const RECENCY_DECAY_RATE = 0.02;
const TAG_BOOST = 0.3;
const HIGH_SIGNAL_SCORE_FLOOR = 1.0;
const HIGH_SIGNAL_WINDOW_HOURS = 72;
const HIGH_SIGNAL_TAGS = new Set([
  'error',
  'decision',
  'blocker',
  'shipped',
  'architecture',
  'review-blocker',
  'test-failure',
  'merge-risk',
  'architecture-decision',
  'regression',
]);

export interface SearchMemoryInput {
  query: string;
  projectId: string;
  workspaceId?: string;
  issueId?: string;
  sibling?: boolean;
  siblingTokenBudget?: number;
  now?: Date;
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
  rankScore: number;
  provenance: string;
  tokenBudget: number | null;
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
  const identityPredicate = buildIdentityPredicate(input);
  if (!identityPredicate) return [];

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
      ${identityPredicate.sql}
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
    ...identityPredicate.params,
    input.includeArchived ? 1 : 0,
    limit * OVERFETCH_RATIO,
  ) as MemorySearchRow[]);

  const tokenBudget = input.sibling ? normalizeSiblingTokenBudget(input.siblingTokenBudget) : null;
  const queryTerms = extractQueryTerms(input.query);
  const now = input.now ?? new Date();
  return rows
    .map((row) => rowToHit(row, tokenBudget, rankHit(row, queryTerms, now)))
    .filter((hit) => matchesTags(hit, input.tags))
    .sort((a, b) => b.rankScore - a.rankScore || b.entryDate.localeCompare(a.entryDate) || b.entryTime.localeCompare(a.entryTime))
    .slice(0, limit);
}

export function buildMatchQuery(query: string): string {
  return extractQueryTerms(query).map((term) => `"${term.replaceAll('"', '""')}"`).join(' ');
}

function extractQueryTerms(query: string): string[] {
  return query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
}

function buildIdentityPredicate(input: SearchMemoryInput): { sql: string; params: string[] } | null {
  if (input.sibling) {
    if (!input.workspaceId || !input.issueId) return null;
    return {
      sql: 'AND workspace_id != ? AND issue_id != ?',
      params: [input.workspaceId, input.issueId],
    };
  }

  const clauses: string[] = [];
  const params: string[] = [];
  if (input.workspaceId) {
    clauses.push('AND workspace_id = ?');
    params.push(input.workspaceId);
  }
  if (input.issueId) {
    clauses.push('AND issue_id = ?');
    params.push(input.issueId);
  }
  return { sql: clauses.join('\n      '), params };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_LIMIT;
  return limit;
}

function normalizeSiblingTokenBudget(tokenBudget: number | undefined): number {
  if (tokenBudget === undefined) return DEFAULT_SIBLING_TOKEN_BUDGET;
  if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) return DEFAULT_SIBLING_TOKEN_BUDGET;
  return tokenBudget;
}

function rankHit(row: MemorySearchRow, queryTerms: string[], now: Date): number {
  const tags = splitList(row.tags).map((tag) => tag.toLowerCase());
  const tagSet = new Set(tags);
  const matchingTagCount = new Set(queryTerms.map((term) => term.toLowerCase()).filter((term) => tagSet.has(term))).size;
  const ageDays = ageInDays(`${row.entry_date}T${row.entry_time}`, now);
  const decayedBm25 = Math.abs(row.bm25) * Math.exp(-RECENCY_DECAY_RATE * ageDays);
  const boostedScore = decayedBm25 + TAG_BOOST * matchingTagCount;
  if (ageDays < HIGH_SIGNAL_WINDOW_HOURS / 24 && tags.some((tag) => HIGH_SIGNAL_TAGS.has(tag))) {
    return Math.max(boostedScore, HIGH_SIGNAL_SCORE_FLOOR);
  }
  return boostedScore;
}

function ageInDays(timestamp: string, now: Date): number {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, (now.getTime() - parsed) / 86_400_000);
}

function rowToHit(row: MemorySearchRow, tokenBudget: number | null, rankScore: number): MemorySearchHit {
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
    rankScore,
    provenance: `${row.workspace_id}:${row.issue_id}`,
    tokenBudget,
  };
}

function splitList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function matchesTags(hit: MemorySearchHit, tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) return true;
  return tags.every((tag) => hit.tags.includes(tag));
}
