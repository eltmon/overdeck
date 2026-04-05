import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle } from 'lucide-react';
import { XTerminal } from '../XTerminal';
import type { Conversation } from '../MissionControl/ConversationList';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'conversation' | 'terminal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationPanelProps {
  conversation: Conversation;
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

export function ConversationPanel({ conversation }: ConversationPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('conv-panel-view-mode');
    return saved === 'terminal' ? 'terminal' : 'conversation';
  });

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

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('conv-panel-view-mode', mode);
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
          {conversation.name}
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
        {!showTerminal ? (
          // Session ended — show resume overlay
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
              <p style={{ color: 'var(--mc-error)', fontSize: 12 }}>
                {(resumeMutation.error as Error).message}
              </p>
            )}
          </div>
        ) : viewMode === 'terminal' ? (
          // Terminal view — raw tmux output
          <XTerminal sessionName={conversation.tmuxSession} />
        ) : (
          // Conversation view — structured message rendering
          <ConversationView conversation={conversation} />
        )}
      </div>
    </div>
  );
}

// ─── ConversationView ─────────────────────────────────────────────────────────
// Renders the structured conversation. MessagesTimeline and ComposerFooter
// will be wired in when those components are available.

interface ConversationViewProps {
  conversation: Conversation;
}

function ConversationView({ conversation }: ConversationViewProps) {
  // session_file is null until discovered asynchronously after Claude Code starts
  const sessionFileKnown = conversation.sessionFile != null;

  if (!sessionFileKnown) {
    return (
      <div className={styles.conversationConnecting}>
        <span>Connecting to session…</span>
      </div>
    );
  }

  // MessagesTimeline and ComposerFooter will be rendered here once built
  return (
    <div className={styles.conversationView}>
      <div className={styles.conversationConnecting}>
        <span>Loading messages…</span>
      </div>
    </div>
  );
}
