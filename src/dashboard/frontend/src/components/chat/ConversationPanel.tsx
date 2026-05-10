import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDashboardStore } from '../../lib/store';
import { useTheme } from '../../hooks/useTheme';
import { useConversationUiState } from '../../hooks/useConversationUiState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Circle, Copy, Check, Loader2, Pencil, Terminal, FileCode, Search, Globe, Wrench, Zap, GitBranchPlus, CheckCircle2, AlertCircle, Archive } from 'lucide-react';
import { XTerminal } from '../XTerminal';
import type { Conversation } from '../CommandDeck/ConversationList';
import { updateConversationTitle } from '../CommandDeck/ConversationList';
import { MessagesTimeline, type RoundMarker } from './MessagesTimeline';
import { ComposerFooter } from './ComposerFooter';
import { ModelPicker, saveStoredHarness, saveStoredModel, type Harness } from './ModelPicker';
import { getDefaultConversationModel } from './defaultConversationModel';
import type { ChatMessage, CompactBoundary, ProposedPlan, TurnDiffSummary, WorkLogEntry } from './chat-types';
import { getWorkingPhase, getPhaseLabel, getPendingToolEntry, isSpinnerPhase, type WorkingPhase } from '../../lib/workingPhase';
import { deriveRoundMarkers } from '../../lib/deriveRoundMarkers';
import type { ReviewerRoundMetadata } from '@panctl/contracts';
import { DiffPanel } from '../DiffPanel';
import { DiffWorkerPoolProvider } from '../DiffWorkerPoolProvider';
import { parseDiffRouteSearch } from '../../lib/diffRouteSearch';
import { useConfirm } from '../DialogProvider';
import styles from '../CommandDeck/styles/command-deck.module.css';

// ─── Phase icon map ───────────────────────────────────────────────────────────

