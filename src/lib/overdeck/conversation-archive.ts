import { sessionFilePath } from '../runtimes/storage/claude-code.js';
import { parseRelativeTime } from '../conversations/search.js';
import { isSupersededConversation } from './conversation-clear-chain.js';
import type { RuntimeName } from '../runtimes/types.js';
import {
  archiveConversation,
  getConversationByName,
  markConversationEnded,
  normalizeHarness,
  removeFavorite,
  toIso,
  toMillis,
  unarchiveConversation,
  type LegacyConversation as Conversation,
} from './conversations.js';
import { ensureDiscoveredSessionsSchema } from './discovered-sessions.js';
import { getOverdeckDatabase } from './infra.js';

// PAN-4645 WI-8: the archived-conversation listing lives here, its only
// production consumer, so `conversations.ts` stays under the file-size ceiling.
export interface ArchivedConversationWithEnrichment {
  id: number;
  name: string;
  cwd: string;
  issueId: string | null;
  createdAt: string;
  claudeSessionId: string | null;
  harness: RuntimeName | null;
  title: string | null;
  totalCost: number;
  archivedAt: string;
  model: string | null;
  discoveredJsonlPath: string | null;
  discoveredWorkspacePath: string | null;
  messageCount: number | null;
  firstTs: string | null;
  lastTs: string | null;
  primaryModel: string | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  estimatedCost: number | null;
  toolsUsed: string | null;
  filesTouched: string | null;
  tags: string | null;
  summary: string | null;
  enrichmentLevel: number | null;
  enrichmentFailed: number | null;
}

export interface ArchivedConversationListOptions {
  harness?: RuntimeName;
  workspacePath?: string;
  primaryModel?: string;
  unmanaged?: boolean;
  since?: string;
  before?: string;
  after?: string;
  minCost?: number;
  maxCost?: number;
  minMessages?: number;
  issueId?: string;
  enriched?: boolean;
  notEnriched?: boolean;
  enrichmentLevel?: number;
  enrichmentLevelLessThan?: number;
  tags?: string[];
  tools?: string[];
  files?: string[];
  limit?: number;
  offset?: number;
}

