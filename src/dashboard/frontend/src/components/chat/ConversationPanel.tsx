import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDashboardStore } from '../../lib/store';
import { useTheme } from '../../hooks/useTheme';
import { useConversationUiState } from '../../hooks/useConversationUiState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Circle, Copy, Check, Loader2, Pencil, Terminal, FileCode, Search, Globe, Wrench, Zap, Folder, GitBranchPlus, GitFork, CheckCircle2, AlertCircle, Archive, Sparkles, Info, RefreshCw, FileText, ExternalLink, RotateCcw, ArrowRight, MoreVertical, Star, Share2, Download, Square } from 'lucide-react';
import { toast } from 'sonner';
import { XTerminal } from '../XTerminal';
import type { Conversation } from '../CommandDeck/ConversationList';
import { updateConversationTitle } from '../CommandDeck/ConversationList';
import { MessagesTimeline, type RoundMarker } from './MessagesTimeline';
import { ComposerFooter } from './ComposerFooter';
import { toContextWindowSnapshot } from '../../lib/contextWindow';
import { fetchWithTimeout } from '../../lib/apiFetch';
import { ModelPicker, saveStoredHarness, saveStoredModel, type Harness } from './ModelPicker';
import { getDefaultConversationModel } from './defaultConversationModel';
import type { ChatMessage, CompactBoundary, ContextUsage, ProposedPlan, TurnDiffSummary, WorkLogEntry } from './chat-types';
import {
  useComposerStore,
  useConversationOptimistic,
  useConversationOptimisticBaseCount,
  useConversationFailed,
} from '../../lib/composerStore';
import { getWorkingPhase, getPhaseLabel, getPendingToolEntry, isSpinnerPhase, type WorkingPhase } from '../../lib/workingPhase';
import { deriveRoundMarkers } from '../../lib/deriveRoundMarkers';
import type { ReviewerRoundMetadata } from '@overdeck/contracts';
import { DiffPanel } from '../DiffPanel';
import { DiffWorkerPoolProvider } from '../DiffWorkerPoolProvider';
import { PanOpenInPicker } from '../PanOpenInPicker';
import { parseDiffRouteSearch } from '../../lib/diffRouteSearch';
import { useConfirm } from '../DialogProvider';
import { useConversationMutations } from '../CommandDeck/useConversationMutations';
import { ForkModal } from '../CommandDeck/ForkModal';
import { conversationMessagesQueryKey, useConversationMessagesStream } from './useConversationMessagesStream';
import styles from '../CommandDeck/styles/command-deck.module.css';

// PAN-1635: a turn that has shown no transcript progress for this long is
// stalled, not working. Covers a slow compaction + response (a Claude-native
// /compact here ran ~128s before any follow-up); finite so a prompt that was
// eaten by submit-time compaction can't strand the spinner forever.
const TURN_STALL_MS = 4 * 60_000;

/**
 * Whether the conversation's latest transcript entry is recent enough that the
 * agent could still be mid-turn. Empty/loading history counts as recent (startup).
 */
