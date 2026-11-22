import { useComposerEchoes } from './useComposerEchoes';
import { inputTargetNotice } from '../../lib/subagentRouting';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { toastResumeOutcome } from '../../lib/resumeOutcome';
import { useDashboardStore } from '../../lib/store';
import { useConversationUiState } from '../../hooks/useConversationUiState';
import { markTerminalClick, useNeedsTerminalAutoSwitch, type ViewMode } from './useNeedsTerminalAutoSwitch';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Terminal, FileCode, Search, Globe, Wrench, Zap, RotateCcw, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { ConversationTerminalView } from './ConversationTerminalView';
import { ConversationAboutDrawer } from './ConversationAboutDrawer';
import type { Conversation } from '../CommandDeck/ConversationList';
import { MessagesTimeline, type RoundMarker } from './MessagesTimeline';
import { ComposerFooter } from './ComposerFooter';
import { ConversationResumeControls } from './ConversationResumeControls';
import { useStableComposerProps } from './useStableComposerProps';
import { useConversationPaneChoice } from '../../lib/useConversationPaneChoice';
import { ModelPicker, saveStoredHarness, saveStoredModel, type Harness } from './ModelPicker';
import { resumeConversation } from './conversationResumeApi';
import { getDefaultConversationModel } from './defaultConversationModel';
import {
  useComposerStore,
} from '../../lib/composerStore';
import { getWorkingPhase, getPhaseLabel, getPendingToolEntry, isSpinnerPhase, isConversationWorking, type WorkingPhase } from '../../lib/workingPhase';
import { deriveRoundMarkers } from '../../lib/deriveRoundMarkers';
import { getHarnessBehavior, type ReviewerRoundMetadata } from '@overdeck/contracts';
import { acceptsInput, ConversationMachineBanner, conversationHeaderStatus, conversationMachineState } from './ConversationMachineBanner';
import { PendingAgentRequestCards } from './PendingAgentRequestCard';
import { ConversationHeader } from './header/ConversationHeader';
import { ConversationPullRequestProvider } from './TranscriptPullRequestLink';
import { ConversationBookmarksProvider } from './bookmarks/ConversationBookmarks';
import { ConversationChangesScope, useConversationChangesContext } from './conversationChanges/ConversationChangesScope';
import { turnChangesByAnchor } from './messagesTimeline/turnChanges';
import { BookmarksDrawer } from './bookmarks/BookmarksDrawer';
import { isNativeShell } from '../../lib/nativeShell';
import { useConversationMutations } from '../CommandDeck/useConversationMutations';
import { ForkModal } from '../CommandDeck/ForkModal';
import { AddSkillsModal } from '../CommandDeck/AddSkillsModal';
import { conversationMessagesQueryKey, useConversationMessagesStream } from './useConversationMessagesStream';
import { buildMessagesQueryFn, type MessagesResponse } from './messagesQuery';
import { useOlderHistory } from './useOlderHistory';
import { ToolBodyLoaderContext, toolBodyLoaderFor } from './messagesTimeline/toolBodyLoader';
import { useMessagesHttpFallback } from './useMessagesHttpFallback';
import { SubagentRail, updateSelectedSubagent, useSubagentSelection } from './SubagentRail';
import { SubagentTranscript } from './SubagentTranscript';
import { ForkProgressView } from './ForkProgressView';
import { HeldHandoffView, HeldKickoffLookupFailedView } from './HeldHandoffView';
import { useHeldKickoff } from './heldKickoff';
import { scheduledToChatMessages, useScheduledMessages } from './scheduledMessages';
import { TranscriptLoadingSkeleton } from './TranscriptLoadingSkeleton';
import { useComposerDeliveryState } from './useComposerDeliveryState';
import styles from '../CommandDeck/styles/command-deck.module.css';

// PAN-1635: a turn that has shown no transcript progress for this long is
// stalled, not working. Covers a slow compaction + response (a Claude-native
// /compact here ran ~128s before any follow-up); finite so a prompt that was
// eaten by submit-time compaction can't strand the spinner forever.
// Now lives in lib/workingPhase.ts alongside isConversationWorking (PAN-3770).
/**
 * How long a conversation row may show "Starting…" without a live session.
 * Genuine spawns are seconds-to-a-couple-minutes; anything older with no
 * session and no endedAt is an interrupted row (reboot/crash), not a
 * spawn-in-flight. The lifecycle poller eventually stamps endedAt — on the
 * 2026-08-05 post-reboot boot it took 5.4 minutes, and for that whole window
 * day-old conversations rendered "Starting…" while their transcripts sat on
 * disk. The spawn window keeps the placeholder for real spawns only.
 */
const SPAWN_PLACEHOLDER_MAX_AGE_MS = 10 * 60 * 1000;
function isWithinSpawnWindow(createdAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!createdAt) return false;
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && nowMs - createdMs < SPAWN_PLACEHOLDER_MAX_AGE_MS;
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

