import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ConversationPanel } from '../chat/ConversationPanel';
import { MessagesTimeline } from '../chat/MessagesTimeline';
import type { ChatMessage } from '../chat/chat-types';
import type { Conversation } from '../CommandDeck/ConversationList';
import { useTheme } from '../../hooks/useTheme';

interface SessionTranscriptSession {
  id: number;
  conversationId?: string | number | null;
  conversationName?: string | null;
  workspacePath: string | null;
  panIssueId: string | null;
}

interface Props {
  session: SessionTranscriptSession;
}

interface DiscoveredMessagesResponse {
  messages: ChatMessage[];
}

async function fetchConversation(conversationRef: string | number): Promise<Conversation> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(String(conversationRef))}`);
  if (!response.ok) throw new Error(`Failed to load conversation: ${response.status}`);
  return (await response.json()) as Conversation;
}

async function fetchDiscoveredMessages(sessionId: number): Promise<DiscoveredMessagesResponse> {
  const response = await fetch(`/api/discovered-sessions/${sessionId}/messages`);
  if (response.status === 410) {
    throw new Error('transcript file no longer on disk');
  }
  if (!response.ok) throw new Error(`Failed to load transcript: ${response.status}`);
  return (await response.json()) as DiscoveredMessagesResponse;
}

export function SessionTranscript({ session }: Props) {
  const resolvedTheme = useTheme((state) => state.resolvedTheme);
  const conversationRef = session.conversationName ?? session.conversationId ?? null;

  const conversationQuery = useQuery({
    queryKey: ['sessions-conversation', conversationRef],
    queryFn: () => fetchConversation(conversationRef!),
    enabled: conversationRef != null,
    refetchInterval: 5000,
  });

  const messagesQuery = useQuery({
    queryKey: ['discovered-session-messages', session.id],
    queryFn: () => fetchDiscoveredMessages(session.id),
    enabled: conversationRef == null,
  });

  if (conversationRef != null) {
    if (conversationQuery.isLoading && conversationQuery.data === undefined) {
      return <TranscriptState>Loading conversation...</TranscriptState>;
    }
    if (conversationQuery.isError || conversationQuery.data === undefined) {
      return <TranscriptState>Could not load this managed conversation.</TranscriptState>;
    }
    return (
      <div className="h-full min-h-0" data-testid="session-transcript-managed">
        <ConversationPanel conversation={conversationQuery.data} embedded />
      </div>
    );
  }

  if (messagesQuery.isLoading && messagesQuery.data === undefined) {
    return <TranscriptState>Loading transcript...</TranscriptState>;
  }
  if (messagesQuery.isError) {
    const message = messagesQuery.error instanceof Error ? messagesQuery.error.message : 'Failed to load transcript.';
    return (
      <TranscriptState tone="warning">
        {message}
      </TranscriptState>
    );
  }

  return (
    <div className="h-full min-h-0" data-testid="session-transcript-unmanaged">
      <MessagesTimeline
        messages={messagesQuery.data?.messages ?? []}
        workLog={[]}
        streaming={false}
        cwd={session.workspacePath ?? undefined}
        issueId={session.panIssueId}
        resolvedTheme={resolvedTheme}
      />
    </div>
  );
}

function TranscriptState({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <div
      className={`flex h-full min-h-48 items-center justify-center gap-2 px-6 text-center text-sm ${
        tone === 'warning' ? 'text-amber-300' : 'text-gray-500'
      }`}
    >
      {tone === 'warning' && <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}
