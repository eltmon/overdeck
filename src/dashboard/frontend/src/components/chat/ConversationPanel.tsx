import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Circle, Loader2 } from 'lucide-react';
import { XTerminal } from '../XTerminal';
import type { Conversation } from '../MissionControl/ConversationList';
import { MessagesTimeline } from './MessagesTimeline';
import { ComposerFooter } from './ComposerFooter';
import type { ChatMessage, WorkLogEntry } from './chat-types';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'conversation' | 'terminal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationPanelProps {
  conversation: Conversation;
  onArchived?: () => void;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function resumeConversation(name: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/resume`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to resume conversation');
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationPanel({ conversation, onArchived }: ConversationPanelProps) {
  // Default to conversation view; persist per-conversation preference wouldn't make sense
  // since new conversations should always start in conversation view
  const [viewMode, setViewMode] = useState<ViewMode>('conversation');
  const [resumed, setResumed] = useState(false);
  const queryClient = useQueryClient();

  // Query messages at this level so we can access streaming status in the header
  const { data: messagesData } = useQuery({
    queryKey: ['conversation-messages', conversation.name],
    queryFn: () => fetchMessages(conversation.name),
    refetchInterval: conversation.sessionAlive ? 2000 : false,
  });
  const isStreaming = messagesData?.streaming ?? false;

  const resumeMutation = useMutation({
    mutationFn: () => resumeConversation(conversation.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setResumed(true);
    },
  });

  const handleResume = useCallback(() => {
    resumeMutation.mutate();
  }, [resumeMutation]);

  const handleArchive = useCallback(async () => {
    try {
      await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/archive`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onArchived?.();
    } catch (err) {
      console.error('[ConversationPanel] Archive failed:', err);
    }
  }, [conversation.name, queryClient, onArchived]);

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  const showTerminal = conversation.sessionAlive || resumed;

  const statusColor = conversation.sessionAlive
    ? 'var(--mc-success)'
    : 'var(--mc-text-muted)';

  const statusLabel = conversation.sessionAlive ? 'active' : 'ended';

  return (
    <div className={styles.conversationTerminal}>
      {/* Header bar */}
      <div className={styles.conversationTerminalHeader}>
        <span className={styles.conversationTerminalTitle}>
          {isStreaming && (
            <Loader2
              size={14}
              className={styles.spinnerIcon}
            />
          )}
          {conversation.title ?? conversation.name}
        </span>
        <span className={styles.conversationTerminalStatus}>
          <Circle
            size={7}
            style={{ fill: statusColor, color: statusColor }}
          />
          {statusLabel}
        </span>

        {/* View toggle — only show when session is live */}
        {showTerminal && (
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewToggleBtn} ${viewMode === 'conversation' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => handleViewMode('conversation')}
            >
              Conversation
            </button>
            <button
              className={`${styles.viewToggleBtn} ${viewMode === 'terminal' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => handleViewMode('terminal')}
            >
              Terminal
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className={styles.conversationTerminalBody}>
        {/* Terminal: only mounted when actively viewing (xterm.js crashes with visibility:hidden) */}
        {showTerminal && viewMode === 'terminal' && (
          <XTerminal sessionName={conversation.tmuxSession} />
        )}
        {/* Conversation view — shown when in conversation mode or session ended */}
        {(viewMode === 'conversation' || !showTerminal) && (
          <ConversationView
            conversation={conversation}
            onResume={!showTerminal ? handleResume : undefined}
            onArchive={handleArchive}
            resumePending={resumeMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

// ─── ConversationView ─────────────────────────────────────────────────────────

interface MessagesResponse {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  streaming: boolean;
  discovering?: boolean;
  totalCost?: number;
}

async function fetchMessages(name: string): Promise<MessagesResponse> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/messages`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

interface ConversationViewProps {
  conversation: Conversation;
  onResume?: () => void;
  onArchive?: () => void;
  resumePending?: boolean;
}

function ConversationView({ conversation, onResume, onArchive, resumePending }: ConversationViewProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['conversation-messages', conversation.name],
    queryFn: () => fetchMessages(conversation.name),
    // Poll every 2s while session is active for live updates.
    // Since we don't have WebSocket push (unlike T3Code), polling is our streaming mechanism.
    refetchInterval: conversation.sessionAlive ? 2000 : false,
  });

  const messages = data?.messages ?? [];
  const workLog = data?.workLog ?? [];
  const streaming = data?.streaming ?? false;
  const isFirstMessage = !isLoading && messages.length === 0 && conversation.sessionAlive;
  const isOrphaned = !isLoading && messages.length === 0 && !conversation.sessionAlive;

  // "Working" = session is alive AND either:
  // - server reports streaming (incomplete assistant message with recent file activity)
  // - last message is from the user (waiting for assistant response)
  // - last assistant message has no completedAt (still generating)
  const lastMsg = messages[messages.length - 1];
  const isWorking = conversation.sessionAlive && messages.length > 0 && (
    streaming ||
    lastMsg?.role === 'user' ||
    (lastMsg?.role === 'assistant' && !lastMsg.completedAt)
  );

  return (
    <div className={styles.conversationView}>
      {isLoading ? (
        <div className={styles.conversationConnecting}>
          <span>Loading…</span>
        </div>
      ) : isOrphaned ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateSubtitle}>
            This conversation has no saved history. The session may have ended before any messages were exchanged.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {onResume && (
              <button className={styles.conversationResumeBtn} onClick={onResume} disabled={resumePending}>
                {resumePending ? 'Resuming…' : 'Resume Session'}
              </button>
            )}
            <button className={styles.conversationArchiveBtnLarge} onClick={() => onArchive?.()}>
              Archive
            </button>
          </div>
        </div>
      ) : isFirstMessage ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateTitle}>How can I help you?</p>
          <p className={styles.conversationEmptyStateSubtitle}>
            Type a message below to start the conversation.
          </p>
        </div>
      ) : (
        <MessagesTimeline
          messages={messages}
          workLog={workLog}
          streaming={isWorking}
        />
      )}
      {onResume ? (
        <div className={styles.conversationResumeBar}>
          <button
            className={styles.conversationResumeBtn}
            onClick={onResume}
            disabled={resumePending}
          >
            {resumePending ? 'Resuming…' : 'Resume Session'}
          </button>
        </div>
      ) : (
        <ComposerFooter conversation={conversation} />
      )}
    </div>
  );
}
