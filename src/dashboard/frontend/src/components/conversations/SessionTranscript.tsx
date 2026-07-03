import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ConversationPanel } from '../chat/ConversationPanel';
import { MessagesTimeline } from '../chat/MessagesTimeline';
import type { ChatMessage, CompactBoundary, ProposedPlan, WorkLogEntry } from '../chat/chat-types';
import type { Conversation } from '../CommandDeck/ConversationList';
import { useTheme } from '../../hooks/useTheme';
import type { Session } from './SessionDetail';

interface MessagesResponse {
  messages: ChatMessage[];
  workLog?: WorkLogEntry[];
  streaming?: boolean;
  proposedPlan?: ProposedPlan;
  compactBoundaries?: CompactBoundary[];
}

async function fetchConversation(identifier: string): Promise<Conversation> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(identifier)}`);
  if (!response.ok) throw new Error(`Failed to load conversation: ${response.status}`);
  return (await response.json()) as Conversation;
}

async function fetchDiscoveredMessages(sessionId: number): Promise<MessagesResponse> {
  const response = await fetch(`/api/discovered-sessions/${sessionId}/messages`);
  if (response.status === 410) {
    throw new Error('TRANSCRIPT_GONE');
  }
  if (!response.ok) throw new Error(`Failed to load transcript: ${response.status}`);
  return (await response.json()) as MessagesResponse;
}

function conversationIdentifier(session: Session): string | null {
  if (session.conversationName) return session.conversationName;
  if (session.conversationId) return session.conversationId;
  if (session.source === 'managed-archived') return String(session.id);
  return null;
}

export function SessionTranscript({ session }: { session: Session }) {
  const { resolvedTheme } = useTheme();
  const identifier = conversationIdentifier(session);

  const conversationQuery = useQuery({
    queryKey: ['sessions-feed-conversation', identifier],
    queryFn: () => fetchConversation(identifier!),
    enabled: identifier !== null,
    refetchInterval: 5000,
  });

  const messagesQuery = useQuery({
    queryKey: ['discovered-session-messages', session.id],
    queryFn: () => fetchDiscoveredMessages(session.id),
    enabled: identifier === null,
  });

  if (identifier !== null) {
    if (conversationQuery.isLoading && conversationQuery.data === undefined) {
      return <TranscriptNotice>Loading conversation…</TranscriptNotice>;
    }
    if (conversationQuery.isError || conversationQuery.data === undefined) {
      return <TranscriptNotice>Couldn’t load this conversation.</TranscriptNotice>;
    }
    return (
      <ConversationPanel
        conversation={conversationQuery.data}
        viewMode="conversation"
        embedded
      />
    );
  }

  if (messagesQuery.isLoading && messagesQuery.data === undefined) {
    return <TranscriptNotice>Loading transcript…</TranscriptNotice>;
  }
  if (messagesQuery.error instanceof Error && messagesQuery.error.message === 'TRANSCRIPT_GONE') {
    return <TranscriptNotice>Transcript file no longer on disk.</TranscriptNotice>;
  }
  if (messagesQuery.isError || messagesQuery.data === undefined) {
    return <TranscriptNotice>Couldn’t load this transcript.</TranscriptNotice>;
  }

  return (
    <MessagesTimeline
      messages={messagesQuery.data.messages}
      workLog={messagesQuery.data.workLog ?? []}
      streaming={messagesQuery.data.streaming ?? false}
      proposedPlan={messagesQuery.data.proposedPlan}
      compactBoundaries={messagesQuery.data.compactBoundaries}
      resolvedTheme={resolvedTheme}
      conversationName={session.conversationName ?? undefined}
      cwd={session.workspacePath ?? undefined}
      issueId={session.panIssueId}
    />
  );
}

function TranscriptNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
