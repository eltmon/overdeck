import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHarnessBehavior, type IssueId } from '@overdeck/contracts';
import type { ConversationSessionFeedEntry } from './types';
import { fetchWithTimeout } from '../../lib/apiFetch';

export interface ConversationFeedRow {
  id: number;
  name: string;
  createdAt: string;
  lastAttachedAt: string | null;
  /** PAN-1556: transcript JSONL mtime — bumps on every message, unlike lastAttachedAt. */
  lastActivityAt?: string | null;
  issueId: string | null;
  cwd?: string | null;
  title?: string | null;
  harness?: 'claude-code' | 'pi' | 'ohmypi' | 'codex' | null;
  archivedAt?: string | null;
  messageCount?: number;
}

export interface UseConversationFeedResult {
  entries: ConversationSessionFeedEntry[];
  isLoading: boolean;
  error: Error | null;
}

async function fetchConversations(): Promise<ConversationFeedRow[]> {
  const res = await fetchWithTimeout('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json() as Promise<ConversationFeedRow[]>;
}

export function mapConversationToFeedEntry(conversation: ConversationFeedRow): ConversationSessionFeedEntry {
  // PAN-1556: prefer the transcript's last-activity (JSONL mtime) so a fresh
  // reply re-surfaces the conversation at the top of the feed. lastAttachedAt
  // only moves on terminal re-attach, so it left active conversations stale.
  const lastMessageDate = conversation.lastActivityAt ?? conversation.lastAttachedAt ?? conversation.createdAt;
  return {
    kind: 'conversation',
    id: `conversation:${conversation.name}`,
    timestamp: lastMessageDate,
    workspaceId: conversation.cwd ?? null,
    issueId: conversation.issueId as IssueId | null,
    conversationId: conversation.id,
    conversationName: conversation.name,
    agent: mapHarnessToAgent(conversation.harness),
    lastMessageDate,
    lastMessageSnippet: conversation.title ?? 'No messages yet',
    ...(conversation.messageCount === undefined ? {} : { messageCount: conversation.messageCount }),
  };
}

export function mapConversationsToFeedEntries(conversations: readonly ConversationFeedRow[]): ConversationSessionFeedEntry[] {
  return conversations
    .filter((conversation) => conversation.archivedAt == null)
    .map(mapConversationToFeedEntry);
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

function mapHarnessToAgent(harness: ConversationFeedRow['harness']): 'claude_code' | 'pi' | 'codex' | 'unknown' {
  if (harness) return getHarnessBehavior(harness).feedKind;
  return 'unknown';
}
