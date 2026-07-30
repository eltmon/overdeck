import { sessionFilePath } from '../paths.js';
import { parseRelativeTime } from '../conversations/search.js';
import {
  archiveConversation,
  getConversationByName,
  listArchivedConversationsWithEnrichment,
  markConversationEnded,
  removeFavorite,
  unarchiveConversation,
  type ArchivedConversationListOptions,
  type ArchivedConversationWithEnrichment,
  type LegacyConversation as Conversation,
} from './conversations.js';

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

export function parseStringArrayColumn(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function mapArchivedConversation(row: ArchivedConversationWithEnrichment): ArchivedConversationResponse {
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

export function parseOptionalNumberParam(params: URLSearchParams, name: string): number | undefined {
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
  if (harness === 'claude-code' || harness === 'ohmypi' || harness === 'codex' || harness === 'acp' || harness === 'kimi-code') options.harness = harness;
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

    await deps.stopConversationRuntime(conv, name);
    markConversationEnded(name);
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