function lastActivityRecent(lastMsg: ChatMessage | undefined): boolean {
  if (!lastMsg) return true;
  const ts = Date.parse(lastMsg.completedAt || lastMsg.createdAt || '');
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts < TURN_STALL_MS;
}

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
  /** Message target requested by palette conversation search. */
  targetMessageId?: string;
  targetMessageIndex?: number;
  targetMessageNonce?: number;
  onTargetMessageHandled?: () => void;
  /**
   * Controlled tool-call visibility. When provided (embedded agent panes that
   * render their own Tools toggle in the parent header), overrides the
   * internal per-conversation localStorage state.
   */
  hideToolCalls?: boolean;
  onToggleHideToolCalls?: () => void;
  /** When provided in embedded mode, shows a resume/action bar instead of the
   *  composer. Use when the session is ended and the parent wants a custom CTA. */
  onEmbeddedResume?: () => void;
  /** Label for the embedded resume button. Defaults to "Resume Session". */
  embeddedResumeLabel?: string;
  /** Called when a message POST fails — use to trigger a conversation refetch. */
  onSendFailed?: () => void;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function updateConversationDeliveryMethod(
  name: string,
  deliveryMethod: 'auto' | 'channels' | 'tmux',
): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/delivery-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryMethod }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to update delivery method (${res.status})${body ? `: ${body}` : ''}`);
  }
}

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
  targetMessageId,
  targetMessageIndex,
  targetMessageNonce,
  onTargetMessageHandled,
  hideToolCalls: controlledHideToolCalls,
  onToggleHideToolCalls,
  onEmbeddedResume,
  embeddedResumeLabel,
  onSendFailed,
}: ConversationPanelProps) {
  const [resumed, setResumed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const confirm = useConfirm();
  // Self-hosted mutations + ForkModal so the header can favorite / stop / hand
  // off / fork without threading callbacks through every embed site.
  const convMutations = useConversationMutations(conversation.name, () => {});
  const [selectedModel, setSelectedModel] = useState<string>(() => conversation.model || getDefaultConversationModel());
  // See ComposerFooter for rationale — never seed an existing conversation's
  // harness from the global localStorage default.
  const [selectedHarness, setSelectedHarness] = useState<Harness>(() => (conversation.harness === 'pi' ? 'ohmypi' : conversation.harness) ?? 'claude-code');
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftTitleRef = useRef('');
  const committingRef = useRef(false);
  const queryClient = useQueryClient();
  const messagesQueryKey = useMemo(() => conversationMessagesQueryKey(conversation.name), [conversation.name]);
  const streamMessagesEnabled = useConversationMessagesStream(conversation);
  // Ref mirrors the latest streaming state so the HTTP queryFn can discard
  // responses that were already in flight when streaming became active.
  const streamActiveRef = useRef(streamMessagesEnabled);
  streamActiveRef.current = streamMessagesEnabled;
  const [deliveryMethod, setDeliveryMethod] = useState(conversation.deliveryMethod ?? 'auto');
  const [deliveryMethodSaving, setDeliveryMethodSaving] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    setAboutOpen(false);
  }, [conversation.name]);

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
      setSelectedHarness(conversation.harness === 'pi' ? 'ohmypi' : conversation.harness);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.harness]);

  useEffect(() => {
    if (conversation.deliveryMethod && conversation.deliveryMethod !== deliveryMethod) {
      setDeliveryMethod(conversation.deliveryMethod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.deliveryMethod]);

  useEffect(() => {
    if (streamMessagesEnabled) {
      void queryClient.cancelQueries({ queryKey: messagesQueryKey });
    }
  }, [messagesQueryKey, queryClient, streamMessagesEnabled]);

  // Query messages at this level so we can drive the header working-spinner.
  // Live claude-code conversations are pushed through useConversationMessagesStream;
  // keep the existing polling path for non-claude harnesses and historical views.
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: messagesQueryKey,
    queryFn: async ({ signal }) => {
      const fetched = await fetchMessages(conversation.name, signal);
      // If the WS subscription became active while this HTTP request was in
      // flight, prefer the streamed cache ONLY when it is at least as complete
      // as this HTTP backfill. When the WS snapshot has not arrived yet (or was
      // partial), this HTTP response is the authoritative full history — use it
      // rather than returning empty/truncated state. (PAN-1642 regression: the
      // old `cached ?? empty` rendered "How can I help you?" / only-last-parts
      // whenever the snapshot lost the race, worsening under load.)
      if (streamActiveRef.current) {
        const cached = queryClient.getQueryData<MessagesResponse>(messagesQueryKey);
        if (cached && cached.messages.length >= fetched.messages.length) return cached;
      }
      return fetched;
    },
    enabled: !streamMessagesEnabled,
    refetchInterval: streamMessagesEnabled ? false : (conversation.sessionAlive ? 2000 : false),
  });
  const headerMessages = messagesData?.messages ?? [];
  const headerWorkLog = messagesData?.workLog ?? [];
  const headerLastMsg = headerMessages[headerMessages.length - 1];
  const canSwitchConversationModel =
    !agentId &&
    !conversation.sessionAlive &&
    !conversation.claudeSessionId &&
    headerMessages.length === 0;
  // Spin unless truly idle: idle = last message is a completed assistant turn (completedAt set).
  // Empty history, last-user, and in-progress assistant (no completedAt) all mean still working.
  // PAN-1635: a trailing user/incomplete-assistant entry only implies "working" while it's
  // recent — otherwise a prompt eaten by submit-time compaction spins the header forever.
  const isWorking = conversation.sessionAlive && (
    messagesData == null ||
    headerMessages.length === 0 ||
    (lastActivityRecent(headerLastMsg) && (
      headerLastMsg?.role === 'user' ||
      (headerLastMsg?.role === 'assistant' && !headerLastMsg.completedAt)
    ))
  );
  const workingPhase = isWorking ? getWorkingPhase(headerMessages, headerWorkLog) : 'thinking';
  const pendingEntry = isWorking ? getPendingToolEntry(headerWorkLog) : undefined;
  const workingLabel = getPhaseLabel(workingPhase, pendingEntry);
  const WorkingIcon = PHASE_ICONS[workingPhase];
  const workingIconClass = isSpinnerPhase(workingPhase) ? styles.spinnerIcon : styles.pulseIcon;

  // Theme for diff tree icons
  const { resolvedTheme } = useTheme();

  // Fetch turn diff summaries — always use JSONL-based conversation diffs
  // (the checkpoint-based agent diffs path doesn't populate assistantMessageId).
  // The /diffs endpoint is keyed by a real conversations-table row; session-
  // backed panels (SessionPanel, DrawerAgentSession) synthesize a conversation
  // with id < 0 and have no such row, so skip the fetch — otherwise it
  // 404-polls every 5s with the session id as the conversation name.
  const isSyntheticConversation = conversation.id < 0;
  const { data: diffData } = useQuery({
    queryKey: ['conversation-diffs', conversation.name],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/diffs`)
      if (!res.ok) return null
      return res.json() as Promise<{ summaries: TurnDiffSummary[] }>
    },
    enabled: !isSyntheticConversation,
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
      queryClient.invalidateQueries({ queryKey: conversationMessagesQueryKey(conversation.name) });
      setResumed(true);
    },
  });

  const switchModelMutation = useMutation({
    mutationFn: ({ model, harness }: { model: string; harness: Harness }) => {
      if (agentId) throw new Error('Agent models are locked after spawn');
      return fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/switch-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, harness }),
      }).then(r => { if (!r.ok) throw new Error('Failed to switch model'); return r.json(); });
    },
    onSuccess: (_, { model, harness }) => {
      saveStoredModel(model);
      saveStoredHarness(harness);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: conversationMessagesQueryKey(conversation.name) });
    },
  });

  const abortMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/abort`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to stop turn (${res.status})${body ? `: ${body}` : ''}`);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (title: string) => updateConversationTitle(conversation.name, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Regenerate the title from the whole conversation (not just the first message).
  const retitleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversation.name)}/retitle`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to regenerate title');
      return data as { title: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success(`Renamed to "${data.title}"`, { duration: 4000 });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
    },
  });

  // "About" drawer summary — fetched lazily, only while the drawer is open.
  const aboutQuery = useQuery({
    queryKey: ['conversation-about', conversation.name],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/about`);
      if (!res.ok) throw new Error('Failed to load conversation summary');
      return res.json() as Promise<{
        summary: string | null;
        messageCount: number;
        generatedAt: string | null;
      }>;
    },
    enabled: aboutOpen && !embedded,
    staleTime: 60_000,
  });

  const refreshAboutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversation.name)}/about?refresh=1`,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to refresh summary');
      return data as { summary: string | null; messageCount: number; generatedAt: string | null };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['conversation-about', conversation.name], data);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
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

  const handleExportTranscript = useCallback(() => {
    const messages = messagesData?.messages ?? [];
    if (messages.length === 0) {
      toast.error('No messages to export yet');
      return;
    }
    const md = messages
      .map((m) => `## ${m.role}\n\n${m.text ?? ''}\n`)
      .join('\n');
    const header = `# ${conversation.title ?? conversation.name}\n\n`;
    const blob = new Blob([header + md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(conversation.title ?? conversation.name).replace(/[^\w.-]+/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Transcript exported');
  }, [messagesData, conversation.title, conversation.name]);

  const handleViewMode = useCallback((mode: ViewMode) => {
    if (mode === 'terminal') {
      const w = window as unknown as { __panTerminalClickAt?: number };
      w.__panTerminalClickAt = performance.now();
      try {
        if (localStorage.getItem('OVERDECK_TERMINAL_PROFILE') === '1') {
          console.log(`[xterm-click] conv=${conversation.name} t=${w.__panTerminalClickAt.toFixed(1)}`);
        }
      } catch { /* ignore */ }
    }
    onViewModeChange?.(mode);
  }, [onViewModeChange, conversation.name]);

  const handleDeliveryMethodChange = useCallback(async (method: 'auto' | 'channels' | 'tmux') => {
    setDeliveryMethodSaving(true);
    try {
      await updateConversationDeliveryMethod(conversation.name, method);
      setDeliveryMethod(method);
    } catch (err) {
      console.error('[ConversationPanel] Failed to update delivery method:', err);
    } finally {
      setDeliveryMethodSaving(false);
    }
  }, [conversation.name]);

  // Per-conversation UI state (client-only, localStorage). Embedded agent
  // panes pass controlled props from their own header toggle; when absent
  // (standalone conversation view) the internal hook is authoritative.
  const uiToolState = useConversationUiState(conversation.name);
  const hideToolCalls = controlledHideToolCalls ?? uiToolState.hideToolCalls;
  const toggleHideToolCalls = onToggleHideToolCalls ?? uiToolState.toggleHideToolCalls;

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

  // Open the conversation in a new browser window — the "detach" affordance
  // matching the ⋮ → "Pop out to window" menu item, lifted into the header so
  // it's discoverable next to Copy link. Mirrors Stage's drag-off-to-detach so
  // both entry points land on the same /popout/conversation/<id> route — a bare
  // conversation view with no dashboard chrome (sidebar, awareness rail, etc.).
  const handleDetach = useCallback(() => {
    const params = new URLSearchParams();
    if (viewMode === 'terminal') params.set('view', 'terminal');
    const query = params.toString();
    const url = `/popout/conversation/${conversation.id}${query ? `?${query}` : ''}`;
    window.open(url, '_blank', 'popup=yes,width=920,height=1040');
  }, [conversation.id, viewMode]);

  const openHandoffDoc = useCallback(() => {
    window.open(`/api/conversations/${encodeURIComponent(conversation.name)}/handoff-doc`, '_blank', 'noopener,noreferrer');
  }, [conversation.name]);

  const openHandoffTarget = useCallback(() => {
    if (conversation.handoffTargetConvId) {
      window.location.href = `/conv/${conversation.handoffTargetConvId}`;
    }
  }, [conversation.handoffTargetConvId]);

  const showTerminal = conversation.sessionAlive || resumed;
  // Diff deep-links are transcript-oriented. If this pane was previously left in
  // terminal mode, do not mount xterm beside the diff; that opens/reopens the PTY
  // and looks like a reconnect loop when the user only asked to inspect a diff.
  const effectiveViewMode = diffOpen ? 'conversation' : viewMode;

  const isForkingHeader = !!conversation.forkStatus && conversation.forkStatus !== 'failed';
  const isForkFailedHeader = conversation.forkStatus === 'failed';
  const isSpawnFailed = !!conversation.spawnError;
  const isSpawningHeader = !conversation.sessionAlive && !conversation.endedAt && !isSpawnFailed;
  // v1.2 signal law: blue = machine activity (forking/starting/alive),
  // red = failed, neutral = ended. Amber is reserved for human-action states.
  const statusColor = isForkingHeader || isSpawningHeader
    ? 'var(--info)'
    : isForkFailedHeader || isSpawnFailed
    ? 'var(--destructive)'
    : conversation.sessionAlive
    ? 'var(--info)'
    : 'var(--muted-foreground)';
  const statusLabel = isForkingHeader ? 'forking' : isSpawningHeader ? 'starting' : isForkFailedHeader || isSpawnFailed ? 'failed' : conversation.sessionAlive ? 'active' : 'ended';
  const showPiAbort = isWorking && (conversation.harness === 'ohmypi' || conversation.harness === 'pi');
  return (
    <div className={styles.conversationTerminal}>
      {/* Header — hidden in embedded mode (ZoneB already shows session info).
          Three-tier layout: row 1 = title + primary actions, row 2 = read-only
          metadata, long-tail/config/destructive actions live in the ⋮ menu. */}
      {!embedded && (
        <div
          className={`${styles.conversationHeaderShell} ${styles.conversationHeaderContainer}`}
          onContextMenu={(e) => {
            // Right-click the header → open the ⋮ menu. Skip while renaming so
            // the native copy/paste menu still works in the title input.
            if (editingTitle) return;
            e.preventDefault();
            setMenuOpen(true);
          }}
        >
          {/* Row 1 — title + primary actions */}
          <div className={styles.conversationHeaderPrimary}>
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
                  <span className={`${styles.conversationTerminalTitleText} ${retitleMutation.isPending ? styles.titleRegenerating : ''}`}>
                    {conversation.title ?? conversation.name}
                  </span>
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

            <div className={styles.conversationHeaderActions}>
              {/* View toggle — only when session is live */}
              {showTerminal && (
                <div className={styles.viewToggle}>
                  <button
                    className={`${styles.viewToggleBtn} ${effectiveViewMode === 'conversation' ? styles.viewToggleBtnActive : ''}`}
                    onClick={() => handleViewMode('conversation')}
                  >
                    Conversation
                  </button>
                  <button
                    className={`${styles.viewToggleBtn} ${effectiveViewMode === 'terminal' ? styles.viewToggleBtnActive : ''}`}
                    onClick={() => handleViewMode('terminal')}
                  >
                    Terminal
                  </button>
                </div>
              )}

              <button
                className={`${styles.conversationAboutToggle} ${aboutOpen ? styles.conversationAboutToggleActive : ''}`}
                onClick={() => setAboutOpen(v => !v)}
                title={aboutOpen ? 'Hide conversation summary' : 'Show conversation summary'}
                aria-label={aboutOpen ? 'Hide about this conversation' : 'Show about this conversation'}
                aria-pressed={aboutOpen}
              >
                <Info size={14} />
                <span>About</span>
              </button>

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

              {showPiAbort && (
                <button
                  className={`${styles.conversationAboutToggle} ${abortMutation.isPending ? styles.conversationAboutToggleActive : ''}`}
                  onClick={() => abortMutation.mutate()}
                  disabled={abortMutation.isPending}
                  title="Stop current turn"
                  aria-label="Stop current turn"
                >
                  {abortMutation.isPending ? <Loader2 size={14} className={styles.spinnerIcon} /> : <Square size={14} />}
                  <span>{abortMutation.isPending ? 'Stopping…' : 'Stop'}</span>
                </button>
              )}

              {/* Copy link */}
              <button
                className={styles.copyLinkButton}
                onClick={handleCopyLink}
                title="Copy link to conversation"
                aria-label="Copy link to conversation"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>

              {/* Detach — open the conversation in a new browser window. Same
                  target as the ⋮ → "Pop out to window" item, exposed here so
                  the action is discoverable next to Copy link. */}
              <button
                className={styles.copyLinkButton}
                onClick={handleDetach}
                title="Detach conversation"
                aria-label="Detach conversation"
              >
                <ExternalLink size={14} />
              </button>

              {/* Overflow menu — long-tail / prefs / config / destructive */}
              <div className={styles.headerMenuWrap}>
                <button
                  className={styles.copyLinkButton}
                  onClick={() => setMenuOpen(v => !v)}
                  title="More actions"
                  aria-label="More conversation actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <MoreVertical size={16} />
                </button>
                {menuOpen && (
                  <>
                    <div className={styles.headerMenuOverlay} onClick={() => setMenuOpen(false)} />
                    <div role="menu" className={styles.headerMenu}>
                      <button
                        role="menuitem"
                        className={`${styles.headerMenuItem} ${conversation.isFavorited ? styles.headerMenuItemActive : ''}`}
                        onClick={() => { convMutations.toggleFavorite({ name: conversation.name, favorited: !!conversation.isFavorited }); setMenuOpen(false); }}
                      >
                        <Star size={14} style={{ fill: conversation.isFavorited ? 'currentColor' : 'none' }} />
                        {conversation.isFavorited ? 'Unfavorite' : 'Favorite'}
                      </button>

                      <button
                        role="menuitem"
                        className={styles.headerMenuItem}
                        onClick={() => { retitleMutation.mutate(); setMenuOpen(false); }}
                        disabled={retitleMutation.isPending}
                      >
                        {retitleMutation.isPending
                          ? <Loader2 size={14} className={styles.spinnerIcon} />
                          : <Sparkles size={14} />}
                        Regenerate title
                      </button>

                      {conversation.harness === 'claude-code' && (
                        <div className={styles.headerMenuDeliveryRow}>
                          <span>Delivery method</span>
                          <select
                            className={styles.deliveryMethodSelect}
                            value={deliveryMethod}
                            onChange={(e) => handleDeliveryMethodChange(e.target.value as 'auto' | 'channels' | 'tmux')}
                            disabled={deliveryMethodSaving}
                            title="Message delivery method"
                            aria-label="Message delivery method"
                          >
                            <option value="auto">Auto</option>
                            <option value="channels">Channels</option>
                            <option value="tmux">Tmux</option>
                          </select>
                        </div>
                      )}

                      <div className={styles.headerMenuDivider} />
                      {conversation.claudeSessionId && (
                        <button
                          role="menuitem"
                          className={styles.headerMenuItem}
                          onClick={() => { convMutations.openForkModal(conversation, { mode: 'handoff' }); setMenuOpen(false); }}
                        >
                          <Share2 size={14} />
                          Hand off to new conversation
                        </button>
                      )}
                      {conversation.claudeSessionId && conversation.harness !== 'pi' && (
                        <button
                          role="menuitem"
                          className={styles.headerMenuItem}
                          onClick={() => { convMutations.openForkModal(conversation); setMenuOpen(false); }}
                        >
                          <GitBranchPlus size={14} />
                          Create summary fork
                        </button>
                      )}
                      <button
                        role="menuitem"
                        className={styles.headerMenuItem}
                        onClick={() => { handleExportTranscript(); setMenuOpen(false); }}
                      >
                        <Download size={14} />
                        Export transcript
                      </button>

                      {(conversation.handoffDocPath || conversation.handoffTargetConvId) && (
                        <div className={styles.headerMenuDivider} />
                      )}
                      {conversation.handoffDocPath && (
                        <button
                          role="menuitem"
                          className={styles.headerMenuItem}
                          onClick={() => { openHandoffDoc(); setMenuOpen(false); }}
                        >
                          <FileText size={14} />
                          Open handoff doc
                        </button>
                      )}
                      {conversation.handoffTargetConvId && (
                        <button
                          role="menuitem"
                          className={styles.headerMenuItem}
                          onClick={() => { openHandoffTarget(); setMenuOpen(false); }}
                        >
                          <ExternalLink size={14} />
                          Open handoff target
                        </button>
                      )}

                      {(conversation.sessionAlive || onArchived) && (
                        <div className={styles.headerMenuDivider} />
                      )}
                      {conversation.sessionAlive && (
                        <button
                          role="menuitem"
                          className={styles.headerMenuItem}
                          onClick={() => { convMutations.stop(conversation.name); setMenuOpen(false); }}
                        >
                          <Square size={14} />
                          Stop agent
                        </button>
                      )}
                      {onArchived && (
                        <button
                          role="menuitem"
                          className={`${styles.headerMenuItem} ${styles.headerMenuItemDestructive}`}
                          onClick={async () => {
                            setMenuOpen(false);
                            const ok = await confirm({
                              title: conversation.isFavorited ? 'Archive favorited conversation' : 'Archive conversation',
                              message: conversation.isFavorited
                                ? `"${conversation.title ?? conversation.name}" is favorited.\n\nArchiving will remove the favorite, end the session, and move it to the archive.`
                                : `Archive "${conversation.title ?? conversation.name}"? This ends the session and moves it to the archive.`,
                              confirmLabel: 'Archive',
                              cancelLabel: 'Cancel',
                              variant: 'destructive',
                            });
                            if (ok) handleArchive();
                          }}
                        >
                          <Archive size={14} />
                          Archive conversation
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Row 2 — read-only metadata */}
          <div className={styles.conversationMetaRow}>
            <span className={styles.conversationTerminalStatus}>
              <Circle size={7} style={{ fill: statusColor, color: statusColor }} />
              {statusLabel}
            </span>
            {conversation.branch && (
              <>
                <span className={styles.conversationMetaSep} aria-hidden>·</span>
                <span
                  className={styles.terminalBranchBar}
                  title={`${conversation.isWorktree ? 'Worktree' : 'Local'} · ${conversation.cwd}`}
                >
                  {conversation.isWorktree ? <GitFork size={12} /> : <Folder size={12} />}
                  <span className={styles.terminalBranchBarMode}>
                    {conversation.isWorktree ? 'Worktree' : 'Local'}
                  </span>
                  <span className={styles.terminalBranchBarText}>{conversation.branch}</span>
                </span>
              </>
            )}
            <span className={styles.conversationMetaSep} aria-hidden>·</span>
            <PanOpenInPicker openInCwd={conversation.cwd} />
            {conversation.totalCost !== undefined && conversation.totalCost > 0 && (
              <>
                <span className={styles.conversationMetaSep} aria-hidden>·</span>
                <span className={styles.featureCost}>
                  {conversation.totalCost < 0.01 ? '<$0.01' : `$${conversation.totalCost.toFixed(2)}`}
                </span>
              </>
            )}
            <span className={styles.conversationMetaSep} aria-hidden>·</span>
            <span className={styles.conversationSessionId}>
              {conversation.sessionFile?.split('/').pop()?.replace('.jsonl', '') ?? conversation.name}
            </span>
          </div>
        </div>
      )}

      {/* "About this conversation" drawer — collapsible summary beneath the header */}
      {!embedded && aboutOpen && (
        <div className={styles.conversationAboutDrawer}>
          {aboutQuery.isLoading || refreshAboutMutation.isPending ? (
            <span className={styles.conversationAboutMuted}>
              <Loader2 size={12} className={styles.spinnerIcon} />
              Summarizing conversation…
            </span>
          ) : aboutQuery.isError ? (
            <span className={styles.conversationAboutMuted}>
              Couldn&apos;t load the conversation summary.
            </span>
          ) : aboutQuery.data?.summary ? (
            <>
              <p className={styles.conversationAboutText}>{aboutQuery.data.summary}</p>
              <div className={styles.conversationAboutMeta}>
                <span>
                  Summary of {aboutQuery.data.messageCount}{' '}
                  {aboutQuery.data.messageCount === 1 ? 'message' : 'messages'}
                </span>
                <button
                  className={styles.copyLinkButton}
                  onClick={() => refreshAboutMutation.mutate()}
                  disabled={refreshAboutMutation.isPending}
                  title="Regenerate summary"
                  aria-label="Regenerate conversation summary"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
            </>
          ) : (
            <span className={styles.conversationAboutMuted}>
              Not enough conversation yet to summarize.
            </span>
          )}
        </div>
      )}

      {/* Body — conversation + optional diff panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className={styles.conversationTerminalBody}>
          {/* Terminal: only mounted when actively viewing (xterm.js crashes with visibility:hidden) */}
          {showTerminal && effectiveViewMode === 'terminal' && (
            <XTerminal sessionName={conversation.tmuxSession} />
          )}
          {/* Conversation view — shown when in conversation mode, diff mode, or session ended */}
          {(effectiveViewMode === 'conversation' || !showTerminal) && (
            <ConversationView
              conversation={conversation}
              onResume={onEmbeddedResume ?? (!embedded && !showTerminal && !isSpawningHeader ? handleResume : undefined)}
              onArchive={!embedded ? handleArchive : undefined}
              resumePending={resumeMutation.isPending}
              resumeLabel={embeddedResumeLabel}
              onSendFailed={onSendFailed}
              roundMarkers={roundMarkers}
              roundMetadata={roundMetadata}
              turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
              onOpenTurnDiff={handleOpenTurnDiff}
              resolvedTheme={resolvedTheme}
              agentId={agentId}
              hideToolCalls={hideToolCalls}
              workingPhase={isWorking ? workingPhase : undefined}
              agentBusy={isWorking}
              streamMessagesEnabled={streamMessagesEnabled}
              messagesData={messagesData}
              messagesLoading={messagesLoading}
              targetMessageId={targetMessageId}
              targetMessageIndex={targetMessageIndex}
              targetMessageNonce={targetMessageNonce}
              onTargetMessageHandled={onTargetMessageHandled}
              modelPicker={!embedded ? (
                <ModelPicker
                  value={selectedModel}
                  harness={selectedHarness}
                  liveConversation={conversation.sessionAlive}
                  disabled={!canSwitchConversationModel}
                  onHarnessChange={(harness) => {
                    if (!canSwitchConversationModel) return;
                    setSelectedHarness(harness);
                    switchModelMutation.mutate({ model: selectedModel, harness });
                  }}
                  onChange={(modelId) => {
                    if (!canSwitchConversationModel) return;
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
              diffUrlPrefix={`/api/conversations/${encodeURIComponent(conversation.name)}/diffs`}
            />
          </DiffWorkerPoolProvider>
        )}
      </div>

      {convMutations.forkTarget && (
        <ForkModal
          conversation={convMutations.forkTarget}
          initialMode={convMutations.forkTargetMode}
          initialFocus={convMutations.forkTargetFocus}
          isPending={convMutations.isForkPending}
          onClose={convMutations.closeForkModal}
          onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness) => {
            convMutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness);
          }}
        />
      )}
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
  contextUsage?: ContextUsage | null;
  /** Server-side resolution failure to surface in the panel (e.g. the live
   * session could not be resolved from the launcher). Rendered as a banner. */
  error?: string;
}

async function fetchMessages(name: string, signal?: AbortSignal): Promise<MessagesResponse> {
  // PAN-1705: timeout + React Query's abort signal so a request in flight
  // during a server restart rejects (and retries) instead of pinning the
  // panel on "Loading…" forever, and switching conversations cancels the
  // previous conversation's fetch.
  const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(name)}/messages`, { signal });
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

interface ConversationViewProps {
  conversation: Conversation;
  onResume?: () => void;
  onArchive?: () => void;
  resumePending?: boolean;
  /** Override label for the resume button. Defaults to "Resume Session". */
  resumeLabel?: string;
  /** Called when a message POST fails. */
  onSendFailed?: () => void;
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
  /** True when the agent is currently mid-turn. */
  agentBusy?: boolean;
  /** True when the shared conversation-messages cache is fed by the WS stream. */
  streamMessagesEnabled?: boolean;
  messagesData?: MessagesResponse;
  messagesLoading?: boolean;
  targetMessageId?: string;
  targetMessageIndex?: number;
  targetMessageNonce?: number;
  onTargetMessageHandled?: () => void;
}

export type { FailedMessage } from './chat-types';

function ConversationView({ conversation, onResume, onArchive, resumePending, resumeLabel, onSendFailed: onSendFailedProp, modelPicker, roundMarkers, roundMetadata, turnDiffSummaryByAssistantMessageId, onOpenTurnDiff, resolvedTheme, agentId, hideToolCalls, workingPhase, agentBusy = false, streamMessagesEnabled, messagesData, messagesLoading, targetMessageId, targetMessageIndex, targetMessageNonce, onTargetMessageHandled }: ConversationViewProps) {
  const isCompacting = useDashboardStore((s) => s.conversationsCompactingByName?.[conversation.name] ?? false);
  // Optimistic sent messages and the failed-send retry outbox live in the
  // module-level composerStore, keyed by conversation name. ConversationView is
  // unmounted on every conversation switch (PAN-1591 renders only the active
  // pane), so component-local state would lose an in-flight optimistic message
  // and — worse — silently drop the failed-send outbox, costing the user their
  // retry. The store keeps both with the conversation they belong to.
  const optimisticMessages = useConversationOptimistic(conversation.name);
  const optimisticBaseCount = useConversationOptimisticBaseCount(conversation.name);
  const failedMessages = useConversationFailed(conversation.name);
  const addOptimistic = useComposerStore((s) => s.addOptimistic);
  const acknowledgeOptimistic = useComposerStore((s) => s.acknowledgeOptimistic);
  const clearOptimistic = useComposerStore((s) => s.clearOptimistic);
  const failSend = useComposerStore((s) => s.failSend);
  const removeFailed = useComposerStore((s) => s.removeFailed);
  const retryFailed = useComposerStore((s) => s.retryFailed);
  const queryClient = useQueryClient();

  // When forkStatus transitions from non-null to null (fork completed),
  // immediately re-fetch messages so the user doesn't see a stale empty state.
  const prevForkStatusRef = useRef(conversation.forkStatus);
  useEffect(() => {
    const prev = prevForkStatusRef.current;
    prevForkStatusRef.current = conversation.forkStatus;
    if (prev && !conversation.forkStatus) {
      queryClient.invalidateQueries({ queryKey: conversationMessagesQueryKey(conversation.name) });
    }
  }, [conversation.forkStatus, conversation.name, queryClient]);

  const data = messagesData;
  const isLoading = messagesLoading ?? false;

  const serverMessages = data?.messages ?? [];
  const workLog = data?.workLog ?? [];
  // PAN-1523: ContextWindowMeter lives in the composer toolbar (matches
  // t3code's placement). The snapshot adapter normalizes the server's
  // `ContextUsage` shape into t3code's `ContextWindowSnapshot` so future
  // upstream changes port cleanly.
  const contextWindowUsage = toContextWindowSnapshot(
    data?.contextUsage ?? conversation.contextUsage ?? null,
  );

  // Reconcile optimistic messages against what the server has actually echoed.
  // Count only USER turns added since the send baseline — an optimistic bubble is
  // "absorbed" when its real user message comes back, NOT merely when the total
  // message count grows. Counting all messages let a concurrent assistant turn
  // prematurely clear the "Sending…" bubble before the user's own message echoed,
  // so it sometimes disappeared entirely until the next poll (PAN-1591).
  const echoedUserCount = serverMessages
    .slice(optimisticBaseCount)
    .filter((m) => m.role === 'user').length;
  const absorbedCount = Math.min(optimisticMessages.length, echoedUserCount);
  const visibleOptimistic = optimisticMessages.slice(absorbedCount);
  const serverCaughtUp = optimisticMessages.length > 0 && visibleOptimistic.length === 0;
  const messages = [...serverMessages, ...visibleOptimistic];

  const handleMessageSent = useCallback((text: string) => {
    addOptimistic(conversation.name, text, serverMessages.length);
  }, [addOptimistic, conversation.name, serverMessages.length]);

  const handleMessageAcknowledged = useCallback((text: string) => {
    if (conversation.harness !== 'ohmypi' && conversation.harness !== 'pi') return;
    acknowledgeOptimistic(conversation.name, text);
  }, [acknowledgeOptimistic, conversation.harness, conversation.name]);

  // Called by ComposerFooter when POST fails — move optimistic to failed outbox.
  const handleSendFailed = useCallback((text: string) => {
    failSend(conversation.name, text);
    onSendFailedProp?.();
  }, [failSend, conversation.name, onSendFailedProp]);

  // Retry funnels through the same store action a first send uses, so the text
  // becomes an optimistic "Sending…" bubble (covered by the stall/compaction
  // safety net) instead of being removed from the outbox into the void.
  const handleRetryFailed = useCallback((failedId: string, text: string) => {
    void retryFailed(conversation.name, failedId, text, serverMessages.length, agentId);
  }, [retryFailed, conversation.name, serverMessages.length, agentId]);

  const handleDiscardFailed = useCallback((failedId: string) => {
    removeFailed(conversation.name, failedId);
  }, [removeFailed, conversation.name]);

  // Failed messages are NOT cleared on conversation switch — they persist in the
  // store keyed per-conversation so the retry outbox survives navigating away
  // and back (the whole point of moving them out of component-local state).

  // Clean up optimistic messages once the server catches up.
  useEffect(() => {
    if (serverCaughtUp) clearOptimistic(conversation.name);
  }, [serverCaughtUp, clearOptimistic, conversation.name]);

  // PAN-1635: a sent message can be silently eaten when Claude Code compacts on
  // submit (the paste+Enter races the compaction state-transition) — the prompt
  // is dropped and never echoes, leaving the optimistic bubble "Sending…" forever.
  // Detect it: a compact boundary that appeared at/after the send means the prompt
  // was eaten (surface fast); otherwise fall back to a plain stall timeout. Either
  // way, move it to the retry outbox so the user can re-send instead of waiting on
  // a response that will never come.
  useEffect(() => {
    if (visibleOptimistic.length === 0) return;
    const oldest = visibleOptimistic[0];
    const sentTs = Date.parse(oldest.createdAt || '');
    if (Number.isNaN(sentTs)) return;
    const eatenByCompaction = (data?.compactBoundaries ?? []).some((b) => {
      const bt = Date.parse(b.timestamp);
      return !Number.isNaN(bt) && bt >= sentTs;
    });
    const deadline = sentTs + (eatenByCompaction ? 20_000 : TURN_STALL_MS);
    const timer = setTimeout(
      () => failSend(conversation.name, oldest.text),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [visibleOptimistic, data?.compactBoundaries, failSend, conversation.name]);

  const isForkInProgress = !!conversation.forkStatus && conversation.forkStatus !== 'failed';
  const isForkFailed = conversation.forkStatus === 'failed';
  const isForking = isForkInProgress || isForkFailed;
  const isSpawnFailed = !!conversation.spawnError;
  // Conversation was created but the tmux session has not started yet — the spawn is running
  // in the background. Show a "Starting..." placeholder instead of the orphaned empty state.
  const isSpawning = !conversation.sessionAlive && !conversation.endedAt && !isSpawnFailed && !isForking;
  const isDiscovering = streamMessagesEnabled && data?.discovering === true && messages.length === 0;
  const isFirstMessage = !isLoading && !isDiscovering && messages.length === 0 && conversation.sessionAlive;
  const isOrphaned = !isLoading && !isDiscovering && messages.length === 0 && !conversation.sessionAlive && !isSpawnFailed && !isSpawning;

  // Spin unless truly idle: idle = last message is a completed assistant turn (completedAt set).
  // Note: `completedAt` is reliably set server-side for all terminal stop reasons via
  // `entry.timestamp || new Date().toISOString()`, so `!lastMsg.completedAt` is safe.
  const lastMsg = messages[messages.length - 1];
  // PAN-1635: an in-progress compaction keeps us working; otherwise a trailing
  // user/incomplete-assistant entry only implies "working" while it's recent, so a
  // prompt eaten by Claude's submit-time compaction can't spin the panel forever.
  const isWorking = conversation.sessionAlive && (
    isCompacting ||
    messages.length === 0 ||
    (lastActivityRecent(lastMsg) && (
      lastMsg?.role === 'user' ||
      (lastMsg?.role === 'assistant' && !lastMsg.completedAt)
    ))
  );

  const parentTitle = conversation.title?.replace(/^Summary Fork:\s*/, '') || undefined;

  // Derive round markers from roundMetadata + messages for reviewer sessions (PAN-830 high-8, PAN-847 pan-0h5k).
  const derivedRoundMarkers = useMemo(() => {
    const derived = deriveRoundMarkers(roundMetadata, messages);
    return derived.length > 0 ? derived : (roundMarkers ?? []);
  }, [roundMetadata, messages, roundMarkers]);

  return (
    <div className={styles.conversationView}>
      {isLoading || isDiscovering ? (
        <div className={styles.conversationConnecting}>
          <span>{isDiscovering ? 'Discovering conversation…' : 'Loading…'}</span>
        </div>
      ) : data?.error ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateTitle} style={{ color: 'var(--warning)' }}>
            ⚠ Session could not be resolved
          </p>
          <p className={styles.conversationEmptyStateSubtitle}>{data.error}</p>
        </div>
      ) : isSpawning ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateTitle}>
            <Loader2 size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6, animation: 'spin 1s linear infinite' }} />
            Starting…
          </p>
          <p className={styles.conversationEmptyStateSubtitle}>Waiting for the session to start.</p>
        </div>
      ) : isSpawnFailed ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateTitle}>Failed to start</p>
          <p className={styles.conversationEmptyStateSubtitle}>{conversation.spawnError}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className={styles.conversationArchiveBtnLarge} onClick={() => onArchive?.()}>
              Archive
            </button>
          </div>
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
                  {resumePending ? 'Resuming…' : (resumeLabel ?? 'Resume Session')}
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
          cwd={conversation.cwd}
          issueId={conversation.issueId}
          turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
          onOpenTurnDiff={onOpenTurnDiff}
          resolvedTheme={resolvedTheme}
          hideToolCalls={hideToolCalls}
          workingPhase={workingPhase}
          targetMessageId={targetMessageId}
          targetMessageIndex={targetMessageIndex}
          targetMessageNonce={targetMessageNonce}
          onTargetMessageHandled={onTargetMessageHandled}
        />
      )}
      {/* PAN-1458: when this conversation was cleared via Claude Code's /clear, show a
          banner linking to the sibling that continues the work. The composer/resume bar
          is suppressed because the conversation is permanently ended — interacting here
          would either fail or branch off historical content. */}
      {conversation.clearedToConvId ? (
        <button
          type="button"
          className={styles.conversationClearedBanner}
          onClick={() => { window.location.href = `/conv/${conversation.clearedToConvId}`; }}
          title={`Open conv/${conversation.clearedToConvId}`}
          aria-label={`Open conversation that continues after /clear (conv/${conversation.clearedToConvId})`}
        >
          <RotateCcw size={14} />
          <span className={styles.conversationClearedBannerText}>
            Conversation cleared — continued in <strong>conv/{conversation.clearedToConvId}</strong>
          </span>
          <ArrowRight size={14} />
        </button>
      ) : isForking ? null : onResume ? (
        <div className={styles.conversationResumeBar}>
          {modelPicker}
          <button
            className={styles.conversationResumeBtn}
            onClick={onResume}
            disabled={resumePending}
          >
            {resumePending ? 'Resuming…' : (resumeLabel ?? 'Resume Session')}
          </button>
        </div>
      ) : (
        <ComposerFooter
          conversation={conversation}
          onSend={handleMessageSent}
          onSendAcknowledged={handleMessageAcknowledged}
          onSendFailed={handleSendFailed}
          agentId={agentId}
          contextWindowUsage={contextWindowUsage}
          agentBusy={agentBusy}
        />
      )}
    </div>
  );
}
