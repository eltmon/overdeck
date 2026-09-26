import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDashboardStore } from '../../lib/store';
import { Circle, Archive, Copy, Check, X, Pencil, Sparkles, Star, Loader2, Terminal, FileCode, Search, Globe, Wrench, Zap, GitBranch, GitBranchPlus, GitFork, AlertCircle, Info, Scissors, TriangleAlert, FileText, FileX, ExternalLink, Share2, MoreVertical, FolderInput } from 'lucide-react';
import { toolNameToPhase, getPhaseLabel, isSpinnerPhase } from '../../lib/workingPhase';
import { useConfirm } from '../DialogProvider';
import { useNow } from '../../hooks/useNow';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { AwaitingInputIndicator } from '../AwaitingInputIndicator';
import { useAskUserQuestionUiStore } from '../../lib/askUserQuestionUiStore';
import type { Conversation } from './ConversationList';
import type { ConversationMutations } from './useConversationMutations';
import type { RegisteredProject } from './UnknownProjectState';
import { resolveEffectiveProjectKey } from './projectsData';
import { fallbackBadgeTone } from './fallbackBadge';
import { MenuItemButton, MenuOverlay, MenuSeparator, MenuSurface } from '../shared/ContextMenu';
import { PullRequestMenuItems } from './PullRequestMenuItems';
import { PullRequestBadge } from '../primitives/PullRequestBadge';
import styles from './styles/command-deck.module.css';

/** Compact token count, e.g. 1234 → "1.2k", 2_500_000 → "2.5M". */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

/** Trim model IDs to a readable label, e.g. "claude-opus-4-8" → "opus-4-8". */
function shortModel(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

function shortHarness(harness: NonNullable<Conversation['harness']>): string {
  if (harness === 'claude-code') return 'Claude Code';
  if (harness === 'ohmypi') return 'oh-my-pi';
  if (harness === 'pi') return 'oh-my-pi';
  if (harness === 'codex') return 'Codex';
  if (harness === 'opencode') return 'OpenCode';
  if (harness === 'acp') return 'ACP';
  if (harness === 'kimi-code') return 'Kimi Code';
  // Unknown future harness — show the raw id rather than a wrong label.
  return harness;
}

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
  mutations,
  variant = 'flat',
  registeredProjects = [],
  orphanOf = null,
  flattenedFrom = null,
  criticOf = null,
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [menuOpen]);

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
      href={`/conv/${latestVerdict.criticId}`}
      aria-label={`open critic #${latestVerdict.criticId}`}
      className={`${styles.laneReportBadge} ${styles.laneVerdictLink} ${verdictBadgeTone(latestVerdict.value)}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.href = `/conv/${latestVerdict.criticId}`;
      }}
    >
      {verdictBadgeText(latestVerdict)}
    </a>
  ) : null;
  const iconSize = isNested ? 10 : 11;
  const dotSize = isNested ? 6 : 7;
  const spinnerSize = isNested ? 10 : 12;
  const stalledLabel = conv.stalledSince
    ? `waiting on agent — no activity since ${formatStalledTime(conv.stalledSince)}`
    : null;

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

  const itemClass = isNested
    ? `${styles.projectConvItem} ${isSelected ? styles.projectConvItemSelected : ''}`
    : `${styles.conversationItem} ${isSelected ? styles.conversationItemSelected : ''}`;

  // Fork / spawn status badges — shared by both row variants.
  const pullRequestBadge = conv.pullRequest ? (
    <PullRequestBadge
      link={conv.pullRequest}
      extraCount={Math.max(0, (conv.pullRequestCount ?? 1) - 1)}
    />
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
      draggable
      style={{ cursor: 'grab' }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify({ name: conv.name, projectKey: conv.projectKey ?? null, cwd: conv.cwd }));
      }}
      onClick={() => onSelect(conv.name)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.focus();
        menuOpenerRef.current = 'row';
        setMenuPos({
          top: Math.max(8, Math.min(e.clientY, window.innerHeight - 320)),
          left: Math.max(8, Math.min(e.clientX, window.innerWidth - 230)),
        });
        setMenuOpen(true);
      }}
      title={conv.name}
    >
      {/* Stop button */}
      {conv.sessionAlive && (
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
            fill: conv.sessionAlive ? 'var(--success)' : 'var(--muted-foreground)',
            color: conv.sessionAlive ? 'var(--success)' : 'var(--muted-foreground)',
          }}
        />
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
          {pullRequestBadge}
          {forkBadges}
        </>
      ) : (
        // Flat list rows: title on line 1, muted metadata on line 2.
        <span className={styles.conversationMain}>
          <span className={`${styles.conversationName} ${mutations.isRetitlePending(conv.name) ? styles.titleRegenerating : ''}`}>{conv.title ?? conv.name}</span>
          <span className={styles.conversationMetaLine}>
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
            {pullRequestBadge}
            {conv.lastAttachedAt && (
              <>
                {conv.branch && <span className={styles.conversationMetaSep} aria-hidden>·</span>}
                <time
                  dateTime={conv.lastAttachedAt}
                  title={new Date(conv.lastAttachedAt).toLocaleString()}
                >
                  {formatRelativeTime(conv.lastAttachedAt, now)}
                </time>
              </>
            )}
            {conv.totalCost !== undefined && conv.totalCost > 0 && (
              <>
                <span className={styles.conversationMetaSep} aria-hidden>·</span>
                <span title="Total cost (cache-discount aware)">{conv.totalCost < 0.01 ? '<$0.01' : `$${conv.totalCost.toFixed(2)}`}</span>
              </>
            )}
            {conv.totalTokens !== undefined && conv.totalTokens > 0 && (
              <>
                <span className={styles.conversationMetaSep} aria-hidden>·</span>
                <span title={`${conv.totalTokens.toLocaleString()} tokens (input + output + cache read/write)`}>{formatTokens(conv.totalTokens)} tok</span>
              </>
            )}
            <span className={styles.conversationMetaSep} aria-hidden>·</span>
            <span title={`Harness: ${shortHarness(conv.harness ?? 'claude-code')}`}>{shortHarness(conv.harness ?? 'claude-code')}</span>
            {conv.model && (
              <>
                <span className={styles.conversationMetaSep} aria-hidden>·</span>
                <span title={`Model: ${conv.model}`}>{shortModel(conv.model)}</span>
              </>
            )}
            {forkBadges}
          </span>
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
          <PullRequestMenuItems conversation={conv} mutations={mutations} onClose={() => setMenuOpen(false)} />
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
          <MenuItemButton
            onClick={(e) => { handleCopyLink(e); setMenuOpen(false); }}
          >
            {copiedId ? <Check size={14} /> : <Copy size={14} />}
            Copy link
          </MenuItemButton>
          <MenuSeparator />
          <MenuItemButton
            destructive
            onClick={() => { setMenuOpen(false); void handleArchiveClick(); }}
          >
            <Archive size={14} />
            Archive
          </MenuItemButton>
        </MenuSurface>
      </>,
      document.body,
    )}
    </>
  );
}
