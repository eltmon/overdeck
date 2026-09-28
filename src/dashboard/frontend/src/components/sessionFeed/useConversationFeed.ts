import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getHarnessBehavior,
  type HarnessFeedKind,
  type IssueId,
} from '@overdeck/contracts';
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
  harness?: 'claude-code' | 'pi' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent' | null;
  archivedAt?: string | null;
  messageCount?: number;
  status?: 'active' | 'ended' | null;
  endedAt?: string | null;
  sessionAlive?: boolean;
  isWorking?: boolean;
  pendingInputCount?: number;
  /** PAN-1577: explicit project assignment override. Null = fall back to deriving the project from cwd. */
  projectKey?: string | null;
  spawnError?: string | null;
  /** PAN-4223: legacy id of the launching (lane) or source (successor) conversation. Null = root. */
  parentConversationId?: number | null;
  parentConversationName?: string | null;
  /** PAN-4223: gauntlet lane facts; null unless the row is a lane. */
  gauntletRun?: string | null;
  laneKey?: string | null;
  laneRole?: 'builder' | 'critic' | 'verifier' | 'play' | 'orchestrator' | null;
  laneIteration?: number | null;
  laneReport?: { seq: number; at: string; status: 'done' | 'blocked' | 'failed'; verdict?: string | null } | null;
  /** PAN-4223 D26: legacy id of the builder row a critic or verifier lane judges. */
  criticOfConversationId?: number | null;
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

function mapHarnessToAgent(
  harness: ConversationFeedRow['harness'],
): HarnessFeedKind | 'unknown' {
  if (harness) return getHarnessBehavior(harness).feedKind;
  return 'unknown';
}
