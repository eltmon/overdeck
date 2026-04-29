import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle } from 'lucide-react';
import { XTerminal } from '../XTerminal';
import type { Conversation } from './ConversationList';
import styles from './styles/command-deck.module.css';

// ─── API helpers ──────────────────────────────────────────────────────────────

async function resumeConversation(name: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/resume`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to resume conversation');
  return res.json();
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationTerminalProps {
  conversation: Conversation;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationTerminal({ conversation }: ConversationTerminalProps) {
  // Track whether we've triggered a resume (optimistic: show terminal immediately)
  const [resumed, setResumed] = useState(false);
  const queryClient = useQueryClient();

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

  // Determine if the terminal should be shown:
  // - session is alive (active), OR
  // - user just triggered a resume
  const showTerminal = conversation.sessionAlive || resumed;

  const statusColor = conversation.sessionAlive
    ? 'var(--success)'
    : 'var(--muted-foreground)';

  const statusLabel = conversation.sessionAlive ? 'active' : 'ended';

  return (
    <div className={styles.conversationTerminal}>
      {/* Header bar */}
      <div className={styles.conversationTerminalHeader}>
        <span className={styles.conversationTerminalTitle}>
          {conversation.name}
        </span>
        <span className={styles.conversationTerminalStatus}>
          <Circle
            size={7}
            style={{ fill: statusColor, color: statusColor }}
          />
          {statusLabel}
        </span>
      </div>

      {/* Body: terminal or resume prompt */}
      <div className={styles.conversationTerminalBody}>
        {showTerminal ? (
          <XTerminal sessionName={conversation.tmuxSession} />
        ) : (
          <div className={styles.conversationResumeOverlay}>
            <p>Session ended</p>
            <button
              className={styles.conversationResumeBtn}
              onClick={handleResume}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? 'Resuming…' : 'Resume Session'}
            </button>
            {resumeMutation.isError && (
              <p style={{ color: 'var(--destructive)', fontSize: 12 }}>
                {(resumeMutation.error as Error).message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
