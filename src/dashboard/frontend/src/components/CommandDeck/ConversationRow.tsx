import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDashboardStore } from '../../lib/store';
import { Circle, Archive, Copy, Check, X, Pencil, Sparkles, Star, Loader2, Terminal, FileCode, Search, Globe, Wrench, Zap, GitBranch, GitBranchPlus, GitFork, AlertCircle, Scissors, TriangleAlert, FileText, ExternalLink, Share2, MoreVertical } from 'lucide-react';
import { toolNameToPhase, getPhaseLabel, isSpinnerPhase } from '../../lib/workingPhase';
import { useConfirm } from '../DialogProvider';
import { useNow } from '../../hooks/useNow';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { describePendingInput } from '../../lib/pendingInput';
import type { Conversation } from './ConversationList';
import type { ConversationMutations } from './useConversationMutations';
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
  if (harness === 'pi') return 'Pi';
  return 'Codex';
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
}

export function ConversationRow({
  conv,
  isSelected,
  onSelect,
  mutations,
  variant = 'flat',
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
  const confirm = useConfirm();
  const now = useNow(60_000);

  const openMenu = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
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
    if (!menuOpen) return;
    const dismiss = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
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

  const isNested = variant === 'nested';
  const iconSize = isNested ? 10 : 11;
  const dotSize = isNested ? 6 : 7;
  const spinnerSize = isNested ? 10 : 12;

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
  const forkBadges = (
    <>
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
        <span
          className={styles.conversationForkFailed}
          title={`Intended handoff fell back to summary fork: ${conv.forkFallbackReason}. Look in ~/.overdeck/handoffs/ for the .rejected.md file to see what the authoring session emitted.`}
        >
          <TriangleAlert size={10} />
          <span>Fallback: {conv.forkFallbackReason}</span>
        </span>
      )}
    </>
  );

  return (
    <>
    <button
      className={itemClass}
      onClick={() => onSelect(conv.name)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuPos({
          top: Math.min(e.clientY, window.innerHeight - 320),
          left: Math.min(e.clientX, window.innerWidth - 230),
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
        // PAN-1520 — conv has an open AskUserQuestion/plan-mode/etc. Show the
        // same triangle-alert affordance as the permission case so operators
        // can spot the row from a distance.
        <span title={describePendingInput(conv.pendingInputKinds)} style={{ display: 'contents' }}>
          <TriangleAlert
            size={spinnerSize}
            className={styles.conversationPermissionAlert}
            aria-label={`Conversation ${conv.name} is awaiting input`}
          />
        </span>
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
          <span className={`${styles.projectConvLabel} ${mutations.isRetitlePending(conv.name) ? styles.titleRegenerating : ''}`}>{conv.title ?? conv.name}</span>
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
          {forkBadges}
        </>
      ) : (
        // Flat list rows: title on line 1, muted metadata on line 2.
        <span className={styles.conversationMain}>
          <span className={`${styles.conversationName} ${mutations.isRetitlePending(conv.name) ? styles.titleRegenerating : ''}`}>{conv.title ?? conv.name}</span>
          <span className={styles.conversationMetaLine}>
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
            {conv.model && (
              <>
                <span className={styles.conversationMetaSep} aria-hidden>·</span>
                <span title={`Harness: ${shortHarness(conv.harness ?? 'claude-code')}`}>{shortHarness(conv.harness ?? 'claude-code')}</span>
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

    {/* Overflow menu — portaled to body so it isn't nested inside the row
        button and doesn't clip against the scrolling conversation list. */}
    {menuOpen && menuPos && createPortal(
      <>
        <div className={styles.headerMenuOverlay} onClick={() => setMenuOpen(false)} />
        <div
          role="menu"
          className={styles.headerMenu}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, right: 'auto' }}
        >
          <button
            role="menuitem"
            className={styles.headerMenuItem}
            onClick={() => { beginRename(); setMenuOpen(false); }}
          >
            <Pencil size={14} />
            Rename
          </button>
          <button
            role="menuitem"
            className={styles.headerMenuItem}
            onClick={() => { mutations.retitle(conv.name); setMenuOpen(false); }}
            disabled={mutations.isRetitlePending(conv.name)}
          >
            {mutations.isRetitlePending(conv.name)
              ? <Loader2 size={14} className={styles.conversationWorkingSpinner} />
              : <Sparkles size={14} />}
            Regenerate title
          </button>
          {conv.claudeSessionId && !conv.forkStatus && (
            <button
              role="menuitem"
              className={styles.headerMenuItem}
              onClick={() => { mutations.openForkModal(conv, { mode: 'handoff' }); setMenuOpen(false); }}
            >
              <Share2 size={14} />
              Hand off to new conversation
            </button>
          )}
          {conv.claudeSessionId && !conv.forkStatus && (
            <button
              role="menuitem"
              className={styles.headerMenuItem}
              onClick={() => { mutations.openForkModal(conv); setMenuOpen(false); }}
            >
              <GitBranchPlus size={14} />
              Create summary fork
            </button>
          )}
          {conv.handoffDocPath && (
            <button
              role="menuitem"
              className={styles.headerMenuItem}
              onClick={(e) => { openHandoffDoc(e); setMenuOpen(false); }}
            >
              <FileText size={14} />
              Open handoff doc
            </button>
          )}
          {conv.handoffTargetConvId && (
            <button
              role="menuitem"
              className={styles.headerMenuItem}
              onClick={(e) => { openHandoffTarget(e); setMenuOpen(false); }}
            >
              <ExternalLink size={14} />
              Open handoff target
            </button>
          )}
          <div className={styles.headerMenuDivider} />
          <button
            role="menuitem"
            className={styles.headerMenuItem}
            onClick={(e) => { handleCopyLink(e); setMenuOpen(false); }}
          >
            {copiedId ? <Check size={14} /> : <Copy size={14} />}
            Copy link
          </button>
          <div className={styles.headerMenuDivider} />
          <button
            role="menuitem"
            className={`${styles.headerMenuItem} ${styles.headerMenuItemDestructive}`}
            onClick={() => { setMenuOpen(false); void handleArchiveClick(); }}
          >
            <Archive size={14} />
            Archive
          </button>
        </div>
      </>,
      document.body,
    )}
    </>
  );
}