const PHASE_ICONS = {
  init:       Zap,
  thinking:   Loader2,
  bash:       Terminal,
  file:       FileCode,
  search:     Search,
  web:        Globe,
  agent:      Loader2,
  tool:       Wrench,
  processing: Loader2,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewMode = 'conversation' | 'terminal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationPanelProps {
  conversation: Conversation;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  onArchived?: () => void;
  /** Optional review-round dividers injected into the MessagesTimeline. */
  roundMarkers?: ReadonlyArray<RoundMarker>;
  /** Reviewer round metadata to derive timeline dividers (PAN-830 high-8). */
  roundMetadata?: ReviewerRoundMetadata;
  /** When true, hide the header chrome (title, status, toggles) and suppress
   *  Resume/Archive — used when embedded inside SessionPanel where ZoneB
   *  already shows session info and specialists can't be resumed. */
  embedded?: boolean;
  /** Agent ID for fetching turn diffs. Omit to skip diff display. */
  agentId?: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function resumeConversation(name: string, model?: string, effort?: string, harness?: Harness): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, effort, harness }),
  });
  if (!res.ok) throw new Error('Failed to resume conversation');
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationPanel({
  conversation,
  viewMode = 'conversation',
  onViewModeChange,
  onArchived,
  roundMarkers,
  roundMetadata,
  embedded = false,
  agentId,
}: ConversationPanelProps) {
  const [resumed, setResumed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const confirm = useConfirm();
  const [selectedModel, setSelectedModel] = useState<string>(() => conversation.model || getDefaultConversationModel());
  // See ComposerFooter for rationale — never seed an existing conversation's
  // harness from the global localStorage default.
  const [selectedHarness, setSelectedHarness] = useState<Harness>(() => conversation.harness ?? 'claude-code');
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftTitleRef = useRef('');
  const committingRef = useRef(false);
  const queryClient = useQueryClient();

  // Sync the picker when the backing conversation's model changes (e.g. after a
  // resume/switch-model that persisted a new model). useState's lazy initializer
  // only fires once, so without this the picker shows the stale model forever.
  useEffect(() => {
    if (conversation.model && conversation.model !== selectedModel) {
      setSelectedModel(conversation.model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.model]);

  useEffect(() => {
    if (conversation.harness && conversation.harness !== selectedHarness) {
      setSelectedHarness(conversation.harness);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.harness]);

  // Query messages at this level so we can drive the header working-spinner
  const { data: messagesData } = useQuery({
    queryKey: ['conversation-messages', conversation.name],
    queryFn: () => fetchMessages(conversation.name),
    refetchInterval: conversation.sessionAlive ? 2000 : false,
  });
  const headerMessages = messagesData?.messages ?? [];
  const headerWorkLog = messagesData?.workLog ?? [];
  const headerLastMsg = headerMessages[headerMessages.length - 1];
  // Spin unless truly idle: idle = last message is a completed assistant turn (completedAt set).
  // Empty history, last-user, and in-progress assistant (no completedAt) all mean still working.
  const isWorking = conversation.sessionAlive && (
    messagesData == null ||
    headerMessages.length === 0 ||
    headerLastMsg?.role === 'user' ||
    (headerLastMsg?.role === 'assistant' && !headerLastMsg.completedAt)
  );
  const workingPhase = isWorking ? getWorkingPhase(headerMessages, headerWorkLog) : 'thinking';
  const pendingEntry = isWorking ? getPendingToolEntry(headerWorkLog) : undefined;
  const workingLabel = getPhaseLabel(workingPhase, pendingEntry);
  const WorkingIcon = PHASE_ICONS[workingPhase];
  const workingIconClass = isSpinnerPhase(workingPhase) ? styles.spinnerIcon : styles.pulseIcon;

  // Theme for diff tree icons
  const { resolvedTheme } = useTheme();

  // Fetch turn diff summaries — agent diffs (checkpoint-based) or conversation diffs (JSONL-based)
  const { data: diffData } = useQuery({
    queryKey: agentId
      ? ['agent-diffs', agentId]
      : ['conversation-diffs', conversation.name],
    queryFn: async () => {
      if (agentId) {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/diffs`)
        if (!res.ok) return null
        return res.json() as Promise<{ summaries: TurnDiffSummary[] }>
      }
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/diffs`)
      if (!res.ok) return null
      return res.json() as Promise<{ summaries: TurnDiffSummary[] }>
    },
    refetchInterval: 5000,
  })

  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const map = new Map<string, TurnDiffSummary>()
    if (!diffData?.summaries) return map

    // Get assistant messages for timestamp-based matching
    const assistantMessages = (messagesData?.messages ?? [])
      .filter((m: any) => m.role === 'assistant')
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    for (const summary of diffData.summaries) {
      if (summary.assistantMessageId) {
        map.set(summary.assistantMessageId, summary)
        continue
      }

      // Match by timestamp: find the closest assistant message before the diff completed
      if (assistantMessages.length > 0 && summary.completedAt) {
        const diffTime = new Date(summary.completedAt).getTime()
        let bestMatch: string | null = null
        let bestDelta = Infinity
        for (const msg of assistantMessages) {
          const msgTime = new Date(msg.createdAt).getTime()
          const delta = diffTime - msgTime
          if (delta >= 0 && delta < bestDelta) {
            bestDelta = delta
            bestMatch = msg.id
          }
        }
        // Only match if within 7 days — reconciled checkpoints may have been
        // created long after the agent turn completed.
        if (bestMatch && bestDelta < 7 * 24 * 60 * 60 * 1000) {
          map.set(bestMatch, summary)
        }
      }
    }
    return map
  }, [diffData?.summaries, messagesData?.messages])

  // Diff panel state — read from URL
  const [diffOpen, setDiffOpen] = useState(() => {
    const params = parseDiffRouteSearch(
      Object.fromEntries(new URLSearchParams(window.location.search)),
    )
    return params.diff === '1'
  })

  // Listen for URL changes (popstate)
  useEffect(() => {
    const onPopState = () => {
      const params = parseDiffRouteSearch(
        Object.fromEntries(new URLSearchParams(window.location.search)),
      )
      setDiffOpen(params.diff === '1')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const handleOpenTurnDiff = useCallback((turnId: string, filePath?: string) => {
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set('diff', '1')
    searchParams.set('diffTurnId', turnId)
    if (filePath) searchParams.set('diffFilePath', filePath)
    else searchParams.delete('diffFilePath')
    const url = `${window.location.pathname}?${searchParams.toString()}`
    window.history.pushState({}, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
    setDiffOpen(true)
  }, [])

  const handleCloseDiff = useCallback(() => {
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.delete('diff')
    searchParams.delete('diffTurnId')
    searchParams.delete('diffFilePath')
    const query = searchParams.toString()
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname
    window.history.pushState({}, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
    setDiffOpen(false)
  }, [])

  const resumeMutation = useMutation({
    mutationFn: () => resumeConversation(conversation.name, selectedModel, conversation.effort ?? undefined, selectedHarness),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversation.name] });
      setResumed(true);
    },
  });

  const switchModelMutation = useMutation({
    mutationFn: ({ model, harness }: { model: string; harness: Harness }) => {
      const endpoint = agentId
        ? `/api/agents/${encodeURIComponent(agentId)}/switch-model`
        : `/api/conversations/${encodeURIComponent(conversation.name)}/switch-model`;
      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, harness }),
      }).then(r => { if (!r.ok) throw new Error('Failed to switch model'); return r.json(); });
    },
    onSuccess: (_, { model, harness }) => {
      saveStoredModel(model);
      saveStoredHarness(harness);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversation.name] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (title: string) => updateConversationTitle(conversation.name, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const startEditingTitle = useCallback(() => {
    committingRef.current = false;
    const initial = conversation.title ?? conversation.name;
    draftTitleRef.current = initial;
    setDraftTitle(initial);
    setEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.select();
    }, 0);
  }, [conversation.title, conversation.name]);

  const commitTitleRename = useCallback(() => {
    if (committingRef.current) return;
    committingRef.current = true;
    const trimmed = draftTitleRef.current.trim();
    const original = conversation.title ?? conversation.name;
    setEditingTitle(false);
    if (trimmed && trimmed !== original) {
      renameMutation.mutate(trimmed);
    }
  }, [conversation.title, conversation.name, renameMutation]);

  const cancelTitleEditing = useCallback(() => {
    setEditingTitle(false);
    setDraftTitle('');
  }, []);

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
    onViewModeChange?.(mode);
  }, [onViewModeChange]);

  // Per-conversation UI state (client-only, localStorage)
  const { hideToolCalls, toggleHideToolCalls } = useConversationUiState(conversation.name);

  const handleCopyLink = useCallback(() => {
    const params = new URLSearchParams();
    if (viewMode === 'terminal') {
      params.set('view', 'terminal');
    }
    const query = params.toString();
    const url = `${window.location.origin}/conv/${conversation.id}${query ? `?${query}` : ''}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [conversation.id, viewMode]);

  const showTerminal = conversation.sessionAlive || resumed;

  const isForkingHeader = !!conversation.forkStatus && conversation.forkStatus !== 'failed';
  const isForkFailedHeader = conversation.forkStatus === 'failed';
  const statusColor = isForkingHeader
    ? 'var(--warning)'
    : isForkFailedHeader
    ? 'var(--destructive)'
    : conversation.sessionAlive
    ? 'var(--success)'
    : 'var(--muted-foreground)';
  const statusLabel = isForkingHeader ? 'forking' : isForkFailedHeader ? 'failed' : conversation.sessionAlive ? 'active' : 'ended';

  return (
    <div className={styles.conversationTerminal}>
      {/* Header bar — hidden in embedded mode (ZoneB already shows session info) */}
      {!embedded && (
        <div className={styles.conversationTerminalHeader}>
          <span className={styles.conversationTerminalTitle}>
            {isWorking && (
              <span title={workingLabel} style={{ display: 'contents' }}>
                <WorkingIcon
                  size={14}
                  className={workingIconClass}
                  aria-label={workingLabel}
                />
              </span>
            )}
            {editingTitle ? (
              <input
                ref={titleInputRef}
                className={styles.conversationTitleInput}
                value={draftTitle}
                onChange={e => { setDraftTitle(e.target.value); draftTitleRef.current = e.target.value; }}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitTitleRename();
                  if (e.key === 'Escape') cancelTitleEditing();
                }}
                onBlur={commitTitleRename}
                aria-label={`Rename ${conversation.name}`}
              />
            ) : (
              <>
                {conversation.title ?? conversation.name}
                <button
                  className={styles.conversationTitleEditBtn}
                  onClick={startEditingTitle}
                  title="Rename conversation"
                  aria-label={`Rename ${conversation.name}`}
                >
                  <Pencil size={12} />
                </button>
              </>
            )}
          </span>
          <span className={styles.conversationTerminalStatus}>
            <Circle
              size={7}
              style={{ fill: statusColor, color: statusColor }}
            />
            {statusLabel}
          </span>
          <span className={styles.conversationSessionId}>
            {conversation.sessionFile?.split('/').pop()?.replace('.jsonl', '') ?? conversation.name}
          </span>

          {/* Copy link button */}
          <button
            className={styles.copyLinkButton}
            onClick={handleCopyLink}
            title="Copy link to conversation"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>

          {/* Hide tool calls toggle */}
          <button
            className={styles.copyLinkButton}
            onClick={toggleHideToolCalls}
            title={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
            aria-label={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
            style={hideToolCalls ? { color: 'var(--primary)' } : undefined}
          >
            <Wrench size={14} />
          </button>

          {/* Archive button with inline confirmation (dialog for favorited) */}
          {onArchived && !confirmArchive && (
            <button
              className={styles.copyLinkButton}
              onClick={async () => {
                if (conversation.isFavorited) {
                  const ok = await confirm({
                    title: 'Archive favorited conversation',
                    message: `"${conversation.title ?? conversation.name}" is favorited.\n\nArchiving will remove the favorite, end the session, and move it to the archive.`,
                    confirmLabel: 'Archive',
                    cancelLabel: 'Cancel',
                    variant: 'destructive',
                  });
                  if (ok) handleArchive();
                } else {
                  setConfirmArchive(true);
                }
              }}
              title="Archive conversation"
            >
              <Archive size={14} />
            </button>
          )}
          {onArchived && confirmArchive && (
            <span className={styles.archiveConfirm}>
              <span className={styles.archiveConfirmLabel}>Archive?</span>
              <button
                className={styles.archiveConfirmYes}
                onClick={() => { setConfirmArchive(false); handleArchive(); }}
              >
                Yes
              </button>
              <button
                className={styles.archiveConfirmNo}
                onClick={() => setConfirmArchive(false)}
              >
                No
              </button>
            </span>
          )}

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
      )}

      {/* Body — conversation + optional diff panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className={styles.conversationTerminalBody}>
          {/* Terminal: only mounted when actively viewing (xterm.js crashes with visibility:hidden) */}
          {showTerminal && viewMode === 'terminal' && (
            <XTerminal sessionName={conversation.tmuxSession} />
          )}
          {/* Conversation view — shown when in conversation mode or session ended */}
          {(viewMode === 'conversation' || !showTerminal) && (
            <ConversationView
              conversation={conversation}
              onResume={!embedded && !showTerminal ? handleResume : undefined}
              onArchive={!embedded ? handleArchive : undefined}
              resumePending={resumeMutation.isPending}
              roundMarkers={roundMarkers}
              roundMetadata={roundMetadata}
              turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
              onOpenTurnDiff={handleOpenTurnDiff}
              resolvedTheme={resolvedTheme}
              agentId={agentId}
              hideToolCalls={hideToolCalls}
              workingPhase={isWorking ? workingPhase : undefined}
              modelPicker={!embedded ? (
                <ModelPicker
                  value={selectedModel}
                  harness={selectedHarness}
                  onHarnessChange={(harness) => {
                    setSelectedHarness(harness);
                    switchModelMutation.mutate({ model: selectedModel, harness });
                  }}
                  onChange={(modelId) => {
                    setSelectedModel(modelId);
                    switchModelMutation.mutate({ model: modelId, harness: selectedHarness });
                  }}
                />
              ) : undefined}
            />
          )}
        </div>
        {/* Diff side panel — rendered when ?diff=1 is in the URL */}
        {diffOpen && diffData?.summaries && (
          <DiffWorkerPoolProvider>
            <DiffPanel
              mode="inline"
              agentId={agentId ?? conversation.name}
              turnDiffSummaries={diffData.summaries}
              onClose={handleCloseDiff}
              {...(!agentId ? { diffUrlPrefix: `/api/conversations/${encodeURIComponent(conversation.name)}/diffs` } : {})}
            />
          </DiffWorkerPoolProvider>
        )}
      </div>
    </div>
  );
}

// ─── ForkProgressView ─────────────────────────────────────────────────────────

const FORK_STEPS = [
  { key: 'summarizing', label: 'Summarizing', description: 'Generating a concise summary of the parent conversation' },
  { key: 'spawning',    label: 'Spawning',    description: 'Starting a new Claude Code session' },
  { key: 'injecting',   label: 'Injecting',   description: 'Seeding the new session with conversation context' },
] as const;

function ForkProgressView({ forkStatus, forkError, parentTitle }: {
  forkStatus: string;
  forkError?: string | null;
  parentTitle?: string;
}) {
  const isFailed = forkStatus === 'failed';
  const activeIdx = FORK_STEPS.findIndex((s) => s.key === forkStatus);

  return (
    <div className={styles.forkProgressView}>
      <div className={styles.forkProgressCard}>
        <div className={styles.forkProgressHeader}>
          <GitBranchPlus size={20} className={styles.forkProgressIcon} />
          <div>
            <h3 className={styles.forkProgressTitle}>
              {isFailed ? 'Fork Failed' : 'Setting up fork…'}
            </h3>
            {parentTitle && (
              <p className={styles.forkProgressSubtitle}>
                Forking from <strong>{parentTitle}</strong>
              </p>
            )}
          </div>
        </div>

        <div className={styles.forkProgressTimeline}>
          {FORK_STEPS.map((step, i) => {
            let state: 'done' | 'active' | 'pending' | 'failed';
            if (isFailed) {
              state = i < activeIdx ? 'done' : i === activeIdx || (activeIdx === -1 && i === 0) ? 'failed' : 'pending';
            } else {
              state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
            }

            return (
              <div key={step.key} className={`${styles.forkProgressStep} ${styles[`forkProgressStep--${state}`]}`}>
                <div className={styles.forkProgressStepIndicator}>
                  {state === 'done' && <CheckCircle2 size={18} />}
                  {state === 'active' && <Loader2 size={18} className={styles.forkProgressSpinner} />}
                  {state === 'pending' && <Circle size={18} />}
                  {state === 'failed' && <AlertCircle size={18} />}
                  {i < FORK_STEPS.length - 1 && <div className={styles.forkProgressStepLine} />}
                </div>
                <div className={styles.forkProgressStepContent}>
                  <span className={styles.forkProgressStepLabel}>{step.label}</span>
                  <span className={styles.forkProgressStepDesc}>{step.description}</span>
                </div>
              </div>
            );
          })}
        </div>

        {isFailed && forkError && (
          <div className={styles.forkProgressError}>
            <AlertCircle size={14} />
            <span>{forkError}</span>
          </div>
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
  proposedPlan?: ProposedPlan;
  compactBoundaries?: CompactBoundary[];
  compacting?: boolean;
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
  /** ModelPicker component to render next to the Resume button */
  modelPicker?: React.ReactNode;
  /** Optional round-divider markers forwarded to the MessagesTimeline. */
  roundMarkers?: ReadonlyArray<RoundMarker>;
  /** Reviewer round metadata to derive timeline dividers (PAN-830 high-8). */
  roundMetadata?: ReviewerRoundMetadata;
  turnDiffSummaryByAssistantMessageId?: Map<string, TurnDiffSummary>;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
  /** Agent ID for agent sessions (uses /api/agents/* endpoints instead of /api/conversations/*) */
  agentId?: string;
  /** When true, pure tool-call work groups are collapsed to a single muted line. */
  hideToolCalls?: boolean;
  /** Current working phase — drives the working indicator icon. */
  workingPhase?: WorkingPhase;
}

export interface FailedMessage {
  id: string;
  text: string;
  createdAt: string;
}

function ConversationView({ conversation, onResume, onArchive, resumePending, modelPicker, roundMarkers, roundMetadata, turnDiffSummaryByAssistantMessageId, onOpenTurnDiff, resolvedTheme, agentId, hideToolCalls, workingPhase }: ConversationViewProps) {
  const isCompacting = useDashboardStore((s) => s.conversationsCompactingByName?.[conversation.name] ?? false);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [failedMessages, setFailedMessages] = useState<FailedMessage[]>([]);
  // Track count so we know when the server caught up
  const prevServerCountRef = useRef(0);
  const queryClient = useQueryClient();

  // When forkStatus transitions from non-null to null (fork completed),
  // immediately re-fetch messages so the user doesn't see a stale empty state.
  const prevForkStatusRef = useRef(conversation.forkStatus);
  useEffect(() => {
    const prev = prevForkStatusRef.current;
    prevForkStatusRef.current = conversation.forkStatus;
    if (prev && !conversation.forkStatus) {
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversation.name] });
    }
  }, [conversation.forkStatus, conversation.name, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ['conversation-messages', conversation.name],
    queryFn: () => fetchMessages(conversation.name),
    // Poll every 2s while session is active for live updates.
    // Since we don't have WebSocket push (unlike T3Code), polling is our streaming mechanism.
    refetchInterval: conversation.sessionAlive ? 2000 : false,
  });

  const serverMessages = data?.messages ?? [];
  const workLog = data?.workLog ?? [];

  // Drop optimistic messages once the server has returned at least as many messages
  // as we had before plus the optimistic ones (the real message has arrived).
  const expectedCount = prevServerCountRef.current + optimisticMessages.length;
  const serverCaughtUp = serverMessages.length >= expectedCount && optimisticMessages.length > 0;
  const messages = serverCaughtUp ? serverMessages : [...serverMessages, ...optimisticMessages];

  const handleMessageSent = useCallback((text: string) => {
    prevServerCountRef.current = serverMessages.length;
    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages([optimistic]);
  }, [serverMessages.length]);

  // Called by ComposerFooter when POST fails — move optimistic to failed outbox
  const handleSendFailed = useCallback((text: string) => {
    setOptimisticMessages([]);
    const failed: FailedMessage = {
      id: `failed-${Date.now()}`,
      text,
      createdAt: new Date().toISOString(),
    };
    setFailedMessages(prev => [...prev, failed]);
  }, []);

  const handleRetryFailed = useCallback(async (failedId: string, text: string) => {
    // Remove from failed list and re-send
    setFailedMessages(prev => prev.filter(f => f.id !== failedId));
    try {
      const endpoint = agentId
        ? `/api/agents/${encodeURIComponent(agentId)}/message`
        : `/api/conversations/${encodeURIComponent(conversation.name)}/message`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to send message (${res.status})${body ? `: ${body}` : ''}`);
      }
    } catch {
      // Re-add to failed list on retry failure
      const failed: FailedMessage = {
        id: `failed-${Date.now()}`,
        text,
        createdAt: new Date().toISOString(),
      };
      setFailedMessages(prev => [...prev, failed]);
    }
  }, [conversation.name, agentId]);

  const handleDiscardFailed = useCallback((failedId: string) => {
    setFailedMessages(prev => prev.filter(f => f.id !== failedId));
  }, []);

  // Clear failed messages when switching conversations
  useEffect(() => {
    setFailedMessages([]);
  }, [conversation.name]);

  // Clean up optimistic messages in an effect once the server catches up
  useEffect(() => {
    if (serverCaughtUp) setOptimisticMessages([]);
  }, [serverCaughtUp]);

  const isForkInProgress = !!conversation.forkStatus && conversation.forkStatus !== 'failed';
  const isForkFailed = conversation.forkStatus === 'failed';
  const isForking = isForkInProgress || isForkFailed;
  const isFirstMessage = !isLoading && messages.length === 0 && conversation.sessionAlive;
  const isOrphaned = !isLoading && messages.length === 0 && !conversation.sessionAlive;

  // Spin unless truly idle: idle = last message is a completed assistant turn (completedAt set).
  // Note: `completedAt` is reliably set server-side for all terminal stop reasons via
  // `entry.timestamp || new Date().toISOString()`, so `!lastMsg.completedAt` is safe.
  const lastMsg = messages[messages.length - 1];
  const isWorking = conversation.sessionAlive && (
    messages.length === 0 ||
    lastMsg?.role === 'user' ||
    (lastMsg?.role === 'assistant' && !lastMsg.completedAt)
  );

  const parentTitle = conversation.title?.replace(/^Summary Fork:\s*/, '') || undefined;

  // Derive round markers from roundMetadata + messages for reviewer sessions (PAN-830 high-8, PAN-847 pan-0h5k).
  const derivedRoundMarkers = useMemo(() => {
    const derived = deriveRoundMarkers(roundMetadata, messages);
    return derived.length > 0 ? derived : (roundMarkers ?? []);
  }, [roundMetadata, messages, roundMarkers]);

  return (
    <div className={styles.conversationView}>
      {isLoading ? (
        <div className={styles.conversationConnecting}>
          <span>Loading…</span>
        </div>
      ) : isForking && messages.length === 0 ? (
        <ForkProgressView
          forkStatus={conversation.forkStatus!}
          forkError={conversation.forkError}
          parentTitle={parentTitle}
        />
      ) : isOrphaned ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateSubtitle}>
            This conversation has no saved history. The session may have ended before any messages were exchanged.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {onResume && (
              <>
                {modelPicker}
                <button className={styles.conversationResumeBtn} onClick={onResume} disabled={resumePending}>
                  {resumePending ? 'Resuming…' : 'Resume Session'}
                </button>
              </>
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
          roundMarkers={derivedRoundMarkers}
          failedMessages={failedMessages}
          onRetryFailed={handleRetryFailed}
          onDiscardFailed={handleDiscardFailed}
          proposedPlan={data?.proposedPlan}
          compactBoundaries={data?.compactBoundaries}
          compacting={isCompacting}
          conversationName={conversation.name}
          turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
          onOpenTurnDiff={onOpenTurnDiff}
          resolvedTheme={resolvedTheme}
          hideToolCalls={hideToolCalls}
          workingPhase={workingPhase}
        />
      )}
      {isForking ? null : onResume ? (
        <div className={styles.conversationResumeBar}>
          {modelPicker}
          <button
            className={styles.conversationResumeBtn}
            onClick={onResume}
            disabled={resumePending}
          >
            {resumePending ? 'Resuming…' : 'Resume Session'}
          </button>
        </div>
      ) : (
        <ComposerFooter conversation={conversation} onSend={handleMessageSent} onSendFailed={handleSendFailed} agentId={agentId} />
      )}
    </div>
  );
}
