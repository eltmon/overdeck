/**
 * Transcript for one Agents Directory entry (PAN-3920 W7, D8/D9).
 *
 * Every kind reuses an existing route and renderer — no new parser:
 *   agent                  → ConversationPanel on /api/agents/:id/conversation
 *   conversation           → ConversationPanel on the conversation route (keeps its composer)
 *   conversation-subagent  → SubagentTranscript
 *   agent-subagent         → /api/agents/:id/conversation?subagentId= in a MessagesTimeline
 * Workers, external agents and subagents get no composer (D9).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { ConversationResponse, DirectoryEntry } from '@overdeck/contracts';

import { agentToConversation, type SessionAgent } from '../../../lib/agentConversation';
import { ConversationPanel } from '../../chat/ConversationPanel';
import { MessagesTimeline } from '../../chat/MessagesTimeline';
import { SubagentTranscript } from '../../chat/SubagentTranscript';
import type { SubagentSummary } from '../../chat/chat-types';
import { fetchConversations, type Conversation } from '../../CommandDeck/ConversationList';
import { isLiveState } from './directory-tree';

export function sessionAgentFromEntry(entry: DirectoryEntry, agentId: string): SessionAgent {
  return {
    id: agentId,
    issueId: entry.issueId,
    role: entry.role,
    model: entry.model === 'unknown' ? null : entry.model,
    harness: entry.harness === 'unknown' ? null : entry.harness,
    startedAt: entry.startedAt,
    lastActivity: entry.lastActivityAt,
    status: isLiveState(entry.state) ? 'running' : 'stopped',
  };
}

/** D9: workers and external agents get no composer of their own. */
export function hidesComposer(entry: DirectoryEntry): boolean {
  return entry.role === 'worker' || entry.kind === 'external';
}

function subagentSummaryFromEntry(entry: DirectoryEntry, subagentId: string): SubagentSummary {
  const [agentType = 'Subagent', ...rest] = entry.label.split(' · ');
  return {
    agentId: subagentId,
    agentType,
    description: rest.join(' · ') || subagentId,
    toolUseId: subagentId,
    spawnDepth: 1,
    status: isLiveState(entry.state) ? 'running' : 'done',
  };
}

function Placeholder({ children }: { children: string }) {
  return <div className="flex h-full items-center justify-center px-4 text-[12px] text-muted-foreground">{children}</div>;
}

function useConversationByName(name: string | null): { conversation: Conversation | null; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10_000,
    enabled: name !== null,
  });
  return { conversation: data?.find((row) => row.name === name) ?? null, loading: isLoading };
}

/** Cache key of an agent subagent's transcript; DirectoryDetail reads its `totalCost` from it. */
export function agentSubagentTranscriptQueryKey(agentId: string, subagentId: string) {
  return ['agent-subagent-transcript', agentId, subagentId] as const;
}

async function fetchAgentSubagentTranscript(agentId: string, subagentId: string): Promise<ConversationResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/conversation?subagentId=${encodeURIComponent(subagentId)}`);
  if (!res.ok) throw new Error(`Failed to load subagent transcript (${res.status})`);
  return res.json() as Promise<ConversationResponse>;
}

function AgentSubagentTranscript({ entry, agentId, subagentId }: { entry: DirectoryEntry; agentId: string; subagentId: string }) {
  const transcript = useQuery({
    queryKey: agentSubagentTranscriptQueryKey(agentId, subagentId),
    queryFn: () => fetchAgentSubagentTranscript(agentId, subagentId),
    refetchInterval: isLiveState(entry.state) ? 5_000 : false,
  });
  if (transcript.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Loading transcript…
      </div>
    );
  }
  if (transcript.isError) return <Placeholder>Couldn&apos;t load this subagent transcript.</Placeholder>;
  return (
    <MessagesTimeline
      messages={[...(transcript.data?.messages ?? [])]}
      workLog={[...(transcript.data?.workLog ?? [])]}
      streaming={isLiveState(entry.state)}
      conversationName={`${agentId}:${subagentId}`}
      cwd=""
      issueId={entry.issueId}
    />
  );
}

interface DirectoryTranscriptProps {
  entry: DirectoryEntry;
  /** Select another entry (the subagent header's back button selects its parent). */
  onSelectEntry: (entryId: string) => void;
}

export function DirectoryTranscript({ entry, onSelectEntry }: DirectoryTranscriptProps) {
  const ref = entry.transcript;
  const conversationName = ref?.route === 'conversation' || ref?.route === 'conversation-subagent' ? ref.conversationName : null;
  const { conversation, loading } = useConversationByName(conversationName);
  const agentConversation = useMemo(
    () => (ref?.route === 'agent' ? agentToConversation(sessionAgentFromEntry(entry, ref.agentId)) : null),
    [entry, ref],
  );

  if (!ref) return <Placeholder>No transcript is recorded for this agent.</Placeholder>;

  switch (ref.route) {
    case 'agent':
      return (
        <ConversationPanel
          key={ref.agentId}
          conversation={agentConversation!}
          agentId={ref.agentId}
          embedded
          hideComposer={hidesComposer(entry)}
          subagentRailCollapsed
        />
      );
    case 'conversation':
      if (!conversation) return <Placeholder>{loading ? 'Loading conversation…' : 'This conversation is no longer listed.'}</Placeholder>;
      return <ConversationPanel key={conversation.name} conversation={conversation} embedded subagentRailCollapsed />;
    case 'conversation-subagent':
      if (!conversation) return <Placeholder>{loading ? 'Loading conversation…' : 'This conversation is no longer listed.'}</Placeholder>;
      return (
        <SubagentTranscript
          key={`${conversation.name}:${ref.subagentId}`}
          conversation={conversation}
          subagent={subagentSummaryFromEntry(entry, ref.subagentId)}
          onBack={() => entry.parentId && onSelectEntry(entry.parentId)}
        />
      );
    case 'agent-subagent':
      return <AgentSubagentTranscript key={`${ref.agentId}:${ref.subagentId}`} entry={entry} agentId={ref.agentId} subagentId={ref.subagentId} />;
  }
}
