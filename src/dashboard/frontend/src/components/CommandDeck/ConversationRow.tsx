import { Fragment, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDashboardStore } from '../../lib/store';
import { Columns2, Circle, Archive, Copy, Check, X, Pencil, Sparkles, Star, Loader2, Terminal, FileCode, Search, Globe, Wrench, Zap, GitBranch, GitBranchPlus, GitFork, AlertCircle, Info, Scissors, TriangleAlert, FileText, FileX, ExternalLink, Share2, MoreVertical, FolderInput, MonitorSmartphone, CheckSquare, Square, CalendarClock } from 'lucide-react';
import { toolNameToPhase, getPhaseLabel, isSpinnerPhase } from '../../lib/workingPhase';
import { useConfirm } from '../DialogProvider';
import { continueTargetOf, openContinueOnDevice } from '../chat/continueOnDevice/continueOnDeviceStore';
import { VaultRowSyncMenuItem } from './VaultRowSyncMenuItem';
import { useNow } from '../../hooks/useNow';
import { AwaitingInputIndicator } from '../AwaitingInputIndicator';
import { useAskUserQuestionUiStore } from '../../lib/askUserQuestionUiStore';
import type { Conversation } from './ConversationList';
import type { ConversationMutations } from './useConversationMutations';
import type { RegisteredProject } from './UnknownProjectState';
import { NO_PROJECT_KEY, resolveEffectiveProjectKey } from './projectsData';
import { ProjectMark } from '../frame/ProjectMark';
import { currentPlatform } from '../../lib/shortcuts/keys';
import { CONVERSATION_DRAG_TYPE, useConversationDragStore } from '../Stage/conversationDragStore';
import { fallbackBadgeTone } from './fallbackBadge';
import { isScrollInsideMenu, MenuItemButton, MenuOverlay, MenuSeparator, MenuSurface } from '../shared/ContextMenu';
import { isOfflineLinked, LinkedMachineChip, LinkedOfflineMeta, LinkedRowMenuItems } from './LinkedConversationRow';
import { PullRequestMenuItems } from './PullRequestMenuItems';
import { ScheduleMenuItem } from '../chat/ConversationScheduleDialog';
import { TriageMenuItems } from './TriageMenuItems';
import { formatLocalWhen, formatSnoozeWake, isSnoozed } from './conversation-triage';
import { PullRequestBadge } from '../primitives/PullRequestBadge';
import { conversationMetaParts } from './conversationMeta';
import styles from './styles/command-deck.module.css';

function formatStalledTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ─── WorkingSpinner ───────────────────────────────────────────────────────────

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

export function WorkingSpinner({
  size,
  currentTool,
  'aria-label': ariaLabel,
}: {
  size: number;
  currentTool: string | null;
  'aria-label'?: string;
}) {
  const phase = currentTool ? toolNameToPhase(currentTool) : 'thinking';
  const Icon = PHASE_ICONS[phase];
  const label = getPhaseLabel(phase);
  const iconClass = isSpinnerPhase(phase)
    ? styles.conversationWorkingSpinner
    : styles.conversationWorkingPulse;
  return (
    <span title={label} style={{ display: 'contents' }}>
      <Icon
        size={size}
        className={iconClass}
        aria-label={ariaLabel ?? label}
      />
    </span>
  );
}

// ─── ConversationRow ─────────────────────────────────────────────────────────

interface ConversationRowProps {
  conv: Conversation;
  isSelected: boolean;
  onSelect: (name: string) => void;
  /** PAN-4639 D14: when present, the row's click goes here instead of onSelect
   *  (multi-select handling by the list); nested rows and other callers keep onSelect. */
  onRowClick?: (event: React.MouseEvent, name: string) => void;
  /** PAN-4639 D14: part of the current multi-selection (top-level rows only). */
  isMultiSelected?: boolean;
  mutations: ConversationMutations;
  variant?: 'flat' | 'nested';
  /** Registered projects for the Move submenu (PAN-1577). Fetched once by the
   * list/container rather than per-row to avoid a duplicate request per row. */
  registeredProjects?: readonly RegisteredProject[];
  /** PAN-4223 D6: parent id of a row whose parent is not in the list (rendered top level). */
  orphanOf?: number | null;
  /** PAN-4223 D22: real parent id of a row flattened to display depth 2. */
  flattenedFrom?: number | null;
  /** PAN-4223 D27: the judged builder's id when this critic nests under it. */
  criticOf?: number | null;
  /** PAN-5343 H-D3: the row's project mark in the All projects list (NO_PROJECT_KEY renders muted). */
  markProjectKey?: string;
  markName?: string;
  /** PAN-5343 H-D18: the 1-based split leaf showing this conversation, when the deck is split. */
  paneSlot?: number;
  /** PAN-5343 H-D5: open this conversation beside the panes on screen (the Beside control and menu item). */
  onOpenBeside?: (name: string) => void;
  /** PAN-5343 H-D5: switch to the conversation's own project deck (menu item). */
  onOpenInProject?: (name: string) => void;
  /** PAN-5343 H-D8: the conversation's own project deck; when set, the row drags onto a pane. */
  dragDeckKey?: string;
}

