import { PanRpcError } from '@overdeck/contracts';

import { parseRelativeTime } from '../../../lib/conversations/search.js';
import type { ConversationFilter, DiscoveredSession } from '../../../lib/overdeck/discovered-sessions.js';
import type { SessionsFeedFilter, SessionsFeedRow } from '../../../lib/overdeck/sessions-feed.js';

const DEFAULT_CONVERSATION_LIMIT = 50;
const MAX_CONVERSATION_LIMIT = 500;

function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

export function toDiscoveredSessionSnapshot(session: DiscoveredSession) {
  return {
    id: session.id, jsonlPath: session.jsonlPath,
    harness: session.harness,
    sessionId: session.sessionId ?? undefined,
    workspacePath: session.workspacePath ?? undefined,
    workspaceHash: session.workspaceHash ?? undefined,
    messageCount: session.messageCount,
    firstTs: session.firstTs ?? undefined,
    lastTs: session.lastTs ?? undefined,
    modelsUsed: session.modelsUsed,
    primaryModel: session.primaryModel ?? undefined,
    tokenInput: session.tokenInput,
    tokenOutput: session.tokenOutput,
    estimatedCost: session.estimatedCost,
    toolsUsed: session.toolsUsed,
    filesTouched: session.filesTouched,
    tags: session.tags,
    summary: session.summary ?? undefined,
    summaryDetailed: session.summaryDetailed ?? undefined,
    conversationId: session.conversationId ?? undefined,
    conversationName: session.conversationName ?? undefined,
    conversationTitle: session.conversationTitle ?? undefined,
    enrichmentLevel: session.enrichmentLevel,
    enrichmentModel: session.enrichmentModel ?? undefined,
    enrichedAt: session.enrichedAt ?? undefined,
    enrichmentFailed: session.enrichmentFailed,
    overdeckManaged: session.overdeckManaged,
    panIssueId: session.panIssueId ?? undefined,
    panAgentId: session.panAgentId ?? undefined,
    scannedAt: session.scannedAt,
  };
}

export function toSessionsFeedRowSnapshot(row: SessionsFeedRow) {
  return {
    id: row.id,
    source: row.source,
    discoveredId: optional(row.discoveredId),
    jsonlPath: optional(row.jsonlPath),
    sessionId: optional(row.sessionId),
    workspacePath: optional(row.workspacePath),
    messageCount: row.messageCount,
    firstTs: optional(row.firstTs),
    lastTs: optional(row.lastTs),
    primaryModel: optional(row.primaryModel),
    tokenInput: row.tokenInput,
    tokenOutput: row.tokenOutput,
    estimatedCost: row.estimatedCost,
    tags: row.tags,
    summary: optional(row.summary),
    enrichmentLevel: row.enrichmentLevel,
    enrichmentFailed: row.enrichmentFailed,
    overdeckManaged: row.overdeckManaged,
    panIssueId: optional(row.panIssueId),
    archivedAt: optional(row.archivedAt),
    conversationId: optional(row.conversationId),
    conversationName: optional(row.conversationName),
    conversationTitle: optional(row.conversationTitle),
    harness: optional(row.harness),
  };
}

function normalizeConversationPagination(limit: number | undefined, offset: number | undefined): { limit: number; offset: number } {
  const normalizedLimit = limit ?? DEFAULT_CONVERSATION_LIMIT;
  const normalizedOffset = offset ?? 0;
  if (!Number.isFinite(normalizedLimit) || normalizedLimit < 0) {
    throw new PanRpcError({ message: 'Invalid limit', code: 'INVALID_LIMIT' });
  }
  if (!Number.isFinite(normalizedOffset) || normalizedOffset < 0) {
    throw new PanRpcError({ message: 'Invalid offset', code: 'INVALID_OFFSET' });
  }
  return {
    limit: Math.min(normalizedLimit, MAX_CONVERSATION_LIMIT),
    offset: normalizedOffset,
  };
}

function normalizeConversationFilter(input: {
  readonly harness?: string;
  readonly workspacePath?: string;
  readonly primaryModel?: string;
  readonly managed?: boolean;
  readonly unmanaged?: boolean;
  readonly since?: string;
  readonly before?: string;
  readonly after?: string;
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly minMessages?: number;
  readonly tags?: readonly string[];
  readonly tools?: readonly string[];
  readonly files?: readonly string[];
  readonly issueId?: string;
  readonly enrichmentLevel?: number;
  readonly enriched?: boolean;
  readonly notEnriched?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}): ConversationFilter {
  return {
    harness: input.harness,
    workspacePath: input.workspacePath,
    primaryModel: input.primaryModel,
    managed: input.managed,
    unmanaged: input.unmanaged,
    since: input.since ? parseRelativeTime(input.since) : undefined,
    before: input.before ? parseRelativeTime(input.before) : undefined,
    after: input.after ? parseRelativeTime(input.after) : undefined,
    minCost: input.minCost,
    maxCost: input.maxCost,
    minMessages: input.minMessages,
    tags: input.tags ? [...input.tags] : undefined,
    tools: input.tools ? [...input.tools] : undefined,
    files: input.files ? [...input.files] : undefined,
    issueId: input.issueId,
    enrichmentLevel: input.enrichmentLevel,
    enriched: input.enriched,
    notEnriched: input.notEnriched,
    limit: input.limit,
    offset: input.offset,
  };
}

export function normalizeSessionsFeedFilter(input: {
  readonly harness?: string;
  readonly workspacePath?: string;
  readonly primaryModel?: string;
  readonly managed?: boolean;
  readonly unmanaged?: boolean;
  readonly since?: string;
  readonly before?: string;
  readonly after?: string;
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly minMessages?: number;
  readonly tags?: readonly string[];
  readonly tools?: readonly string[];
  readonly files?: readonly string[];
  readonly issueId?: string;
  readonly enrichmentLevel?: number;
  readonly enriched?: boolean;
  readonly notEnriched?: boolean;
  readonly limit?: number;
  readonly offset?: number;
  readonly cursor?: string;
  readonly source?: SessionsFeedFilter['source'];
  readonly query?: string;
}): SessionsFeedFilter {
  return {
    ...normalizeConversationFilter(input),
    ...normalizeConversationPagination(input.limit, input.offset),
    cursor: input.cursor,
    source: input.source,
    query: input.query,
  };
}
