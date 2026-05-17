import { useState, useMemo, useCallback, useEffect } from 'react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import type { Conversation } from '../ConversationList';
import { ConversationPanel } from '../../chat/ConversationPanel';
import type { RoundMarker } from '../../chat/MessagesTimeline';
import { ChatMarkdown } from '../../chat/ChatMarkdown';
import { XTerminal } from '../../XTerminal';
import { RoundCard } from '../RoundCard';
import type { RoundData, RoundVerdict } from '../RoundCard';
import { ReviewSummary } from './ReviewSummary';
import { useResolvedModels, resolveWorkTypeKey } from '../../../lib/useResolvedModels';
import styles from '../styles/command-deck.module.css';

interface SessionPanelProps {
  session: SessionNodeType;
  issueId?: string;
  /** Optional review-round dividers passed through to the conversation timeline. */
  roundMarkers?: ReadonlyArray<RoundMarker>;
  /** Reviewer sessions — passed when session.type === 'review' to show ReviewSummary. */
  reviewers?: readonly SessionNodeType[];
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

async function updateAgentDeliveryMethod(agentId: string, deliveryMethod: 'auto' | 'channels' | 'tmux'): Promise<void> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/delivery-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryMethod }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to update delivery method (${res.status})${body ? `: ${body}` : ''}`);
  }
}

function DeliveryMethodToggle({ sessionId, deliveryMethod }: { sessionId: string; deliveryMethod?: 'auto' | 'channels' | 'tmux' }) {
  const [current, setCurrent] = useState(deliveryMethod ?? 'auto');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (deliveryMethod && deliveryMethod !== current) {
      setCurrent(deliveryMethod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryMethod]);

  const handleChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const method = e.target.value as 'auto' | 'channels' | 'tmux';
    setSaving(true);
    try {
      await updateAgentDeliveryMethod(sessionId, method);
      setCurrent(method);
    } catch (err) {
      console.error('[DeliveryMethodToggle] Failed:', err);
    } finally {
      setSaving(false);
    }
  }, [sessionId]);

  return (
    <select
      className={styles.deliveryMethodSelect}
      value={current}
      onChange={handleChange}
      disabled={saving}
      title="Message delivery method"
      aria-label="Message delivery method"
    >
      <option value="auto">Auto</option>
      <option value="channels">Channels</option>
      <option value="tmux">Tmux</option>
    </select>
  );
}

export function SessionPanel({ session, issueId, roundMarkers, reviewers }: SessionPanelProps) {
  const isReviewSession = session.type === 'review';
  const resolvedModels = useResolvedModels();
  const [view, setView] = useState<PanelView>(() => {
    const stored = readView(session.sessionId);
    // Default review sessions without JSONL to summary tab; with JSONL default
    // to conversation so the user sees what the agent is doing.
    if (isReviewSession && stored === 'conversation' && !session.hasJsonl) {
      return 'findings';
    }
    return stored;
  });

  const handleSetView = (v: PanelView) => {
    if (v === 'terminal') {
      const w = window as unknown as { __panTerminalClickAt?: number };
      w.__panTerminalClickAt = performance.now();
      try {
        if (localStorage.getItem('PANOPTICON_TERMINAL_PROFILE') === '1') {
          console.log(`[xterm-click] session=${session.sessionId} t=${w.__panTerminalClickAt.toFixed(1)}`);
        }
      } catch { /* ignore */ }
    }
    setView(v);
    writeView(session.sessionId, v);
  };

  const synthesizedConversation = useMemo<Conversation | null>(() => {
    if (!session.hasJsonl) return null;
    const actualModel = session.model && session.model !== 'unknown' && session.model !== 'specialist'
      ? session.model
      : undefined;
    const fallbackModel = !actualModel
      ? (resolvedModels[resolveWorkTypeKey(session) ?? ''] ?? undefined)
      : undefined;
    // Defensive: an ended session MUST report a non-null endedAt, or
    // ConversationPanel will read `!sessionAlive && !endedAt` as "still
    // spawning" and render a "Starting…" placeholder over the JSONL. When the
    // backend hasn't supplied one (e.g. a sub-reviewer that finished while its
    // parent's endedAt is still null), fall back to startedAt so the panel
    // takes the orphaned/message-history branch instead.
    const endedAt = session.presence === 'ended'
      ? (session.endedAt ?? session.startedAt ?? new Date().toISOString())
      : (session.endedAt ?? null);
    return {
      id: -1,
      name: session.sessionId,
      tmuxSession: session.tmuxSession || session.sessionId,
      status: session.presence === 'ended' ? 'ended' : 'active',
      cwd: '',
      issueId: issueId || null,
      createdAt: session.startedAt,
      endedAt,
      lastAttachedAt: null,
      sessionAlive: session.presence !== 'ended',
      sessionFile: session.sessionId,
      model: actualModel ?? fallbackModel,
      deliveryMethod: session.deliveryMethod ?? null,
    };
  }, [session, issueId, resolvedModels]);

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
          {(hasJsonl || !isReviewSession) && (
            <button
              className={`${styles.sessionPanelToggleBtn} ${view === 'conversation' ? styles.sessionPanelToggleBtnActive : ''}`}
              onClick={() => handleSetView('conversation')}
            >
              Conversation
            </button>
          )}
          {isReviewSession && (
            <button
              className={`${styles.sessionPanelToggleBtn} ${view === 'findings' ? styles.sessionPanelToggleBtnActive : ''}`}
              onClick={() => handleSetView('findings')}
            >
              Summary
            </button>
          )}
          {!isReviewSession && hasFindings && (
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
        {session.deliveryMethod !== undefined && (
          <DeliveryMethodToggle sessionId={session.sessionId} deliveryMethod={session.deliveryMethod} />
        )}
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
              agentId={session.sessionId}
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

        {view === 'findings' && isReviewSession && (
          <ReviewSummary
            session={session}
            reviewers={reviewers ?? []}
            roundData={roundData}
          />
        )}

        {view === 'findings' && !isReviewSession && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {roundData.length === 0 ? (
              <div className={styles.sessionPanelEmpty}>No review rounds recorded.</div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Review rounds
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {roundData.map((r) => (
                    <RoundCard key={r.round} round={r} active={r.round === session.roundMetadata?.latestRound} />
                  ))}
                </div>
                {/* Show synthesis summaries for each round */}
                {session.roundMetadata?.history.map((r) => r.summary ? (
                  <div key={`summary-${r.round}`} style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>
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