/** D28: WOWED and PASS use the done token; every other verdict is neutral (routine work, not an alarm). */
function verdictBadgeTone(value: string): string {
  return value === 'WOWED' || value === 'PASS'
    ? 'badge-bg-state-done badge-border-state-done text-state-done'
    : 'bg-transparent border-muted-foreground/40 text-muted-foreground';
}

function verdictBadgeText(verdict: { value: string; defects: number | null }): string {
  if (verdict.value === 'pending') return 'PENDING';
  return verdict.defects !== null ? `${verdict.value} ${verdict.defects}` : verdict.value;
}

/** PAN-4223 WI-10: the lane role glyph before a nested lane's key. */
const LANE_GLYPH: Record<NonNullable<Conversation['laneRole']>, string> = {
  builder: 'B',
  critic: 'C',
  verifier: 'V',
  play: 'P',
  orchestrator: 'O',
};

/** Report badge tone by the style guide's badge formula (state tokens, PAN-4197). */
const LANE_REPORT_TONE: Record<NonNullable<Conversation['laneReport']>['status'], string> = {
  done: 'badge-bg-state-done badge-border-state-done text-state-done',
  blocked: 'badge-bg-state-needs-you badge-border-state-needs-you text-state-needs-you',
  failed: 'badge-bg-state-stuck badge-border-state-stuck text-state-stuck',
};

/**
 * The lineage caption a row carries (FR-27, D6, D22): a successor links back to
 * its predecessor; an orphan or flattened row names its real parent.
 */
function lineageCaption(
  conv: Conversation,
  orphanOf: number | null,
  flattenedFrom: number | null,
  criticOf: number | null,
): { text: string; href: string | null } | null {
  const run = conv.gauntletRun ?? '';
  if (flattenedFrom !== null) {
    if (criticOf !== null) return { text: `critic of #${flattenedFrom} · ${run}`, href: null };
    return conv.laneKey
      ? { text: `lane of #${flattenedFrom} · ${run}`, href: null }
      : { text: `↳ continued from #${flattenedFrom}`, href: `/conv/${flattenedFrom}` };
  }
  const parentId = conv.parentConversationId ?? null;
  if (parentId === null) return null;
  if (!conv.laneKey) return { text: `continues ← #${parentId}`, href: `/conv/${parentId}` };
  if (orphanOf !== null) return { text: `lane of #${orphanOf} · ${run}`, href: null };
  return null;
}

