import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getHarnessBehavior,
  isSingletonConversation,
  type HarnessFeedKind,
  type IssueId,
} from '@overdeck/contracts';
import { groupGauntletRuns, isLaneRow } from './gauntletRunEntries';
import type { ConversationFeedRow, ConversationSessionFeedEntry, GauntletRunSessionFeedEntry } from './types';
import { fetchWithTimeout } from '../../lib/apiFetch';

export type { ConversationFeedRow } from './types';


export interface UseConversationFeedResult {
  entries: Array<ConversationSessionFeedEntry | GauntletRunSessionFeedEntry>;
  isLoading: boolean;
  error: Error | null;
}

async function fetchConversations(): Promise<ConversationFeedRow[]> {
  const res = await fetchWithTimeout('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json() as Promise<ConversationFeedRow[]>;
}

export function mapConversationToFeedEntry(conversation: ConversationFeedRow): ConversationSessionFeedEntry {
  // PAN-4301 FR-1: `timestamp` records a lifecycle fact (started / ended), never
  // the transcript mtime, so a working conversation does not jump back to
  // "Just Now" on every poll. The recency timestamp (PAN-1556 precedence) is kept
  // separately; the Chats tab re-dates by it.
  const recencyAt = conversation.lastActivityAt ?? conversation.lastAttachedAt ?? conversation.createdAt;
  const endedAt = conversation.status === 'ended' ? conversation.endedAt ?? null : null;
  const sessionAlive = conversation.sessionAlive === true;
  return {
    kind: 'conversation',
    id: `conversation:${conversation.name}`,
    timestamp: endedAt ?? conversation.createdAt,
    timestampLabel: endedAt ? 'ended' : 'started',
    recencyAt,
    sessionAlive,
    agentState: sessionAlive && (conversation.pendingInputCount ?? 0) > 0 ? 'waiting'
      : sessionAlive && conversation.isWorking ? 'active' : 'idle',
    projectKey: conversation.projectKey ?? null,
    workspaceId: conversation.cwd ?? null,
    issueId: conversation.issueId as IssueId | null,
    conversationId: conversation.id,
    conversationName: conversation.name,
    agent: mapHarnessToAgent(conversation.harness),
    lastMessageDate: recencyAt,
    lastMessageSnippet: conversation.title ?? 'No messages yet',
    ...(conversation.messageCount === undefined ? {} : { messageCount: conversation.messageCount }),
  };
}

/**
 * PAN-4301: archived rows and singleton runners (FR-4) never render; lane rows
 * never render as conversation cards but fold into one run card per
 * (projectKey, gauntletRun) (FR-6).
 */
export function mapConversationsToFeedEntries(
  conversations: readonly ConversationFeedRow[],
  now: number = Date.now(),
): Array<ConversationSessionFeedEntry | GauntletRunSessionFeedEntry> {
  const visible = conversations.filter((row) => row.archivedAt == null && !isSingletonConversation(row));
  const lanes = visible.filter(isLaneRow);
  const roots = visible.filter((row) => !isLaneRow(row));
  return [...roots.map(mapConversationToFeedEntry), ...groupGauntletRuns(lanes, visible, now)];
}

export function useConversationFeed(): UseConversationFeedResult {
  const query = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const conversations = query.data ?? [];
  const entries = useMemo(() => mapConversationsToFeedEntries(conversations), [conversations]);

  return {
    entries,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

function mapHarnessToAgent(
  harness: ConversationFeedRow['harness'],
): HarnessFeedKind | 'unknown' {
  if (harness) return getHarnessBehavior(harness).feedKind;
  return 'unknown';
}
