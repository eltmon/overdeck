import { useState, useMemo } from 'react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import type { Conversation } from '../ConversationList';
import { ConversationPanel } from '../../chat/ConversationPanel';
import type { RoundMarker } from '../../chat/MessagesTimeline';
import { ChatMarkdown } from '../../chat/ChatMarkdown';
import { XTerminal } from '../../XTerminal';
import { RoundCard } from '../RoundCard';
import type { RoundData, RoundVerdict } from '../RoundCard';
import styles from '../styles/command-deck.module.css';

interface SessionPanelProps {
  session: SessionNodeType;
  issueId?: string;
  /** Optional review-round dividers passed through to the conversation timeline. */
  roundMarkers?: ReadonlyArray<RoundMarker>;
}

function getViewKey(sessionId: string): string {
  return `mc-session-panel-view:${sessionId}`;
}

type PanelView = 'conversation' | 'terminal' | 'findings';

function readView(sessionId: string): PanelView {
  try {
    const stored = localStorage.getItem(getViewKey(sessionId));
    if (stored === 'terminal' || stored === 'findings') return stored;
    return 'conversation';
  } catch {
    return 'conversation';
  }
}

function writeView(sessionId: string, view: PanelView): void {
  try {
    localStorage.setItem(getViewKey(sessionId), view);
  } catch { /* ignore */ }
}


function toRoundVerdict(status?: string): RoundVerdict {
  switch (status) {
    case 'passed':
    case 'approved':
      return 'passed';
    case 'failed':
    case 'blocked':
      return 'failed';
    case 'running':
    case 'active':
      return 'running';
    default:
      return 'pending';
  }
}

function deriveRoundData(metadata: SessionNodeType['roundMetadata']): RoundData[] {
  if (!metadata || metadata.history.length === 0) return [];
  return metadata.history.map((r) => ({
    round: r.round,
    verdict: toRoundVerdict(r.status),
    findings: r.findings,
    duration: r.durationSec ?? null,
    cost: r.cost ?? null,
  }));
}

export function SessionPanel({ session, issueId, roundMarkers }: SessionPanelProps) {
  const [view, setView] = useState<PanelView>(() =>
    readView(session.sessionId),
  );

  const handleSetView = (v: PanelView) => {
    setView(v);
    writeView(session.sessionId, v);
  };

  const synthesizedConversation = useMemo<Conversation | null>(() => {
    if (!session.hasJsonl) return null;
    return {
      id: -1,
      name: session.sessionId,
      tmuxSession: session.tmuxSession || session.sessionId,
      status: session.presence === 'ended' ? 'ended' : 'active',
      cwd: '',
      issueId: issueId || null,
      createdAt: session.startedAt,
      endedAt: session.endedAt || null,
      lastAttachedAt: null,
      sessionAlive: session.presence !== 'ended',
      sessionFile: session.sessionId,
    };
  }, [session, issueId]);

  const hasJsonl = !!session.hasJsonl;
  const hasTranscript = !!session.transcript;
  // Allow terminal for any session with a live tmux session — reviewers and
  // specialists have attachable tmux sessions too. The tmux session name is
  // either the explicit tmuxSession field or the sessionId (which is the
  // canonical tmux name for reviewer/specialist sessions).
  const tmuxName = session.tmuxSession || (session.presence === 'active' ? session.sessionId : undefined);
  const hasTerminal = !!tmuxName && session.presence !== 'ended';
  const isEnded = session.presence === 'ended';
  const roundData = useMemo(() => deriveRoundData(session.roundMetadata), [session.roundMetadata]);
  const hasFindings = roundData.length > 0;

  return (
    <div className={styles.sessionPanel}>
      {/* View toggle — slim tab bar (info already shown in ZoneB) */}
      <div className={styles.sessionPanelHeader}>
        <div className={styles.sessionPanelToggle}>
          <button
            className={`${styles.sessionPanelToggleBtn} ${view === 'conversation' ? styles.sessionPanelToggleBtnActive : ''}`}
            onClick={() => handleSetView('conversation')}
          >
            Conversation
          </button>
          {hasFindings && (
            <button
              className={`${styles.sessionPanelToggleBtn} ${view === 'findings' ? styles.sessionPanelToggleBtnActive : ''}`}
              onClick={() => handleSetView('findings')}
            >
              Findings
            </button>
          )}
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
        {view === 'conversation' && (
          hasJsonl && synthesizedConversation ? (
            <ConversationPanel
              conversation={synthesizedConversation}
              viewMode="conversation"
              roundMarkers={roundMarkers}
              roundMetadata={session.roundMetadata}
              embedded
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
        )}

        {view === 'findings' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {roundData.length === 0 ? (
              <div className={styles.sessionPanelEmpty}>No review rounds recorded.</div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mc-text-muted, var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Review rounds
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {roundData.map((r) => (
                    <RoundCard key={r.round} round={r} active={r.round === session.roundMetadata?.latestRound} />
                  ))}
                </div>
                {/* Show synthesis summaries for each round */}
                {session.roundMetadata?.history.map((r) => r.summary ? (
                  <div key={`summary-${r.round}`} style={{ borderTop: '1px solid var(--mc-border, var(--border))', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-text-muted, var(--muted-foreground))', marginBottom: 6 }}>
                      Round {r.round} — {r.status}
                    </div>
                    <ChatMarkdown text={r.summary} isStreaming={false} />
                  </div>
                ) : null)}
              </>
            )}
          </div>
        )}

        {view === 'terminal' && (
          hasTerminal && tmuxName ? (
            <XTerminal sessionName={tmuxName} />
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