export type { ViewMode } from './useNeedsTerminalAutoSwitch';

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
  /** Suppress header and built-in actions when a parent owns that chrome. */
  embedded?: boolean;
  /** Agent ID for fetching turn diffs. Omit to skip diff display. */
  agentId?: string;
  /** Message target requested by palette conversation search. */
  targetMessageId?: string;
  targetMessageIndex?: number;
  targetMessageNonce?: number;
  onTargetMessageHandled?: () => void;
  /** Bare subagent id whose transcript the message target points into (PAN-3982). */
  targetSubagentId?: string;
  /** Controlled tool-call visibility for embedded agent panes. */
  hideToolCalls?: boolean;
  onToggleHideToolCalls?: () => void;
  /** Custom embedded resume action and label. */
  onEmbeddedResume?: () => void;
  embeddedResumeLabel?: string;
  /** Hide the composer when the parent renders its own input. */
  hideComposer?: boolean;
  /** Called when a message POST fails. */
  onSendFailed?: () => void;
  /** Passed through to SubagentRail — starts the rail at this collapsed state instead of localStorage (PAN-4222). */
  subagentRailCollapsed?: boolean;
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
  targetSubagentId,
  hideToolCalls: controlledHideToolCalls,
  onToggleHideToolCalls,
  onEmbeddedResume,
  embeddedResumeLabel,
  hideComposer = false,
  onSendFailed,
  subagentRailCollapsed,
}: ConversationPanelProps) {
  // Resume-click latch: bridges the gap between a successful resume POST and
  // the conversations poll reporting the session alive (up to one poll tick).
  // Spent as soon as the server confirms the session — alive, or endedAt
  // stamped because the resumed session died again — so a twice-stopped
  // conversation gets its resume bar back instead of a read-only composer.
  const [resumedAwaitingConfirm, setResumedAwaitingConfirm] = useState(false);
  const [sendResumeContract, setSendResumeContract] = useState(true);
  // Self-hosted mutations + ForkModal so the header can favorite / stop / hand
  // off / fork without threading callbacks through every embed site.
  const convMutations = useConversationMutations(conversation.name, () => {});
  const [selectedModel, setSelectedModel] = useState<string>(() => conversation.model || getDefaultConversationModel());
  // See ComposerFooter for rationale — never seed an existing conversation's
  // harness from the global localStorage default.
  const [selectedHarness, setSelectedHarness] = useState<Harness>(() => conversation.harness ?? 'claude-code');
  const queryClient = useQueryClient();
  const messagesQueryKey = useMemo(() => conversationMessagesQueryKey(conversation.name), [conversation.name]);
  const { enabled: streamMessagesEnabled, receivedFirstPayload } = useConversationMessagesStream(conversation);
  const httpFallbackDue = useMessagesHttpFallback(streamMessagesEnabled, receivedFirstPayload, conversation.name);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Bumped by the header's ⋯ → Subagents item; SubagentRail flips on each change (PAN-5291 D1-6).
  const [railToggle, setRailToggle] = useState(0);

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
      setSelectedHarness(conversation.harness);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.harness]);

  // The resume latch is spent once the poll confirms the resumed session came
  // alive. Clearing on endedAt instead would let a stale pre-resume row
  // (still carrying the previous death's endedAt) kill the bridge during the
  // click→poll window. Without this effect, a session that stopped a second
  // time left `showTerminal` — and with it the composer-vs-resume-bar choice
  // — pinned until a full browser refresh.
  useEffect(() => {
    if (resumedAwaitingConfirm && conversation.sessionAlive) {
      setResumedAwaitingConfirm(false);
    }
  }, [resumedAwaitingConfirm, conversation.sessionAlive]);

  // A ConversationPanel instance can be reused for a different conversation
  // (drawer / flywheel embeds switch the row in place) — never carry a resume
  // latch across conversations.
  useEffect(() => {
    setResumedAwaitingConfirm(false);
  }, [conversation.name]);

  // Query messages at this level so we can drive the header working-spinner.
  // Live transcripts are pushed through WS/RPC. HTTP is a fallback for the
  // initial snapshot (only after MESSAGES_HTTP_FALLBACK_MS without a stream
  // payload) and is the sole read path for stopped history.
  const messagesQueryFn = useMemo(
    () => buildMessagesQueryFn(queryClient, messagesQueryKey, conversation.name, agentId),
    [conversation.name, agentId, queryClient, messagesQueryKey],
  );
  const refreshMessagesOverHttp = useCallback(() => {
    // staleTime: 0 forces the refetch past the app's default 30s staleTime, since
    // fetchQuery otherwise returns fresh cached data without calling queryFn.
    void queryClient.fetchQuery({ queryKey: messagesQueryKey, queryFn: messagesQueryFn, staleTime: 0 }).catch(() => {});
  }, [queryClient, messagesQueryKey, messagesQueryFn]);
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: messagesQueryKey,
    queryFn: messagesQueryFn,
    enabled: !streamMessagesEnabled || Boolean(agentId) || httpFallbackDue,
    refetchInterval: streamMessagesEnabled || agentId ? false : (conversation.sessionAlive ? 2000 : false),
  });
  // PAN-2876 — the rail lists the main agent plus every subagent; picking a subagent swaps the body to its transcript.
  const subagents = messagesData?.subagents ?? [];
  const { selectedAgentId: selectedSubagentId, selectedSubagent, clearSelection: clearSubagent } = useSubagentSelection(subagents);
  // PAN-3982: a palette hit on a subagent transcript opens the parent pane with
  // targetSubagentId; select that subagent once the rail lists it, once per open.
  const appliedSubagentTargetRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!targetSubagentId || targetMessageNonce === undefined) return;
    if (appliedSubagentTargetRef.current === targetMessageNonce) return;
    if (!subagents.some((subagent) => subagent.agentId === targetSubagentId)) return;
    appliedSubagentTargetRef.current = targetMessageNonce;
    if (selectedSubagentId !== targetSubagentId) updateSelectedSubagent(targetSubagentId);
  }, [targetSubagentId, targetMessageNonce, subagents, selectedSubagentId]);
  // The main timeline must never consume a subagent's target, and the subagent
  // transcript only takes it once its row is the selected one.
  const mainTarget = targetSubagentId === undefined;
  const subagentTarget = targetSubagentId !== undefined && selectedSubagentId === targetSubagentId;
  const headerMessages = messagesData?.messages ?? [];
  const headerWorkLog = messagesData?.workLog ?? [];
  const canSwitchConversationModel =
    !agentId &&
    !conversation.sessionAlive &&
    !conversation.claudeSessionId &&
    headerMessages.length === 0;
  // Spin unless truly idle. Message shape (trailing user / incomplete
  // assistant) plus, for harnesses that append complete messages mid-turn
  // (Codex narrates before tool runs), recent work-log activity newer than
  // the last message. PAN-3770; recency guards per PAN-1635.
  const isWorking = isConversationWorking(
    conversation.sessionAlive,
    messagesData == null ? [] : headerMessages,
    headerWorkLog,
  );
  const workingPhase = isWorking ? getWorkingPhase(headerMessages, headerWorkLog) : 'thinking';
  const pendingEntry = isWorking ? getPendingToolEntry(headerWorkLog) : undefined;
  const workingLabel = getPhaseLabel(workingPhase, pendingEntry);
  const WorkingIcon = PHASE_ICONS[workingPhase];
  const workingIconClass = isSpinnerPhase(workingPhase) ? styles.spinnerIcon : styles.pulseIcon;

  const resumeMutation = useMutation({
    mutationFn: () => resumeConversation(
      conversation.name,
      selectedModel,
      conversation.effort ?? undefined,
      selectedHarness,
      sendResumeContract,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      refreshMessagesOverHttp();
      // PAN-2975: the resume bar reports the actual outcome too. The latch is
      // only a bridge until the poll confirms the session — see the
      // resumedAwaitingConfirm clear effect below.
      toastResumeOutcome(conversation.name);
      setResumedAwaitingConfirm(true);
    },
    // A failed resume must say so; without this the button did nothing visible.
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const switchModelMutation = useMutation({
    mutationFn: ({ model, harness }: { model: string; harness: Harness }) => {
      if (agentId) throw new Error('Agent models are locked after spawn');
      return fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/switch-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, harness }),
      }).then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || `Failed to switch model (${r.status})`);
        }
        return r.json();
      });
    },
    onSuccess: (_, { model, harness }) => {
      saveStoredModel(model);
      saveStoredHarness(harness);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      refreshMessagesOverHttp();
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

  const handleResume = useCallback(() => {
    resumeMutation.mutate();
  }, [resumeMutation]);

  const archivePending = convMutations.isArchivePending(conversation.name);
  const native = isNativeShell(); // The phone app (PAN-4837): hide what its phone token cannot do.
  const handleArchive = useCallback(() => {
    convMutations.archive(conversation.name, { onSuccess: onArchived });
  }, [convMutations, conversation.name, onArchived]);

  const handleViewMode = useCallback((mode: ViewMode) => {
    if (mode === 'terminal') markTerminalClick(conversation.name);
    onViewModeChange?.(mode);
  }, [onViewModeChange, conversation.name]);

  // Per-conversation UI state (client-only, localStorage). Embedded agent
  // panes pass controlled props from their own header toggle; when absent
  // (standalone conversation view) the internal hook is authoritative.
  const uiToolState = useConversationUiState(conversation.name);
  const hideToolCalls = controlledHideToolCalls ?? uiToolState.hideToolCalls;
  const toggleHideToolCalls = onToggleHideToolCalls ?? uiToolState.toggleHideToolCalls;

  const showTerminal = conversation.sessionAlive || resumedAwaitingConfirm;
  useNeedsTerminalAutoSwitch(!!conversation.needsTerminal && showTerminal, viewMode, onViewModeChange);

  const isForkingHeader = !!conversation.forkStatus && conversation.forkStatus !== 'failed';
  const isForkFailedHeader = conversation.forkStatus === 'failed';
  const isSpawnFailed = !!conversation.spawnError;
  const isSpawningHeader = !conversation.sessionAlive && !conversation.endedAt && !isSpawnFailed && isWithinSpawnWindow(conversation.createdAt);
  const { color: statusColor, label: statusLabel, hollow: statusHollow } = conversationHeaderStatus(conversation, { forking: isForkingHeader, spawning: isSpawningHeader, failed: isForkFailedHeader || isSpawnFailed });
  const machineState = conversationMachineState(conversation); // PAN-4650: which machine runs it (D-6 title bar states)
  return (
    <ConversationPullRequestProvider conversation={conversation}><ConversationBookmarksProvider conversationName={conversation.name}><ConversationChangesScope conversation={conversation}><div className={styles.conversationTerminal}>
      {!embedded && (
        <ConversationHeader
          conversation={conversation} agentId={agentId}
          viewMode={viewMode} effectiveViewMode={viewMode} onViewMode={handleViewMode}
          showTerminal={showTerminal} isWorking={isWorking}
          working={{ label: workingLabel, Icon: WorkingIcon, iconClass: workingIconClass }}
          status={{ color: statusColor, label: statusLabel, hollow: statusHollow }}
          machineState={machineState}
          aboutOpen={aboutOpen} onToggleAbout={() => setAboutOpen(v => !v)}
          hideToolCalls={hideToolCalls} onToggleHideToolCalls={toggleHideToolCalls}
          convMutations={convMutations} archivePending={archivePending}
          onArchive={onArchived ? handleArchive : undefined}
          subagentCount={subagents.length}
          onToggleSubagents={() => setRailToggle(n => n + 1)}
        />
      )}
      {!embedded && <ConversationMachineBanner conversation={conversation} />}
      <PendingAgentRequestCards owner={{ kind: 'conversation', name: conversation.name }} />

      {/* "About this conversation" drawer — collapsible summary beneath the header */}
      {!embedded && aboutOpen && (
        <ConversationAboutDrawer
          loading={aboutQuery.isLoading || refreshAboutMutation.isPending}
          error={aboutQuery.isError}
          summary={aboutQuery.data?.summary ?? null}
          messageCount={aboutQuery.data?.messageCount ?? 0}
          refreshing={refreshAboutMutation.isPending}
          onRefresh={() => refreshAboutMutation.mutate()}
        />
      )}

      {!embedded && <BookmarksDrawer />}

      <div data-testid="conversation-pane-row" className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className={styles.conversationTerminalBody}>
          {showTerminal && viewMode === 'terminal' && (
            <ConversationTerminalView conversation={conversation} />
          )}
          {(viewMode === 'conversation' || !showTerminal) && (selectedSubagent ? (
            <SubagentTranscript
              conversation={conversation}
              subagent={selectedSubagent}
              onBack={clearSubagent}
              targetMessageId={subagentTarget ? targetMessageId : undefined}
              targetMessageIndex={subagentTarget ? targetMessageIndex : undefined}
              targetMessageNonce={subagentTarget ? targetMessageNonce : undefined}
              onTargetMessageHandled={subagentTarget ? onTargetMessageHandled : undefined}
            />
          ) : (
            <ConversationView
              conversation={conversation}
              onResume={!acceptsInput(conversation) ? undefined : onEmbeddedResume ?? (!embedded && !showTerminal && !isSpawningHeader ? handleResume : undefined)}
              onArchive={!embedded && !native ? handleArchive : undefined}
              archivePending={archivePending}
              resumePending={resumeMutation.isPending}
              resumeLabel={embeddedResumeLabel}
              sendResumeContract={onEmbeddedResume ? undefined : sendResumeContract}
              onSendResumeContractChange={onEmbeddedResume ? undefined : setSendResumeContract}
              hideComposer={hideComposer}
              onSendFailed={onSendFailed}
              roundMarkers={roundMarkers}
              roundMetadata={roundMetadata}
              agentId={agentId}
              hideToolCalls={hideToolCalls}
              workingPhase={isWorking ? workingPhase : undefined}
              agentBusy={isWorking}
              streamMessagesEnabled={streamMessagesEnabled}
              receivedFirstPayload={receivedFirstPayload}
              refreshMessagesOverHttp={refreshMessagesOverHttp}
              messagesData={messagesData}
              messagesLoading={messagesLoading}
              onOpenTerminal={showTerminal ? () => handleViewMode('terminal') : undefined}
              targetMessageId={mainTarget ? targetMessageId : undefined}
              targetMessageIndex={mainTarget ? targetMessageIndex : undefined}
              targetMessageNonce={mainTarget ? targetMessageNonce : undefined}
              onTargetMessageHandled={mainTarget ? onTargetMessageHandled : undefined}
              modelPicker={!embedded && !native ? (
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
          ))}
        </div>
        <SubagentRail
          conversation={conversation}
          subagents={subagents}
          selectedAgentId={selectedSubagentId}
          defaultCollapsed={subagentRailCollapsed}
          toggleSignal={railToggle}
        />
      </div>

      {convMutations.forkTarget && (
        <ForkModal
          conversation={convMutations.forkTarget}
          initialMode={convMutations.forkTargetMode}
          initialFocus={convMutations.forkTargetFocus}
          isPending={convMutations.isForkPending}
          onClose={convMutations.closeForkModal}
          onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey) => {
            convMutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey);
          }}
        />
      )}
      {convMutations.addSkillsTarget && (
        <AddSkillsModal conversation={convMutations.addSkillsTarget} onClose={convMutations.closeAddSkillsModal} />
      )}
    </div></ConversationChangesScope></ConversationBookmarksProvider></ConversationPullRequestProvider>
  );
}

