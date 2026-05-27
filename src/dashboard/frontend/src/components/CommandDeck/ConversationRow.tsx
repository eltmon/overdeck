import { useState, useCallback, useRef } from 'react';
import { useDashboardStore } from '../../lib/store';
import { Circle, Archive, Copy, Check, X, Pencil, Sparkles, Star, Loader2, Terminal, FileCode, Search, Globe, Wrench, Zap, GitBranch, GitBranchPlus, GitFork, AlertCircle, Scissors, TriangleAlert, FileText, ExternalLink, Share2 } from 'lucide-react';
import { toolNameToPhase, getPhaseLabel, isSpinnerPhase } from '../../lib/workingPhase';
import { useConfirm } from '../DialogProvider';
import { useNow } from '../../hooks/useNow';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { Conversation } from './ConversationList';
import type { ConversationMutations } from './useConversationMutations';
import styles from './styles/command-deck.module.css';

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
  const [confirmArchive, setConfirmArchive] = useState(false);
  const confirm = useConfirm();
  const now = useNow(60_000);

  const isCompacting = useDashboardStore((s) => s.conversationsCompactingByName?.[conv.name] ?? false);
  const isAwaitingPermission = useDashboardStore((s) => s.conversationsAwaitingPermissionByName?.[conv.name] ?? false);

  const isNested = variant === 'nested';
  const iconSize = isNested ? 10 : 11;
  const dotSize = isNested ? 6 : 7;
  const spinnerSize = isNested ? 10 : 12;

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleArchiveClick = useCallback(async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (conv.isFavorited) {
      const ok = await confirm({
        title: 'Archive favorited conversation',
        message: `"${conv.title ?? conv.name}" is favorited.\n\nArchiving will remove the favorite, end the session, and move it to the archive.`,
        confirmLabel: 'Archive',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      });
      if (ok) mutations.archive(conv.name);
    } else {
      setConfirmArchive(true);
    }
  }, [conv.isFavorited, conv.title, conv.name, confirm, mutations]);

  const itemClass = isNested
    ? `${styles.projectConvItem} ${isSelected ? styles.projectConvItemSelected : ''}`
    : `${styles.conversationItem} ${isSelected ? styles.conversationItemSelected : ''}`;

  return (
    <button
      className={itemClass}
      onClick={() => onSelect(conv.name)}
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
        <span title={`Waiting on your input (${(conv.pendingInputKinds ?? []).join(', ') || 'question'})`} style={{ display: 'contents' }}>
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

      {/* Title / inline editor */}
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
      ) : (
        <span className={isNested ? styles.projectConvLabel : styles.conversationName}>
          {conv.title ?? conv.name}
        </span>
      )}

      {/* Branch / worktree chip (PAN-1523) */}
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

      {/* Fork status badges */}
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
          title={`Intended handoff fell back to summary fork: ${conv.forkFallbackReason}. Look in ~/.panopticon/handoffs/ for the .rejected.md file to see what the authoring session emitted.`}
        >
          <TriangleAlert size={10} />
          <span>Fallback: {conv.forkFallbackReason}</span>
        </span>
      )}

      {/* Timestamp */}
      {conv.lastAttachedAt && (
        <time
          className={styles.conversationTime}
          dateTime={conv.lastAttachedAt}
          title={new Date(conv.lastAttachedAt).toLocaleString()}
          aria-label={`Last accessed ${formatRelativeTime(conv.lastAttachedAt, now)}`}
        >
          {formatRelativeTime(conv.lastAttachedAt, now)}
        </time>
      )}

      {/* Cost */}
      {conv.totalCost !== undefined && conv.totalCost > 0 && (
        <span className={styles.featureCost}>
          {conv.totalCost < 0.01 ? '<$0.01' : `$${conv.totalCost.toFixed(2)}`}
        </span>
      )}

      {/* Action group — collapses when row is not hovered */}
      <span className={styles.conversationActions}>
        <span
          role="button"
          tabIndex={0}
          className={styles.conversationEditBtn}
          onClick={startEditing}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') startEditing(e as unknown as React.MouseEvent); }}
          title="Rename conversation"
          aria-label={`Rename ${conv.name}`}
        >
          <Pencil size={iconSize} />
        </span>
        <span
          role="button"
          tabIndex={0}
          className={styles.conversationEditBtn}
          onClick={e => { e.stopPropagation(); mutations.retitle(conv.name); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); mutations.retitle(conv.name); } }}
          title="Regenerate title from the whole conversation"
          aria-label={`Regenerate title for ${conv.title ?? conv.name}`}
          aria-disabled={mutations.isRetitlePending(conv.name)}
        >
          {mutations.isRetitlePending(conv.name)
            ? <Loader2 size={iconSize} className={styles.conversationWorkingSpinner} />
            : <Sparkles size={iconSize} />}
        </span>
        {conv.handoffDocPath && (
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationSummaryForkBtn}
            onClick={openHandoffDoc}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openHandoffDoc(e); }}
            title="Handoff doc"
            aria-label={`Open handoff doc for ${conv.title ?? conv.name}`}
          >
            <FileText size={iconSize} />
          </span>
        )}
        {conv.handoffTargetConvId && (
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationSummaryForkBtn}
            onClick={openHandoffTarget}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openHandoffTarget(e); }}
            title="Open handoff target"
            aria-label={`Open handoff target for ${conv.title ?? conv.name}`}
          >
            <ExternalLink size={iconSize} />
          </span>
        )}
        {conv.claudeSessionId && conv.harness !== 'pi' && !conv.forkStatus && (
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationSummaryForkBtn}
            onClick={e => { e.stopPropagation(); mutations.openForkModal(conv); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); mutations.openForkModal(conv); } }}
            title="Create summary fork"
            aria-label={`Create summary fork of ${conv.title ?? conv.name}`}
          >
            <GitBranchPlus size={iconSize} />
          </span>
        )}
        {conv.claudeSessionId && !conv.forkStatus && (
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationSummaryForkBtn}
            onClick={e => { e.stopPropagation(); mutations.openForkModal(conv, { mode: 'handoff' }); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); mutations.openForkModal(conv, { mode: 'handoff' }); } }}
            title="Hand off to a new conversation"
            aria-label={`Hand off ${conv.title ?? conv.name} to a new conversation`}
          >
            <Share2 size={iconSize} />
          </span>
        )}
        {!confirmArchive && (
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationArchiveBtn}
            onClick={handleArchiveClick}
            onKeyDown={async (e) => { if (e.key === 'Enter' || e.key === ' ') await handleArchiveClick(e); }}
            title="Archive conversation"
            aria-label={`Archive ${conv.name}`}
          >
            <Archive size={iconSize} />
          </span>
        )}
        <span
          role="button"
          tabIndex={0}
          className={styles.conversationCopyBtn}
          onClick={handleCopyLink}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleCopyLink(e as unknown as React.MouseEvent); } }}
          title="Copy link to conversation"
          aria-label={`Copy link to ${conv.name}`}
        >
          {copiedId ? <Check size={iconSize} /> : <Copy size={iconSize} />}
        </span>
      </span>

      {/* Inline archive confirm */}
      {confirmArchive && (
        <span className={styles.archiveConfirmInline} onClick={e => e.stopPropagation()}>
          <span className={styles.archiveConfirmLabelInline}>Archive?</span>
          <button
            className={styles.archiveConfirmYesInline}
            onClick={e => { e.stopPropagation(); setConfirmArchive(false); mutations.archive(conv.name); }}
          >
            Yes
          </button>
          <button
            className={styles.archiveConfirmNoInline}
            onClick={e => { e.stopPropagation(); setConfirmArchive(false); }}
          >
            No
          </button>
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
  );
}