export function ConversationRow({
  conv,
  isSelected,
  onSelect,
  onRowClick,
  isMultiSelected = false,
  mutations,
  variant = 'flat',
  registeredProjects = [],
  orphanOf = null,
  flattenedFrom = null,
  criticOf = null,
  markProjectKey,
  markName,
  paneSlot,
  onOpenBeside,
  onOpenInProject,
  dragDeckKey,
}: ConversationRowProps) {
  const [copiedId, setCopiedId] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const draftTitleRef = useRef('');
  const committingRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuBtnRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  // Which control opened the overflow menu: the kebab (click/keyboard) or the
  // row itself (right-click). Focus returns to the actual opener.
  const menuOpenerRef = useRef<'row' | 'kebab'>('kebab');
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
  const confirm = useConfirm();
  const now = useNow(60_000);
  const meta = conversationMetaParts(conv, now);

  const openMenu = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    menuOpenerRef.current = 'kebab';
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (rect) {
      // Right-align the menu under the trigger; clamp to the viewport.
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 220) });
    }
    setMenuOpen(true);
  }, []);

  // Close the menu on Escape, scroll, or resize — a portaled menu can't track
  // its trigger once the list scrolls, so dismiss rather than float orphaned.
  useEffect(() => {
    if (!menuOpen) { setMoveSubmenuOpen(false); return; }
    const dismiss = () => setMenuOpen(false);
    const onScroll = (e: Event) => { if (!isScrollInsideMenu(e)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [menuOpen]);

  const archivePending = mutations.isArchivePending(conv.name);
  const stopPending = mutations.isStopPending(conv.name);
  // PAN-4626: archive wins — it ends the session too.
  const leavingKind: 'archive' | 'stop' | null = archivePending ? 'archive' : stopPending ? 'stop' : null;
  const isCompacting = useDashboardStore((s) => s.conversationsCompactingByName?.[conv.name] ?? false);
  const isAwaitingPermission = useDashboardStore((s) => s.conversationsAwaitingPermissionByName?.[conv.name] ?? false);
  const requestAskUserQuestionReopen = useAskUserQuestionUiStore((s) => s.requestReopen);

  const isNested = variant === 'nested';
  const caption = lineageCaption(conv, orphanOf, flattenedFrom, criticOf);
  // PAN-4223 WI-22 (D28): a critic shows its verdict; a builder links to its newest critic's verdict.
  const isJudge = conv.laneRole === 'critic' || conv.laneRole === 'verifier';
  const latestVerdict = conv.laneRole === 'builder' ? conv.laneLatestVerdict ?? null : null;
  const verdictBadge = isJudge && conv.laneVerdict ? (
    <span className={`${styles.laneReportBadge} ${verdictBadgeTone(conv.laneVerdict.value)}`}>{verdictBadgeText(conv.laneVerdict)}</span>
  ) : latestVerdict ? (
    <a
      href={`/conv/${latestVerdict.criticRoute}`}
      aria-label={`open critic ${latestVerdict.criticId === null ? latestVerdict.criticRoute : `#${latestVerdict.criticId}`}`}
      className={`${styles.laneReportBadge} ${styles.laneVerdictLink} ${verdictBadgeTone(latestVerdict.value)}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.href = `/conv/${latestVerdict.criticRoute}`;
      }}
    >
      {verdictBadgeText(latestVerdict)}
    </a>
  ) : null;
  const leavingLabel = leavingKind ? (
    <span className={styles.conversationLeavingStatus}>
      <Loader2 size={10} className={styles.conversationLeavingSpinner} aria-hidden="true" />
      <span>{leavingKind === 'archive' ? 'Archiving…' : 'Stopping…'}</span>
    </span>
  ) : null;
  const iconSize = isNested ? 10 : 11;
  const dotSize = isNested ? 6 : 7;
  const spinnerSize = isNested ? 10 : 12;
  const stalledLabel = conv.stalledSince
    ? `waiting on agent — no activity since ${formatStalledTime(conv.stalledSince)}`
    : null;

  // PAN-4639 WI-7: settling never calls stop or archive — the session keeps running.
  const toggleSettle = useCallback(() => {
    const settled = Boolean(conv.settledAt);
    mutations.triage({
      updates: [{ name: conv.name, settled: !settled }],
      label: settled ? `Moved "${conv.title ?? conv.name}" to Inbox` : `Settled "${conv.title ?? conv.name}"`,
    });
  }, [conv.settledAt, conv.name, conv.title, mutations]);

  const beginRename = useCallback(() => {
    committingRef.current = false;
    const initial = conv.title ?? conv.name;
    draftTitleRef.current = initial;
    setEditingName(true);
    setDraftTitle(initial);
    setTimeout(() => {
      editInputRef.current?.select();
    }, 0);
  }, [conv.title, conv.name]);

  const commitRename = useCallback(() => {
    if (committingRef.current) return;
    committingRef.current = true;
    const trimmed = draftTitleRef.current.trim();
    setEditingName(false);
    if (trimmed && trimmed !== (conv.title ?? conv.name)) {
      mutations.rename({ name: conv.name, title: trimmed });
    }
  }, [mutations, conv.name, conv.title]);

  const cancelEditing = useCallback(() => {
    setEditingName(false);
    setDraftTitle('');
  }, []);

  const handleCopyLink = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/conv/${conv.id}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  }, [conv.id]);

  const openHandoffDoc = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    window.open(`/api/conversations/${encodeURIComponent(conv.name)}/handoff-doc`, '_blank', 'noopener,noreferrer');
  }, [conv.name]);

  const openHandoffTarget = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (conv.handoffTargetConvId) {
      window.location.href = `/conv/${conv.handoffTargetConvId}`;
    }
  }, [conv.handoffTargetConvId]);

  const handleArchiveClick = useCallback(async () => {
    if (mutations.isArchivePending(conv.name)) return;
    const ok = await confirm({
      title: conv.isFavorited ? 'Archive favorited conversation' : 'Archive conversation',
      message: conv.isFavorited
        ? `"${conv.title ?? conv.name}" is favorited.\n\nArchiving will remove the favorite, end the session, and move it to the archive.`
        : `Archive "${conv.title ?? conv.name}"? This ends the session and moves it to the archive.`,
      confirmLabel: 'Archive',
      cancelLabel: 'Cancel',
      variant: 'destructive',
    });
    if (ok) mutations.archive(conv.name);
  }, [conv.isFavorited, conv.title, conv.name, confirm, mutations]);

  const offlineLinked = isOfflineLinked(conv); // PAN-4650: muted title, hollow dot, offline metadata
  const itemClass = (offlineLinked ? `${styles.linkedRowOffline} ` : '') + (isNested
    ? `${styles.projectConvItem} ${isSelected ? styles.projectConvItemSelected : ''} ${leavingKind ? styles.conversationRowLeaving : ''}`
    : `${styles.conversationItem} ${isSelected || isMultiSelected ? styles.conversationItemSelected : ''} ${leavingKind ? styles.conversationRowLeaving : ''}`);

  // Fork / spawn status badges — shared by both row variants.
  const ownerLabel = conv.vaultOwnerLabel ?? 'another machine';
  const continuity = conv.vaultContinuity;
  const continuityLabel = continuity
    ? (continuity.kind === 'forked-locally' ? continuity.parentOwnerLabel : continuity.ownerLabel)
    : null;
  const continuityTitle = continuity?.kind === 'forked-locally'
    ? `Continued on ${continuityLabel}. Local turns since then were saved as a fork (${continuity.forkVaultId.slice(0, 8)}).`
    : `Continued on ${continuityLabel}.`;
  const continuityBadge = continuity ? (
    <span
      className={styles.conversationBranchChip}
      title={continuityTitle}
      aria-label={continuityTitle}
      data-testid="vault-continuity-badge"
    >
      <MonitorSmartphone size={10} />
      <span className={styles.conversationBranchChipText}>{`continued on ${continuityLabel}`}</span>
    </span>
  ) : null;
  const ownerBadge = conv.origin === 'vault' ? (
    <span
      className={styles.conversationBranchChip}
      title={`Read-only copy from ${ownerLabel}`}
      aria-label={`Read-only copy from ${ownerLabel}`}
      data-testid="vault-owner-badge"
    >
      <MonitorSmartphone size={10} />
      <span className={styles.conversationBranchChipText}>{`from ${ownerLabel}`}</span>
    </span>
  ) : conv.origin === 'linked' ? <LinkedMachineChip conv={conv} /> : continuityBadge;
  const pullRequestBadge = conv.pullRequest ? (
    <PullRequestBadge
      link={conv.pullRequest}
      extraCount={Math.max(0, (conv.pullRequestCount ?? 1) - 1)}
    />
  ) : null;
  const scheduleCount = conv.scheduleCount ?? 0;
  const scheduleBadgeLabel = conv.nextScheduledRunAt
    ? `${scheduleCount} active schedule${scheduleCount === 1 ? '' : 's'} · next run ${new Date(conv.nextScheduledRunAt).toLocaleString()}`
    : '';
  const scheduleBadge = conv.nextScheduledRunAt ? (
    <span
      className={styles.conversationBranchChip}
      title={scheduleBadgeLabel}
      aria-label={scheduleBadgeLabel}
      data-testid="schedule-badge"
    >
      <CalendarClock size={10} />
      <span className={styles.conversationBranchChipText}>{formatLocalWhen(conv.nextScheduledRunAt, now)}</span>
    </span>
  ) : null;

  const forkBadges = (
    <>
      {stalledLabel && (
        <span
          className={styles.conversationStalledStatus}
          aria-label={`Agent stalled in ${conv.name}`}
          title={new Date(conv.stalledSince!).toLocaleString()}
        >
          {stalledLabel}
        </span>
      )}
      {conv.forkStatus && conv.forkStatus !== 'failed' && (
        <span className={styles.conversationForkStatus} title={`Fork: ${conv.forkStatus}`}>
          <Loader2 size={10} className={styles.conversationWorkingSpinner} />
          <span>{conv.forkStatus === 'summarizing' ? 'Summarizing...' : conv.forkStatus === 'spawning' ? 'Spawning...' : 'Injecting...'}</span>
        </span>
      )}
      {conv.forkStatus === 'failed' && (
        <span className={styles.conversationForkFailed} title={conv.forkError || 'Fork failed'}>
          <AlertCircle size={10} />
          <span>Failed</span>
        </span>
      )}
      {conv.spawnError && (
        <span className={styles.conversationForkFailed} title={conv.spawnError}>
          <AlertCircle size={10} />
          <span>Spawn failed</span>
        </span>
      )}
      {conv.forkFallbackReason && !conv.forkStatus && (
        fallbackBadgeTone(conv) === 'alert' ? (
          <span
            className={styles.conversationForkFailed}
            title={`Intended handoff fell back to summary fork: ${conv.forkFallbackReason}. Look in ~/.overdeck/handoffs/ for the .rejected.md file to see what the authoring session emitted.`}
          >
            <TriangleAlert size={10} />
            <span>Fallback: {conv.forkFallbackReason}</span>
          </span>
        ) : (
          // PAN-3736: the conversation is demonstrably alive, so the degraded
          // seed is history rather than a live failure — say so quietly.
          <span
            className={styles.conversationForkFallbackNote}
            title={`Seeded via summary fork instead of the intended handoff: ${conv.forkFallbackReason}. This conversation has been running since; look in ~/.overdeck/handoffs/ for the .rejected.md file to see what the authoring session emitted.`}
          >
            <Info size={10} />
            <span>Seeded via fallback: {conv.forkFallbackReason}</span>
          </span>
        )
      )}
      {conv.transcriptMissing && (
        <span
          className={styles.conversationForkFailed}
          title="Transcript missing — this conversation had activity, but its history file no longer exists on disk. The history cannot be recovered."
        >
          <FileX size={10} />
          <span>No transcript</span>
        </span>
      )}
    </>
  );

  return (
    <>
    <button
      ref={rowRef}
      className={itemClass}
      onClick={(e) => {
        if (leavingKind) return;
        if (onRowClick) onRowClick(e, conv.name);
        else onSelect(conv.name);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (leavingKind) return;
        e.currentTarget.focus();
        menuOpenerRef.current = 'row';
        setMenuPos({
          top: Math.max(8, Math.min(e.clientY, window.innerHeight - 320)),
          left: Math.max(8, Math.min(e.clientX, window.innerWidth - 230)),
        });
        setMenuOpen(true);
      }}
      title={conv.name}
      draggable={dragDeckKey ? true : undefined}
      onDragStart={dragDeckKey ? (e) => {
        e.dataTransfer.setData(CONVERSATION_DRAG_TYPE, conv.name);
        e.dataTransfer.effectAllowed = 'copyMove';
        useConversationDragStore.getState().start({ name: conv.name, deckKey: dragDeckKey });
      } : undefined}
      onDragEnd={dragDeckKey ? () => useConversationDragStore.getState().end() : undefined}
      aria-busy={leavingKind ? true : undefined}
      aria-selected={isMultiSelected || undefined}
    >
      {/* Stop button */}
      {conv.sessionAlive && (
        stopPending ? (
          <span
            className={styles.conversationStopBtn}
            aria-disabled="true"
            aria-label={`Stopping agent for ${conv.name}`}
            title="Stopping…"
          >
            <Loader2 size={iconSize} className={styles.conversationLeavingSpinner} />
          </span>
        ) : (
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationStopBtn}
            onClick={e => { e.stopPropagation(); mutations.stop(conv.name); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); mutations.stop(conv.name); } }}
            title="Stop agent"
            aria-label={`Stop agent for ${conv.name}`}
          >
            <X size={iconSize} />
          </span>
        )
      )}

      {/* Settle checkbox (PAN-4639 WI-7): top-level rows only. The session is not stopped. */}
      {!isNested && (
        <span
          role="checkbox"
          aria-checked={Boolean(conv.settledAt)}
          tabIndex={0}
          className={styles.conversationSettleBox}
          aria-label={conv.settledAt ? `Unsettle ${conv.title ?? conv.name}` : `Settle ${conv.title ?? conv.name}`}
          onClick={(e) => { e.stopPropagation(); toggleSettle(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSettle(); }
          }}
        >
          {conv.settledAt ? <CheckSquare size={iconSize} /> : <Square size={iconSize} />}
        </span>
      )}

      {/* Status indicator */}
      {conv.forkStatus && conv.forkStatus !== 'failed' ? (
        <Loader2
          size={spinnerSize}
          className={styles.conversationWorkingSpinner}
          style={{ color: 'var(--warning)' }}
          aria-label={`Forking ${conv.name}`}
        />
      ) : isCompacting ? (
        <span title="Compacting conversation history" style={{ display: 'contents' }}>
          <Scissors
            size={spinnerSize}
            className={styles.conversationWorkingPulse}
            style={{ color: 'var(--success)' }}
            aria-label={`Compacting ${conv.name}`}
          />
        </span>
      ) : isAwaitingPermission ? (
        <span title="Waiting for your permission" style={{ display: 'contents' }}>
          <TriangleAlert
            size={spinnerSize}
            className={styles.conversationPermissionAlert}
            aria-label={`Waiting for permission in ${conv.name}`}
          />
        </span>
      ) : (conv.pendingInputCount ?? 0) > 0 ? (
        // PAN-1520 — conv has an open AskUserQuestion/plan-mode/etc. Pulses so
        // the row is spottable from a distance, and clicking it re-opens the
        // dialog: dismissing (or losing) the modal must never strand the
        // question with no way back to it.
        <AwaitingInputIndicator
          kinds={conv.pendingInputKinds}
          size={spinnerSize}
          onClick={() => requestAskUserQuestionReopen(conv.name)}
        />
      ) : conv.stalledSince ? (
        <AlertCircle
          size={spinnerSize}
          className={styles.conversationStalledIcon}
          aria-hidden="true"
        />
      ) : conv.isWorking ? (
        <WorkingSpinner
          size={spinnerSize}
          currentTool={conv.currentTool ?? null}
          aria-label={`Agent working in ${conv.name}`}
        />
      ) : (
        <Circle
          size={dotSize}
          className={styles.conversationDot}
          style={{
            fill: offlineLinked ? 'transparent' : conv.sessionAlive ? 'var(--success)' : 'var(--muted-foreground)',
            color: conv.sessionAlive ? 'var(--success)' : 'var(--muted-foreground)',
          }}
        />
      )}

      {markProjectKey && (
        <ProjectMark size="sm" name={markName ?? markProjectKey} projectKey={markProjectKey} muted={markProjectKey === NO_PROJECT_KEY} />
      )}

      {/* Title + metadata */}
      {editingName ? (
        <input
          ref={editInputRef}
          className={styles.conversationNameInput}
          value={draftTitle}
          onChange={e => { setDraftTitle(e.target.value); draftTitleRef.current = e.target.value; }}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') cancelEditing();
          }}
          onBlur={() => commitRename()}
          aria-label={`Rename ${conv.name}`}
        />
      ) : isNested ? (
        // Nested project-tree rows stay single-line and ultra-compact.
        <>
          {conv.laneKey && conv.laneRole && (
            <span className={styles.laneLabel}>{`${LANE_GLYPH[conv.laneRole]} ${conv.laneKey} i${conv.laneIteration ?? 1}`}</span>
          )}
          <span className={`${styles.projectConvLabel} ${mutations.isRetitlePending(conv.name) ? styles.titleRegenerating : ''}`}>{conv.title ?? conv.name}</span>
          {leavingLabel}
          {conv.laneKey && conv.laneReport && !(isJudge && conv.laneVerdict) && (
            <span className={`${styles.laneReportBadge} ${LANE_REPORT_TONE[conv.laneReport.status]}`}>
              {conv.laneReport.status.toUpperCase()}
            </span>
          )}
          {verdictBadge}
          {conv.branch && (
            <span
              className={styles.conversationBranchChip}
              title={`${conv.isWorktree ? 'Worktree' : 'Local'} · ${conv.branch} · ${conv.cwd}`}
              aria-label={`Branch ${conv.branch} (${conv.isWorktree ? 'worktree' : 'local'})`}
            >
              {conv.isWorktree ? <GitFork size={10} /> : <GitBranch size={10} />}
              <span className={styles.conversationBranchChipText}>{conv.branch}</span>
            </span>
          )}
          {ownerBadge}
          {pullRequestBadge}
          {scheduleBadge}
          {forkBadges}
        </>
      ) : (
        // Flat list rows: title on line 1, then the meta line in words
        // (PAN-5293 F-D15): state · changes · harness · cost, then the chips.
        <span className={styles.conversationMain}>
          <span className={`${styles.conversationName} ${mutations.isRetitlePending(conv.name) ? styles.titleRegenerating : ''}`}>{conv.title ?? conv.name}</span>
          <span className={styles.conversationMetaLine} title={leavingLabel ? undefined : meta.title} data-testid="conversation-meta-line">
            {leavingLabel ?? (
              <>
                {meta.parts.map((part, index) => (
                  <Fragment key={part.key}>
                    {index > 0 && part.key !== 'deletions' && <span className={styles.conversationMetaSep} aria-hidden>·</span>}
                    <span
                      title={part.title}
                      data-meta-part={part.key}
                      className={[
                        styles.conversationMetaPart,
                        part.key === 'cost' ? styles.conversationMetaCost : '',
                        part.tone === 'additions' ? 'font-mono text-success-foreground'
                          : part.tone === 'deletions' ? 'font-mono text-destructive-foreground'
                          : part.tone === 'muted' ? 'text-muted-foreground' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {part.text}
                    </span>
                  </Fragment>
                ))}
                {verdictBadge}
                {ownerBadge}
                {pullRequestBadge}
                {scheduleBadge}
                {offlineLinked && <LinkedOfflineMeta conv={conv} />}
                {forkBadges}
                {isSnoozed(conv, now.getTime()) && conv.snoozedUntil && (
                  <>
                    <span className={styles.conversationMetaSep} aria-hidden>·</span>
                    <span className={styles.conversationSnoozeLabel}>{formatSnoozeWake(conv.snoozedUntil, now)}</span>
                  </>
                )}
              </>
            )}
          </span>
        </span>
      )}

      {paneSlot !== undefined && (
        <span
          className="shrink-0 rounded border border-border px-1 font-mono text-[10px] leading-4 text-muted-foreground"
          title={`Shown in pane ${paneSlot}`}
          data-testid="conversation-pane-slot"
        >
          {paneSlot}
        </span>
      )}

      {/* PAN-5343 H-D5: open beside the panes on screen. */}
      {onOpenBeside && !editingName && (
        <span
          role="button"
          tabIndex={0}
          className={styles.conversationKebabBtn}
          onClick={(e) => { e.stopPropagation(); onOpenBeside(conv.name); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenBeside(conv.name); }
          }}
          title={`Open beside (${currentPlatform() === 'mac' ? '⌘' : 'Ctrl'}+Click)`}
          aria-label="Open beside"
        >
          <Columns2 size={iconSize} />
        </span>
      )}

      {/* Overflow actions (⋮) — replaces the inline icon swarm */}
      {!editingName && (
        <span
          ref={menuBtnRef}
          role="button"
          tabIndex={0}
          className={styles.conversationKebabBtn}
          onClick={openMenu}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openMenu(e); }}
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`More actions for ${conv.title ?? conv.name}`}
        >
          <MoreVertical size={iconSize} />
        </span>
      )}

      {/* Star */}
      <span
        role="button"
        tabIndex={0}
        className={conv.isFavorited ? styles.conversationStarPersistent : styles.conversationStarBtn}
        onClick={e => {
          e.stopPropagation();
          mutations.toggleFavorite({ name: conv.name, favorited: !!conv.isFavorited });
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'f') {
            e.stopPropagation();
            mutations.toggleFavorite({ name: conv.name, favorited: !!conv.isFavorited });
          }
        }}
        title={conv.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={conv.isFavorited ? `Unfavorite ${conv.title ?? conv.name}` : `Favorite ${conv.title ?? conv.name}`}
        aria-pressed={!!conv.isFavorited}
      >
        <Star size={iconSize} style={{ fill: conv.isFavorited ? 'currentColor' : 'none' }} />
      </span>
    </button>
    {caption && (
      <div className={styles.lineageCaption}>
        {caption.href
          ? <a href={caption.href} className={styles.lineageCaptionLink}>{caption.text}</a>
          : <span>{caption.text}</span>}
      </div>
    )}

    {/* Overflow menu — portaled to body so it isn't nested inside the row
        button and doesn't clip against the scrolling conversation list. */}
    {menuOpen && menuPos && createPortal(
      <>
        <MenuOverlay onClick={() => setMenuOpen(false)} />
        <MenuSurface
          aria-label={`Actions for ${conv.title ?? conv.name}`}
          onClose={() => setMenuOpen(false)}
          returnFocusRef={menuOpenerRef.current === 'row' ? rowRef : menuBtnRef}
          className="fixed z-[1000] min-w-[220px]"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, right: 'auto' }}
        >
          {onOpenBeside && (
            <MenuItemButton onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpenBeside(conv.name); }}>
              <Columns2 size={14} />
              Open beside
            </MenuItemButton>
          )}
          {onOpenInProject && (
            <MenuItemButton onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpenInProject(conv.name); }}>
              <FolderInput size={14} />
              Open in its project
            </MenuItemButton>
          )}
          {(onOpenBeside || onOpenInProject) && <MenuSeparator />}
          {conv.origin === 'linked' ? <LinkedRowMenuItems conv={conv} onCopyLink={handleCopyLink} onClose={() => setMenuOpen(false)} /> : <>
          <MenuItemButton
            onClick={() => { beginRename(); setMenuOpen(false); }}
          >
            <Pencil size={14} />
            Rename
          </MenuItemButton>
          <MenuItemButton
            onClick={() => { mutations.retitle(conv.name); setMenuOpen(false); }}
            disabled={mutations.isRetitlePending(conv.name)}
          >
            {mutations.isRetitlePending(conv.name)
              ? <Loader2 size={14} className={styles.conversationWorkingSpinner} />
              : <Sparkles size={14} />}
            Regenerate title
          </MenuItemButton>
          {registeredProjects.length > 0 && (
            <span style={{ position: 'relative', display: 'block' }}>
              <MenuItemButton
                aria-haspopup="menu"
                aria-expanded={moveSubmenuOpen}
                onClick={() => setMoveSubmenuOpen((open) => !open)}
              >
                <FolderInput size={14} />
                Move
              </MenuItemButton>
              {moveSubmenuOpen && (
                <>
                  <MenuOverlay onClick={() => setMoveSubmenuOpen(false)} />
                  <MenuSurface
                    aria-label="Move conversation"
                    onClose={() => setMoveSubmenuOpen(false)}
                    className="absolute left-full top-0 z-[1001] ml-1 min-w-[180px]"
                  >
                    {registeredProjects.map((project) => {
                      const isCurrent = resolveEffectiveProjectKey(conv, registeredProjects) === project.key;
                      const projectName = project.name ?? project.key;
                      return (
                        <MenuItemButton
                          key={project.key}
                          disabled={isCurrent}
                          onClick={() => {
                            if (isCurrent) return;
                            mutations.move({ name: conv.name, projectKey: project.key, projectName });
                            setMoveSubmenuOpen(false);
                            setMenuOpen(false);
                          }}
                        >
                          {projectName}
                          {isCurrent && <Check size={14} className="ml-auto text-primary" />}
                        </MenuItemButton>
                      );
                    })}
                  </MenuSurface>
                </>
              )}
            </span>
          )}
          {!isNested && <TriageMenuItems conversation={conv} mutations={mutations} onClose={() => setMenuOpen(false)} />}
          <PullRequestMenuItems conversation={conv} mutations={mutations} onClose={() => setMenuOpen(false)} />
          <ScheduleMenuItem conversation={conv} onClose={() => setMenuOpen(false)} />
          {conv.claudeSessionId && !conv.forkStatus && (
            <MenuItemButton
              onClick={() => { mutations.openForkModal(conv, { mode: 'handoff' }); setMenuOpen(false); }}
            >
              <Share2 size={14} />
              Hand off to new conversation
            </MenuItemButton>
          )}
          {conv.claudeSessionId && !conv.forkStatus && (
            <MenuItemButton
              onClick={() => { mutations.openForkModal(conv); setMenuOpen(false); }}
            >
              <GitBranchPlus size={14} />
              Create summary fork
            </MenuItemButton>
          )}
          {conv.handoffDocPath && (
            <MenuItemButton
              onClick={(e) => { openHandoffDoc(e); setMenuOpen(false); }}
            >
              <FileText size={14} />
              Open handoff doc
            </MenuItemButton>
          )}
          {conv.handoffTargetConvId && (
            <MenuItemButton
              onClick={(e) => { openHandoffTarget(e); setMenuOpen(false); }}
            >
              <ExternalLink size={14} />
              Open handoff target
            </MenuItemButton>
          )}
          <MenuSeparator />
          {conv.origin === 'vault' && <VaultRowSyncMenuItem onDone={() => setMenuOpen(false)} />}
          {conv.origin !== 'vault' && (
            <MenuItemButton onClick={(e) => { e.stopPropagation(); openContinueOnDevice(continueTargetOf(conv)); setMenuOpen(false); }}>
              <MonitorSmartphone size={14} />
              Continue on another device
            </MenuItemButton>
          )}
          <MenuItemButton
            onClick={(e) => { handleCopyLink(e); setMenuOpen(false); }}
          >
            {copiedId ? <Check size={14} /> : <Copy size={14} />}
            Copy link
          </MenuItemButton>
          <MenuSeparator />
          <MenuItemButton
            destructive
            disabled={archivePending}
            onClick={() => { setMenuOpen(false); void handleArchiveClick(); }}
          >
            {archivePending ? <Loader2 size={14} className={styles.conversationWorkingSpinner} /> : <Archive size={14} />}
            {archivePending ? 'Archiving…' : 'Archive'}
          </MenuItemButton>
          </>}
        </MenuSurface>
      </>,
      document.body,
    )}
    </>
  );
}
