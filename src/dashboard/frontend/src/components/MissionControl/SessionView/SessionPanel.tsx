import { useState, useMemo } from 'react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import type { Conversation } from '../ConversationList';
import { ConversationPanel } from '../../chat/ConversationPanel';
import { ChatMarkdown } from '../../chat/ChatMarkdown';
import { XTerminal } from '../../XTerminal';
import styles from '../styles/mission-control.module.css';

interface SessionPanelProps {
  session: SessionNodeType;
  issueId?: string;
}

function getViewKey(sessionId: string): string {
  return `mc-session-panel-view:${sessionId}`;
}

function readView(sessionId: string): 'conversation' | 'terminal' {
  try {
    const stored = localStorage.getItem(getViewKey(sessionId));
    return stored === 'terminal' ? 'terminal' : 'conversation';
  } catch {
    return 'conversation';
  }
}

function writeView(sessionId: string, view: 'conversation' | 'terminal'): void {
  try {
    localStorage.setItem(getViewKey(sessionId), view);
  } catch { /* ignore */ }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function PresenceDot({ presence }: { presence: SessionNodeType['presence'] }) {
  const color =
    presence === 'active'
      ? 'var(--mc-success)'
      : presence === 'idle'
        ? 'var(--mc-warning)'
        : 'var(--mc-text-muted)';
  return <span className={styles.sessionPanelPresence} style={{ background: color }} />;
}

export function SessionPanel({ session, issueId }: SessionPanelProps) {
  const [view, setView] = useState<'conversation' | 'terminal'>(() =>
    readView(session.sessionId),
  );

  const handleSetView = (v: 'conversation' | 'terminal') => {
    setView(v);
    writeView(session.sessionId, v);
  };

  const synthesizedConversation = useMemo<Conversation | null>(() => {
    if (!session.jsonlPath) return null;
    return {
      id: 0,
      name: session.sessionId,
      tmuxSession: session.tmuxSession || session.sessionId,
      status: session.presence === 'ended' ? 'ended' : 'active',
      cwd: '',
      issueId: issueId || null,
      createdAt: session.startedAt,
      endedAt: session.endedAt || null,
      lastAttachedAt: null,
      sessionAlive: session.presence !== 'ended',
      sessionFile: session.jsonlPath,
    };
  }, [session, issueId]);

  const hasJsonl = !!session.jsonlPath;
  const hasTranscript = !!session.transcript;
  // Only allow terminal for work/planning sessions with a live tmux session
  const allowTerminal = (session.type === 'work' || session.type === 'planning') &&
    !!session.tmuxSession &&
    session.presence !== 'ended';
  const hasTerminal = allowTerminal;
  const isEnded = session.presence === 'ended';

  return (
    <div className={styles.sessionPanel}>
      {/* Session info sub-header */}
      <div className={styles.sessionPanelHeader}>
        <div className={styles.sessionPanelInfo}>
          <span className={styles.sessionPanelType}>
            {session.role ? `${session.type}:${session.role}` : session.type}
          </span>
          <PresenceDot presence={session.presence} />
          <span className={styles.sessionPanelModel}>{session.model}</span>
          <span className={styles.sessionPanelDuration}>{formatDuration(session.duration)}</span>
        </div>

        <div className={styles.sessionPanelToggle}>
          <button
            className={`${styles.sessionPanelToggleBtn} ${view === 'conversation' ? styles.sessionPanelToggleBtnActive : ''}`}
            onClick={() => handleSetView('conversation')}
          >
            Conversation
          </button>
          <button
            className={`${styles.sessionPanelToggleBtn} ${view === 'terminal' ? styles.sessionPanelToggleBtnActive : ''}`}
            onClick={() => handleSetView('terminal')}
          >
            Terminal
          </button>
        </div>
      </div>

      {/* View content */}
      <div className={styles.sessionPanelContent}>
        {view === 'conversation' ? (
          hasJsonl && synthesizedConversation ? (
            <ConversationPanel
              conversation={synthesizedConversation}
              viewMode="conversation"
            />
          ) : hasTranscript ? (
            <div className={styles.sessionPanelTranscript}>
              <ChatMarkdown text={session.transcript!} isStreaming={false} />
            </div>
          ) : (
            <div className={styles.sessionPanelEmpty}>
              No conversation data available for this session.
            </div>
          )
        ) : (
          hasTerminal ? (
            <XTerminal sessionName={session.tmuxSession!} />
          ) : (
            <div className={styles.sessionPanelEmpty}>
              {isEnded ? 'Session ended' : 'No terminal session available.'}
            </div>
          )
        )}
      </div>
    </div>
  );
}
