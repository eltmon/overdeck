import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitFork, TriangleAlert, AlertCircle, TerminalSquare, MessagesSquare, Wrench } from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import type { Conversation } from '../ConversationList';
import { ConversationPanel } from '../../chat/ConversationPanel';
import type { RoundMarker } from '../../chat/MessagesTimeline';
import { ChatMarkdown } from '../../chat/ChatMarkdown';
import { XTerminal } from '../../XTerminal';
import { AwaitingInputIndicator } from '../../AwaitingInputIndicator';
import { RoundCard } from '../RoundCard';
import type { RoundData, RoundVerdict } from '../RoundCard';
import { ReviewSummary } from './ReviewSummary';
import { useResolvedModels, resolveWorkTypeKey } from '../../../lib/useResolvedModels';
import { useConversationUiState } from '../../../hooks/useConversationUiState';
import styles from '../styles/command-deck.module.css';

// PAN-1523: branch/worktree chip in the SessionPanel header. Mirrors the
// chip in DrawerAgentSession, but anchored to a SessionNode instead of
// an Agent — same /api/agents/:id/git-info endpoint feeds both.
interface AgentGitInfo {
  actualBranch: string | null;
  branchDrifted: boolean;
  workspaceMissing: boolean;
  expectedBranch: string | null;
  workspacePath?: string | null;
}

async function fetchAgentGitInfo(agentId: string): Promise<AgentGitInfo | null> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/git-info`);
  if (!res.ok) return null;
  return res.json();
}

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

/**
 * Branch / worktree status chip shown next to the Conversation / Terminal /
 * Findings toggle in the SessionPanel header. Same data path as
 * DrawerAgentSession's chip — sources from /api/agents/:id/git-info, where
 * `:id` is the SessionNode's sessionId (work-agent and specialist tmux
 * sessions both expose state under that key).
 *
 * Renders nothing when the endpoint returns null (non-agent sessions or a
 * fetch failure); failing closed is the right call because there's no
 * branch to show for a JSONL-only session that isn't bound to a workspace.
 */
function SessionPanelBranchChip({ sessionId }: { sessionId: string }) {
  const { data: gitInfo } = useQuery({
    queryKey: ['agent-git-info', sessionId],
    queryFn: () => fetchAgentGitInfo(sessionId),
    enabled: !!sessionId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  if (!gitInfo) return null;

  const showChip = Boolean(gitInfo.actualBranch || gitInfo.workspaceMissing);
  if (!showChip) return null;

  const drifted = gitInfo.branchDrifted;
  const missing = gitInfo.workspaceMissing;

  return (
    <span
      className={`${styles.terminalBranchBar} ${
        missing
          ? styles.terminalBranchBarMissing
          : drifted
            ? styles.terminalBranchBarDrift
            : ''
      }`}
      title={
        missing
          ? `Workspace missing on disk: ${gitInfo.workspacePath ?? '(unknown path)'}`
          : drifted
            ? `Expected ${gitInfo.expectedBranch ?? '(none)'}, on ${gitInfo.actualBranch ?? '(none)'}`
            : `${gitInfo.workspacePath ?? ''}`
      }
      data-testid="session-panel-branch-chip"
    >
      {missing ? (
        <>
          <AlertCircle size={12} />
          <span className={styles.terminalBranchBarMode}>Worktree missing</span>
        </>
      ) : (
        <>
          {drifted ? <TriangleAlert size={12} /> : <GitFork size={12} />}
          <span className={styles.terminalBranchBarMode}>
            {drifted ? 'Drifted' : 'Worktree'}
          </span>
          <span className={styles.terminalBranchBarText}>{gitInfo.actualBranch}</span>
        </>
      )}
    </span>
  );
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
  // Tool-call visibility toggle — shared with the embedded ConversationPanel
  // via controlled props. Keyed by sessionId so the preference sticks per
  // agent and matches the standalone conversation view's key for the same
  // session. (PAN-XXXX)
  const { hideToolCalls, toggleHideToolCalls } = useConversationUiState(session.sessionId);
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
      // Carry the harness so the live message stream can be enabled for this
      // synthetic agent session (PAN-1908: pi/codex work agents stream too).
      harness: session.harness as Conversation['harness'],
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
        {session.awaitingInput && (
          <AwaitingInputIndicator kinds={['askUserQuestion']} />
        )}
        <SessionPanelBranchChip sessionId={session.sessionId} />
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
        <button
          className={`${styles.conversationAboutToggle} ${hideToolCalls ? styles.conversationAboutToggleActive : ''}`}
          onClick={toggleHideToolCalls}
          title={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
          aria-label={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
          aria-pressed={hideToolCalls}
        >
          <Wrench size={14} />
          <span>Tools</span>
        </button>
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
              hideToolCalls={hideToolCalls}
              onToggleHideToolCalls={toggleHideToolCalls}
            />
          ) : hasTranscript ? (
            <div className={styles.sessionPanelTranscript}>
              <ChatMarkdown text={session.transcript!} isStreaming={false} cwd={undefined} />
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
                    <ChatMarkdown text={r.summary} isStreaming={false} cwd={undefined} />
                  </div>
                ) : null)}
              </>
            )}
          </div>
        )}

        {view === 'terminal' && (
          session.harness === 'pi' ? (
            // Pi agents run as `pi --mode rpc`: there is no interactive TUI. The
            // tmux pane carries the raw JSON-RPC wire protocol (one JSON object
            // per streamed event), which is unreadable as a terminal. Point the
            // operator at the Conversation tab, which renders the same transcript
            // parsed into messages. (Claude Code and Codex run real TUIs, so they
            // keep the live terminal.)
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-10 text-center">
              <div className="relative">
                <TerminalSquare className="h-9 w-9 text-muted-foreground/40" />
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-card text-[10px] font-bold text-muted-foreground/60">×</span>
              </div>
              <div className="text-sm font-semibold text-foreground">No live terminal for this agent</div>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                Pi agents run in <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">--mode rpc</span> —
                there is no interactive terminal, so this pane would only stream raw
                JSON-RPC protocol. Use the <strong className="text-foreground">Conversation</strong> tab,
                which renders the same transcript as readable messages.
              </p>
              <button
                type="button"
                onClick={() => handleSetView('conversation')}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <MessagesSquare className="h-3.5 w-3.5" />
                Open Conversation
              </button>
            </div>
          ) : hasTerminal && tmuxName ? (
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