// ─── ConversationView ─────────────────────────────────────────────────────────

interface ConversationViewProps {
  conversation: Conversation;
  onResume?: () => void;
  onArchive?: () => void;
  archivePending?: boolean;
  resumePending?: boolean;
  /** Override label for the resume button. Defaults to "Resume Session". */
  resumeLabel?: string;
  /** Whether to send the resume context message after the runtime starts. */
  sendResumeContract?: boolean;
  onSendResumeContractChange?: (send: boolean) => void;
  /** Hide the composer — the parent renders its own way to talk to the agent. */
  hideComposer?: boolean;
  /** Called when a message POST fails. */
  onSendFailed?: () => void;
  /** ModelPicker component to render next to the Resume button */
  modelPicker?: React.ReactNode;
  /** Optional round-divider markers forwarded to the MessagesTimeline. */
  roundMarkers?: ReadonlyArray<RoundMarker>;
  /** Reviewer round metadata to derive timeline dividers (PAN-830 high-8). */
  roundMetadata?: ReviewerRoundMetadata;
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
  /** True after the current conversation's WS subscription emits its first event. */
  receivedFirstPayload?: boolean;
  /** Re-fetches messages over HTTP through the shared queryFn (PAN-4312). */
  refreshMessagesOverHttp?: () => void;
  messagesData?: MessagesResponse;
  /** PAN-3113 — switch the panel to terminal mode (pane choice card). */
  onOpenTerminal?: () => void;
  messagesLoading?: boolean;
  targetMessageId?: string;
  targetMessageIndex?: number;
  targetMessageNonce?: number;
  onTargetMessageHandled?: () => void;
}