export function listArchivedConversationsWithEnrichment(options: ArchivedConversationListOptions = {}): ArchivedConversationWithEnrichment[] {
  ensureDiscoveredSessionsSchema();
  const db = getOverdeckDatabase();

  const conditions: string[] = ['c.archived_at IS NOT NULL'];
  const params: unknown[] = [];

  const lastTs = `COALESCE(ds.last_ts, c.archived_at)`;
  const firstTs = `COALESCE(ds.first_ts, c.created_at)`;
  const primaryModel = `COALESCE(ds.primary_model, c.model)`;
  const estimatedCost = `COALESCE(ds.estimated_cost, c.total_cost)`;
  const messageCount = `COALESCE(ds.message_count, 0)`;
  const enrichmentLevel = `COALESCE(ds.enrichment_level, 0)`;

  if (options.harness === 'claude-code') {
    conditions.push('(c.harness = ? OR c.harness IS NULL)');
    params.push(options.harness);
  } else if (options.harness === 'ohmypi') {
    conditions.push('(c.harness = ? OR c.harness = ?)');
    params.push(options.harness, 'pi');
  } else if (options.harness !== undefined) {
    conditions.push('c.harness = ?');
    params.push(options.harness);
  }
  if (options.workspacePath !== undefined) { conditions.push('c.cwd = ?'); params.push(options.workspacePath); }
  if (options.primaryModel !== undefined) { conditions.push(`${primaryModel} = ?`); params.push(options.primaryModel); }
  if (options.issueId !== undefined) { conditions.push('c.issue_id = ?'); params.push(options.issueId); }
  if (options.since !== undefined) { conditions.push(`${lastTs} >= ?`); params.push(toMillis(options.since)); }
  if (options.before !== undefined) { conditions.push(`${lastTs} < ?`); params.push(toMillis(options.before)); }
  if (options.after !== undefined) { conditions.push(`${firstTs} >= ?`); params.push(toMillis(options.after)); }
  if (options.minCost !== undefined) { conditions.push(`${estimatedCost} >= ?`); params.push(options.minCost); }
  if (options.maxCost !== undefined) { conditions.push(`${estimatedCost} <= ?`); params.push(options.maxCost); }
  if (options.minMessages !== undefined) { conditions.push(`${messageCount} >= ?`); params.push(options.minMessages); }
  if (options.unmanaged === true) { conditions.push('0 = 1'); }
  if (options.enriched === true) { conditions.push(`${enrichmentLevel} > 0`); }
  if (options.notEnriched === true) { conditions.push(`${enrichmentLevel} = 0`); }
  if (options.enrichmentLevel !== undefined) { conditions.push(`${enrichmentLevel} = ?`); params.push(options.enrichmentLevel); }
  if (options.enrichmentLevelLessThan !== undefined) { conditions.push(`${enrichmentLevel} < ?`); params.push(options.enrichmentLevelLessThan); }
  if (options.tags?.length) {
    for (const tag of options.tags) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_tags dst WHERE dst.session_id = ds.id AND dst.tag = ?)`);
      params.push(tag);
    }
  }
  if (options.tools?.length) {
    for (const tool of options.tools) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_tools dstool WHERE dstool.session_id = ds.id AND dstool.tool = ?)`);
      params.push(tool);
    }
  }
  if (options.files?.length) {
    for (const file of options.files) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_files dsfile WHERE dsfile.session_id = ds.id AND dsfile.file_path = ?)`);
      params.push(file);
    }
  }

  const safeLimit = Number.isFinite(options.limit) && options.limit! >= 0 ? options.limit! : undefined;
  const safeOffset = Number.isFinite(options.offset) && options.offset! >= 0 ? options.offset! : undefined;
  const limitClause = safeLimit !== undefined ? 'LIMIT ?' : safeOffset !== undefined ? 'LIMIT -1' : '';
  const offsetClause = safeOffset !== undefined ? 'OFFSET ?' : '';
  if (safeLimit !== undefined) params.push(safeLimit);
  if (safeOffset !== undefined) params.push(safeOffset);

  const where = `WHERE ${conditions.join(' AND ')}`;
  const sql = `
    SELECT
      c.rowid AS legacy_id,
      c.id AS uuid,
      c.name,
      c.cwd,
      c.issue_id,
      c.created_at,
      c.harness,
      (
        SELECT cf.locator FROM conversation_files cf
        WHERE cf.conversation_id = c.id
        ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
        LIMIT 1
      ) AS claude_session_id,
      c.title,
      c.total_cost,
      c.archived_at,
      c.model,
      ds.jsonl_path AS discovered_jsonl_path,
      ds.workspace_path AS discovered_workspace_path,
      ds.message_count,
      ds.first_ts,
      ds.last_ts,
      ds.primary_model,
      ds.token_input,
      ds.token_output,
      ds.estimated_cost,
      ds.tools_used,
      ds.files_touched,
      ds.tags,
      ds.summary,
      ds.enrichment_level,
      ds.enrichment_failed
    FROM conversations c
    LEFT JOIN discovered_sessions ds ON ds.session_id = (
      SELECT cf.locator FROM conversation_files cf
      WHERE cf.conversation_id = c.id
      ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
      LIMIT 1
    )
    ${where}
    ORDER BY c.archived_at DESC, c.created_at DESC
    ${limitClause} ${offsetClause}
  `;

  type RawRow = {
    legacy_id: number; uuid: string; name: string; cwd: string; issue_id: string | null;
    created_at: number; harness: string | null; claude_session_id: string | null; title: string | null;
    total_cost: number | null; archived_at: number | null; model: string | null;
    discovered_jsonl_path: string | null; discovered_workspace_path: string | null;
    message_count: number | null; first_ts: number | null; last_ts: number | null;
    primary_model: string | null; token_input: number | null; token_output: number | null;
    estimated_cost: number | null; tools_used: string | null; files_touched: string | null;
    tags: string | null; summary: string | null; enrichment_level: number | null;
    enrichment_failed: number | null;
  };

  const rawRows = db.prepare(sql).all(...params) as RawRow[];

  return rawRows.map((r): ArchivedConversationWithEnrichment => ({
    id: r.legacy_id,
    name: r.name,
    cwd: r.cwd,
    issueId: r.issue_id ?? null,
    createdAt: toIso(r.created_at) ?? new Date(0).toISOString(),
    claudeSessionId: r.claude_session_id ?? null,
    harness: normalizeHarness(r.harness),
    title: r.title ?? null,
    totalCost: r.total_cost ?? 0,
    archivedAt: toIso(r.archived_at) ?? toIso(r.created_at) ?? new Date(0).toISOString(),
    model: r.model ?? null,
    discoveredJsonlPath: r.discovered_jsonl_path ?? null,
    discoveredWorkspacePath: r.discovered_workspace_path ?? r.cwd,
    messageCount: r.message_count ?? null,
    firstTs: toIso(r.first_ts),
    lastTs: toIso(r.last_ts),
    primaryModel: r.primary_model ?? r.model ?? null,
    tokenInput: r.token_input ?? null,
    tokenOutput: r.token_output ?? null,
    estimatedCost: r.estimated_cost ?? null,
    toolsUsed: r.tools_used ?? null,
    filesTouched: r.files_touched ?? null,
    tags: r.tags ?? null,
    summary: r.summary ?? null,
    enrichmentLevel: r.enrichment_level ?? null,
    enrichmentFailed: r.enrichment_failed ?? null,
  }));
}


export interface ConversationArchiveResult {
  body: unknown;
  status?: number;
}

export interface ConversationArchiveDependencies {
  stopConversationRuntime(conv: Conversation, name: string): Promise<void>;
  invalidateFavoritesCache(): void;
  cleanupConversationAttachments(name: string): Promise<void>;
}

export type ArchivedConversationResponse = {
  id: number;
  source: 'managed-archived';
  conversationName: string;
  harness: ArchivedConversationWithEnrichment['harness'];
  jsonlPath: string | null;
  workspacePath: string;
  primaryModel: string | null;
  messageCount: number;
  firstTs: string;
  lastTs: string;
  estimatedCost: number;
  tokenInput: number;
  tokenOutput: number;
  toolsUsed: string[];
  filesTouched: string[];
  tags: string[];
  summary: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentFailed: boolean;
  overdeckManaged: true;
  panIssueId: string | null;
  archivedAt: string;
};

function result(body: unknown, status?: number): ConversationArchiveResult {
  return status === undefined ? { body } : { body, status };
}

function parseStringArrayColumn(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function mapArchivedConversation(row: ArchivedConversationWithEnrichment): ArchivedConversationResponse {
  const canUseClaudePathFallback = row.harness === null || row.harness === 'claude-code';
  return {
    id: row.id,
    source: 'managed-archived',
    conversationName: row.name,
    harness: row.harness,
    jsonlPath: row.discoveredJsonlPath ?? (canUseClaudePathFallback && row.claudeSessionId ? sessionFilePath(row.cwd, row.claudeSessionId) : null),
    workspacePath: row.cwd,
    primaryModel: row.primaryModel ?? row.model,
    messageCount: row.messageCount ?? 0,
    firstTs: row.firstTs ?? row.createdAt,
    lastTs: row.lastTs ?? row.archivedAt,
    estimatedCost: row.estimatedCost ?? row.totalCost,
    tokenInput: row.tokenInput ?? 0,
    tokenOutput: row.tokenOutput ?? 0,
    toolsUsed: parseStringArrayColumn(row.toolsUsed),
    filesTouched: parseStringArrayColumn(row.filesTouched),
    tags: parseStringArrayColumn(row.tags),
    summary: row.summary ?? row.title,
    enrichmentLevel: ((row.enrichmentLevel ?? 0) as 0 | 1 | 2 | 3),
    enrichmentFailed: Boolean(row.enrichmentFailed),
    overdeckManaged: true,
    panIssueId: row.issueId,
    archivedAt: row.archivedAt,
  };
}

function parseOptionalNumberParam(params: URLSearchParams, name: string): number | undefined {
  const value = params.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseArchivedConversationListOptions(params: URLSearchParams): ArchivedConversationListOptions {
  const options: ArchivedConversationListOptions = {};
  const workspacePath = params.get('workspacePath');
  const harness = params.get('harness');
  const primaryModel = params.get('primaryModel');
  const since = params.get('since');
  const tag = params.get('tag');
  const tool = params.get('tool');
  const file = params.get('file');
  const minCost = parseOptionalNumberParam(params, 'minCost');
  const maxCost = parseOptionalNumberParam(params, 'maxCost');
  const enrichmentLevel = parseOptionalNumberParam(params, 'enrichmentLevel');
  const rawLimit = parseOptionalNumberParam(params, 'limit');
  const rawOffset = parseOptionalNumberParam(params, 'offset');

  if (workspacePath) options.workspacePath = workspacePath;
  if (harness === 'claude-code' || harness === 'ohmypi' || harness === 'codex' || harness === 'acp' || harness === 'kimi-code' || harness === 'opencode' || harness === 'muse' || harness === 'prime-agent') options.harness = harness;
  if (primaryModel) options.primaryModel = primaryModel;
  if (since) options.since = parseRelativeTime(since);
  if (params.get('enriched') === 'true') options.enriched = true;
  if (tag) options.tags = [tag];
  if (tool) options.tools = [tool];
  if (file) options.files = [file];
  if (minCost !== undefined) options.minCost = minCost;
  if (maxCost !== undefined) options.maxCost = maxCost;
  if (enrichmentLevel !== undefined) options.enrichmentLevel = enrichmentLevel;
  options.limit = rawLimit === undefined ? 50 : Math.min(Math.max(rawLimit, 0), 100);
  if (rawOffset !== undefined) options.offset = Math.max(rawOffset, 0);
  return options;
}

export async function handleArchivedConversationsList(
  options: ArchivedConversationListOptions = {},
): Promise<ConversationArchiveResult> {
  try {
    const rows = listArchivedConversationsWithEnrichment(options).map(mapArchivedConversation);
    return result(rows);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] list archived conversations failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

export async function archiveConversationByName(
  name: string,
  deps: ConversationArchiveDependencies,
): Promise<ConversationArchiveResult> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);
    if (conv.archivedAt) return result({ error: 'Conversation is already archived' }, 400);

    // PAN-4485: a superseded /clear row owns no runtime; archiving it must
    // not stop the chain head's shared session.
    if (!isSupersededConversation(conv)) await deps.stopConversationRuntime(conv, name);
    if (conv.status !== 'ended') markConversationEnded(name);
    archiveConversation(name);
    removeFavorite('conversation', name);
    deps.invalidateFavoritesCache();
    await deps.cleanupConversationAttachments(name);

    return result({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] archive conversation failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

export async function unarchiveConversationByName(name: string): Promise<ConversationArchiveResult> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);
    if (!conv.archivedAt) return result({ error: 'Conversation is not archived' }, 400);

    unarchiveConversation(name);
    return result({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] unarchive conversation failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}