export type { FailedMessage } from './chat-types';

function ConversationView({ conversation, onResume, onArchive, archivePending = false, resumePending, resumeLabel, sendResumeContract, onSendResumeContractChange, hideComposer = false, onSendFailed: onSendFailedProp, modelPicker, roundMarkers, roundMetadata, agentId, hideToolCalls, workingPhase, agentBusy = false, streamMessagesEnabled = false, receivedFirstPayload = false, refreshMessagesOverHttp, messagesData, messagesLoading, onOpenTerminal, targetMessageId, targetMessageIndex, targetMessageNonce, onTargetMessageHandled }: ConversationViewProps) {
  const isCompacting = useDashboardStore((s) => s.conversationsCompactingByName?.[conversation.name] ?? false);
  // PAN-5295 D2-5: one turn card per user turn, from the server messages (never
  // optimistic echoes) and the panel's shared changes query.
  const changesContext = useConversationChangesContext();
  const changes = changesContext?.changes ?? null;
  const turnMessages = messagesData?.messages;
  const turnCards = useMemo(() => turnChangesByAnchor(turnMessages ?? [], changes), [turnMessages, changes]);
  // Keep optimistic messages and failed-send retries in the conversation-keyed
  // composer store so switching panes cannot discard them (PAN-1591).
  const addOptimistic = useComposerStore((s) => s.addOptimistic);
  const acknowledgeOptimistic = useComposerStore((s) => s.acknowledgeOptimistic);
  const queryClient = useQueryClient();
  // PAN-4558: the transcript opens on its newest window; older rows page in on scroll.
  const olderHistory = useOlderHistory({
    queryKey: conversationMessagesQueryKey(conversation.name),
    pagePath: agentId
      ? `/api/agents/${encodeURIComponent(agentId)}/conversation`
      : `/api/conversations/${encodeURIComponent(conversation.name)}/messages`,
    history: messagesData?.history,
  });
  const toolBodyLoader = useMemo(() => toolBodyLoaderFor(agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/conversation/tool-body`
    : `/api/conversations/${encodeURIComponent(conversation.name)}/tool-body`), [agentId, conversation.name]);

  // When forkStatus transitions from non-null to null (fork completed),
  // immediately re-fetch messages so the user doesn't see a stale empty state.
  const prevForkStatusRef = useRef(conversation.forkStatus);
  useEffect(() => {
    const prev = prevForkStatusRef.current;
    prevForkStatusRef.current = conversation.forkStatus;
    if (prev && !conversation.forkStatus) {
      refreshMessagesOverHttp?.();
    }
  }, [conversation.forkStatus, conversation.name, refreshMessagesOverHttp]);

  const data = messagesData;
  const isLoading = messagesLoading ?? false;
  const subagentByToolUseId = useMemo(() => new Map((data?.subagents ?? []).map((subagent) => [subagent.toolUseId, subagent])), [data?.subagents]);
  const handleOpenSubagent = useCallback((toolUseId: string) => { const subagent = subagentByToolUseId.get(toolUseId); if (subagent) updateSelectedSubagent(subagent.agentId); }, [subagentByToolUseId]);

  // PAN-3113 — blocking pane choice plus mount-local dashboard answers.
  const { livePaneChoice, answeredPaneChoices, handlePaneChoiceAnswered } =
    useConversationPaneChoice(conversation.name, agentId);

  const serverMessages = data?.messages ?? [];
  const workLog = data?.workLog ?? [];
  const {
    commandResults,
    failedMessages,
    handleConfirmCommand,
    handleDiscardFailed,
    handleRetryFailed,
    handleSendFailed,
  } = useComposerDeliveryState({
    conversation,
    agentId,
    serverBaseCount: serverMessages.length,
    serverMessageIds: serverMessages.map((message) => message.id),
    onSendFailed: onSendFailedProp,
  });
  const { onSend: handleMessageSent, contextWindowUsage } = useStableComposerProps({ conversation, data, serverMessages, addOptimistic });

  const visibleOptimistic = useComposerEchoes(conversation.name, serverMessages, data?.subagents ?? [], data?.streaming ?? false);
  const scheduled = useScheduledMessages(conversation.name, !agentId);
  const messages = [...serverMessages, ...visibleOptimistic, ...scheduledToChatMessages(scheduled.messages), ...commandResults];

  // PAN-4268: only Claude Code's agent selector says where typed input goes.
  // Agent-backed panels carry no inputTarget; their sends still switch.
  const subagentNotice = useMemo(
    () => (agentId ? null : inputTargetNotice(conversation.inputTarget)),
    [agentId, conversation.inputTarget],
  );

  const handleMessageAcknowledged = useCallback((text: string, clientMessageId?: string) => {
    acknowledgeOptimistic(conversation.name, text, clientMessageId);
    // The send may have switched the selector back to main (PAN-4268).
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }, [acknowledgeOptimistic, conversation.name, queryClient]);

  const isForkInProgress = !!conversation.forkStatus && conversation.forkStatus !== 'failed';
  const isForkFailed = conversation.forkStatus === 'failed';
  const isForking = isForkInProgress || isForkFailed;
  const isSpawnFailed = !!conversation.spawnError;
  // PAN-3744: before this subscription emits, the transcript is loading rather
  // than empty. Keep this signal hook-local because query-cache entries survive
  // conversation switches and could flash a stale empty state.
  const awaitingFirstPayload = streamMessagesEnabled && !receivedFirstPayload && messages.length === 0 && !data?.error;
  const isDiscovering = streamMessagesEnabled && data?.discovering === true && messages.length === 0;
  // Zero chat messages ≠ zero activity for agent sessions (PAN-3544). Since
  // the CLIProxy 7.2 upgrade (2026-08-03) GPT-harness sessions emit only
  // thinking/tool_use blocks — no assistant text blocks — and every user entry
  // in a work-agent transcript is a filtered hook injection, so the workLog
  // carries the entire visible timeline. Gating the empty states on messages
  // alone rendered "How can I help you?" over a live agent 250 tool calls deep
  // (agent-pan-3511, 2026-08-04).
  const hasTimelineActivity = messages.length > 0 || workLog.length > 0;
  // Conversation was created but the tmux session has not started yet — the spawn is running
  // in the background. Show a "Starting..." placeholder instead of the orphaned empty state —
  // but ONLY while the row is genuinely new and has no transcript content. After a reboot or
  // crash the tmux session is gone and endedAt stays null until the lifecycle poller notices
  // (5.4 min on the 2026-08-05 boot), and for that whole window a day-old conversation showed
  // "Starting…" while its transcript sat on disk. Past the spawn window, or with any transcript
  // content parsed, the row is interrupted, not starting.
  const isSpawning = !conversation.sessionAlive && !conversation.endedAt && !isSpawnFailed && !isForking
    && isWithinSpawnWindow(conversation.createdAt) && !hasTimelineActivity;
  // PAN-4596: an ended empty conversation may be a --hold successor whose kickoff was
  // never sent. Until the kickoff lookup answers { held: false } it is not orphaned.
  const heldKickoff = useHeldKickoff(conversation.name, { enabled: !conversation.sessionAlive && !hasTimelineActivity, pollAlways: true });
  const heldLookupOpen = data != null && !data.error && !conversation.sessionAlive && !hasTimelineActivity
    && !isSpawning && !isSpawnFailed && !isForkInProgress;
  const heldLookupPending = heldLookupOpen && heldKickoff.status === 'loading';
  const heldLookupFailed = heldLookupOpen && heldKickoff.status === 'error';
  const isHeldUnsent = heldLookupOpen && heldKickoff.held && heldKickoff.text !== undefined;
  // After Start, show "Starting…" until the server moves forkStatus off its value at
  // Start time, the session comes up, or a failed start restores the hold. Once seen,
  // the start is spent: a later null forkStatus or session end must not revive it.
  const [kickoffStartedFrom, setKickoffStartedFrom] = useState<{ name: string; forkStatus: string | null } | null>(null);
  const kickoffStartSeen = !kickoffStartedFrom || kickoffStartedFrom.name !== conversation.name
    || kickoffStartedFrom.forkStatus !== (conversation.forkStatus ?? null) || conversation.sessionAlive;
  const kickoffStartPending = !kickoffStartSeen && !(isForkFailed && heldKickoff.held) && !hasTimelineActivity;
  useEffect(() => { if (kickoffStartedFrom && kickoffStartSeen) setKickoffStartedFrom(null); }, [kickoffStartedFrom, kickoffStartSeen]);
  useEffect(() => { if (heldKickoff.held) setKickoffStartedFrom(null); }, [heldKickoff.held]);
  // The door restores the hold before it marks the fork failed: re-read it at once.
  useEffect(() => { if (isForkFailed) heldKickoff.refresh(); }, [isForkFailed, heldKickoff.refresh]);
  const isFirstMessage = !isLoading && !isDiscovering && !awaitingFirstPayload && !hasTimelineActivity && failedMessages.length === 0 && conversation.sessionAlive;
  // A failed /messages fetch leaves `data` undefined — that is NOT the same as a
  // successful empty response. Rendering it as "no saved history" (the old
  // behavior) falsely tells the user their history is gone, e.g. during a
  // server-restart window (2026-07-05 incident). Ended conversations have no
  // refetchInterval, so without a retry surface the error state would persist.
  const messagesFetchFailed =
    !isLoading && !isDiscovering && !awaitingFirstPayload && !streamMessagesEnabled && data == null &&
    !isSpawning && !isSpawnFailed && !isForking;
  const isOrphaned = !isLoading && !isDiscovering && !awaitingFirstPayload && data != null && !hasTimelineActivity && !conversation.sessionAlive && !isSpawnFailed && !isSpawning
    && !heldLookupPending && !heldLookupFailed && !isHeldUnsent && !kickoffStartPending;

  // Spin unless truly idle: idle = last message is a completed assistant turn (completedAt set).
  // Note: `completedAt` is reliably set server-side for all terminal stop reasons via
  // `entry.timestamp || new Date().toISOString()`, so `!lastMsg.completedAt` is safe.
  // PAN-1635: an in-progress compaction keeps us working; otherwise the shared
  // helper applies message shape plus the Codex-style work-log gap signal
  // (recent tool activity newer than the last completed message, PAN-3770).
  const isWorking = isCompacting || isConversationWorking(
    conversation.sessionAlive,
    messages,
    workLog,
  );

  const parentTitle = conversation.title?.replace(/^Summary Fork:\s*/, '') || undefined;

  // Derive round markers from roundMetadata + messages for reviewer sessions (PAN-830 high-8, PAN-847 pan-0h5k).
  const derivedRoundMarkers = useMemo(() => {
    const derived = deriveRoundMarkers(roundMetadata, messages);
    return derived.length > 0 ? derived : (roundMarkers ?? []);
  }, [roundMetadata, messages, roundMarkers]);

  return (
    <div className={styles.conversationView}>
      {isLoading || isDiscovering || awaitingFirstPayload || heldLookupPending ? (
        <TranscriptLoadingSkeleton discovering={isDiscovering} />
      ) : data?.error ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateTitle} style={{ color: 'var(--warning)' }}>
            ⚠ Session could not be resolved
          </p>
          <p className={styles.conversationEmptyStateSubtitle}>
            {data.error}{data.checked && data.checked.length > 0 ? ` Checked: ${data.checked.join(', ')}` : ''}
          </p>
        </div>
      ) : messagesFetchFailed ? (
        <div className={styles.conversationEmptyState}>
          <p className={styles.conversationEmptyStateTitle} style={{ color: 'var(--warning)' }}>
            ⚠ Couldn&apos;t load history
          </p>
          <p className={styles.conversationEmptyStateSubtitle}>
            The request for this conversation&apos;s messages failed — the saved history may still be intact.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button
              className={styles.conversationArchiveBtnLarge}
              onClick={() => queryClient.invalidateQueries({ queryKey: conversationMessagesQueryKey(conversation.name) })}
            >
              Retry
            </button>
          </div>
        </div>
      ) : isSpawning || kickoffStartPending ? (
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
            <button className={styles.conversationArchiveBtnLarge} hidden={isNativeShell()} onClick={() => onArchive?.()} disabled={archivePending}>
              {archivePending ? 'Archiving…' : 'Archive'}
            </button>
          </div>
        </div>
      ) : isHeldUnsent ? (
        <HeldHandoffView
          conversationName={conversation.name}
          kickoffText={heldKickoff.text!}
          focus={heldKickoff.focus}
          cwd={conversation.cwd}
          handoffDocPath={conversation.handoffDocPath}
          startError={isForkFailed ? conversation.forkError : null}
          onStarted={() => {
            setKickoffStartedFrom({ name: conversation.name, forkStatus: conversation.forkStatus ?? null });
            heldKickoff.refresh();
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          }}
          onArchive={onArchive}
          archivePending={archivePending}
        />
      ) : isForking && messages.length === 0 ? (
        <ForkProgressView
          forkStatus={conversation.forkStatus!}
          forkError={conversation.forkError}
          parentTitle={parentTitle}
        />
      ) : heldLookupFailed ? (
        <HeldKickoffLookupFailedView onRetry={heldKickoff.refresh} onArchive={onArchive} archivePending={archivePending} />
      ) : isOrphaned ? (
        <div className={styles.conversationEmptyState}>
          {conversation.transcriptMissing ? (
            <>
              <p className={styles.conversationEmptyStateTitle} style={{ color: 'var(--warning)' }}>
                ⚠ Transcript missing
              </p>
              <p className={styles.conversationEmptyStateSubtitle}>
                This conversation had activity, but its transcript file no longer exists on disk. The history cannot be recovered.
              </p>
            </>
          ) : (
            <p className={styles.conversationEmptyStateSubtitle}>
              This conversation has no saved history. The session may have ended before any messages were exchanged.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {onResume && (
              <ConversationResumeControls
                modelPicker={modelPicker}
                sendResumeContract={sendResumeContract}
                onSendResumeContractChange={onSendResumeContractChange}
                onResume={onResume}
                resumePending={resumePending}
                resumeLabel={resumeLabel}
                className={styles.conversationResumeControls}
              />
            )}
            <button className={styles.conversationArchiveBtnLarge} hidden={isNativeShell()} onClick={() => onArchive?.()} disabled={archivePending}>
              {archivePending ? 'Archiving…' : 'Archive'}
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
        <ToolBodyLoaderContext.Provider value={toolBodyLoader}>
        <MessagesTimeline
          messages={messages}
          workLog={workLog}
          streaming={isWorking}
          roundMarkers={derivedRoundMarkers}
          failedMessages={failedMessages}
          onRetryFailed={handleRetryFailed}
          onDiscardFailed={handleDiscardFailed}
          onConfirmCommand={handleConfirmCommand}
          proposedPlan={data?.proposedPlan}
          paneChoice={livePaneChoice}
          answeredPaneChoices={answeredPaneChoices}
          onPaneChoiceAnswered={handlePaneChoiceAnswered}
          onOpenTerminal={onOpenTerminal}
          compactBoundaries={data?.compactBoundaries}
          compacting={isCompacting}
          conversationName={conversation.name}
          cwd={conversation.cwd}
          issueId={conversation.issueId}
          sendNowAvailable={agentBusy && getHarnessBehavior(conversation.harness ?? 'claude-code').steerKind === 'send-now-keys'}
          agentId={agentId}
          subagentByToolUseId={subagentByToolUseId}
          onOpenSubagent={handleOpenSubagent}
          turnChangesByAssistantMessageId={turnCards}
          hideToolCalls={hideToolCalls}
          workingPhase={workingPhase}
          targetMessageId={targetMessageId}
          targetMessageIndex={targetMessageIndex}
          targetMessageNonce={targetMessageNonce}
          onTargetMessageHandled={onTargetMessageHandled}
          bookmarksEnabled
          citationsEnabled={!hideComposer && !onResume && !isForking && !conversation.clearedToConvId && acceptsInput(conversation)}
          history={olderHistory}
          onLoadOlder={olderHistory.loadOlder}
          onLoadOlderUntil={olderHistory.loadOlderUntil}
        />
        </ToolBodyLoaderContext.Provider>
      )}
      {/* PAN-1458: when this conversation was cleared via Claude Code's /clear, show a
          banner linking to the sibling that continues the work. The composer/resume bar
          is suppressed because the conversation is permanently ended — interacting here
          would either fail or branch off historical content. */}
      {isOrphaned || isHeldUnsent || heldLookupPending || heldLookupFailed || kickoffStartPending ? null : conversation.clearedToConvId ? (
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
        <ConversationResumeControls
          modelPicker={modelPicker}
          sendResumeContract={sendResumeContract}
          onSendResumeContractChange={onSendResumeContractChange}
          onResume={onResume}
          resumePending={resumePending}
          resumeLabel={resumeLabel}
        />
      ) : hideComposer ? null : (
        <ComposerFooter
          conversation={conversation}
          onSend={handleMessageSent}
          onSendAcknowledged={handleMessageAcknowledged}
          onSendFailed={handleSendFailed}
          agentId={agentId}
          contextWindowUsage={contextWindowUsage}
          subagentNotice={subagentNotice}
          observedEffort={contextWindowUsage?.lastEffort ?? data?.observedEffort ?? null}
          effortResolution={data?.effortResolution ?? null}
        />
      )}
    </div>
  );
}
