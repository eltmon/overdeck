/**
 * Every user-facing string of the `MergeTrain` component (PAN-4753 WI-10),
 * plus the pure helpers that build them, so tests import the exact copy.
 * Plain inputs only: this module never imports a component.
 */
import type {
  BatchWindowState,
  BlockerType,
  BoardProject,
  MergeStepKey,
  RecentMerge,
  StrikeState,
  UatGenerationPayload,
} from './boardTypes';

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
  variant?: 'default' | 'destructive';
}

/** Short display name: uat/pan-otter-0610 → pan-otter-0610. */
export function shortName(name: string): string {
  return name.replace(/^uat\//, '');
}

export const MODE_CHIP: Record<BoardProject['mode'], string> = {
  auto: 'Auto-merge',
  hold: 'Holds for UAT',
};

export const TRAIN_SWITCH_LABEL = 'Train';
export const TRAIN_SWITCH_TITLE_ON = 'The merge train is on for this project. Turn it off to merge each ready PR on its own.';
export const TRAIN_SWITCH_TITLE_OFF = 'The merge train is off for this project. Turn it on to follow the merge train for all projects.';

/**
 * D4: with the train off nothing batches, and every ready PR still merges on
 * its own after the cooldown (only `OVERDECK_DISABLE_AUTO_MERGE=1` stops
 * automatic merges), so the banners say that rather than "nothing merges".
 */
export const TRAIN_OFF_BANNER = 'Train off. No batches assemble; each ready PR merges on its own after the cooldown.';
export const MASTER_OFF_BANNER = 'Merge train is off for all projects. No batches assemble; each ready PR merges on its own after the cooldown.';

/** The card's intro line, by mode and batch window (D4). */
export function introLine(project: Pick<BoardProject, 'mode' | 'polyrepo' | 'window' | 'cooldownMinutes'>): string {
  if (project.mode === 'hold') {
    const base = 'Ready features are tested together in a batch on a live UAT stack. Nothing reaches main until you merge the batch.';
    const repos = project.polyrepo ?? [];
    return repos.length > 1 ? `${base} Each feature spans ${repos.join(' + ')}.` : base;
  }
  if (project.window) {
    return `Ready features merge together in batches of ${project.window.size}, or after ${project.window.waitMinutes} minutes. High-priority PRs merge on their own ${project.cooldownMinutes} minutes after they are ready. Cancel stops them.`;
  }
  return `Each ready feature merges on its own ${project.cooldownMinutes} minutes after it is ready. Cancel stops it.`;
}

/** The queue section heading: hold projects batch everything, so their queue is what is not in a batch yet. */
export function queueHeading(mode: BoardProject['mode'], count: number): string {
  return mode === 'hold' ? `Not in a batch yet (${count})` : `Waiting to merge (${count})`;
}

/**
 * "Next batch in 12 min: 2 of 3 waiting" or "Next batch now: 3 of 3 waiting".
 * Null when nothing waits for the window.
 */
export function nextBatchLine(window: BatchWindowState | null, now: number): string | null {
  if (!window || window.waiting <= 0) return null;
  const at = window.nextBatchAt ? Date.parse(window.nextBatchAt) : NaN;
  const when = !Number.isFinite(at) || at - now <= 30_000 ? 'now' : `in ${Math.ceil((at - now) / 60_000)} min`;
  return `Next batch ${when}: ${window.waiting} of ${window.size} waiting`;
}

export function idleFooter(names: readonly string[]): string {
  return `${names.length} project${names.length === 1 ? '' : 's'} with nothing to merge: ${names.join(', ')}`;
}

export const LOADING_LINE = 'Loading the merge train…';
export const NO_PROJECTS_LINE = 'No projects are registered, so there is no merge train to show.';
export const ALL_FILTERED_LINE = 'Every project is filtered out. Select a project above to see its merge train.';
export const NOTHING_TO_MERGE_LINE = 'Nothing is waiting to merge. When work passes review and checks, it lines up here.';
export const LOAD_FAILED_LINE = 'Could not load the merge train.';
export const ALL_PROJECTS_CHIP = 'All projects';
export const FILTER_LABEL = 'Show';

// ─── Car pills ────────────────────────────────────────────────────────────

/** Blocker short names for the pill ("Blocked: conflict +1"). */
export const BLOCKER_SHORT: Record<BlockerType, string> = {
  failing_checks: 'failing checks',
  merge_conflict: 'conflict',
  unresolved_conversations: 'open threads',
  changes_requested: 'changes requested',
  draft_pr: 'draft',
  not_mergeable: 'not mergeable',
};

/** Blocker labels for the expanded "Blocked by" list. */
export const BLOCKER_LABEL: Record<BlockerType, string> = {
  failing_checks: 'Failing checks',
  merge_conflict: 'Merge conflict',
  unresolved_conversations: 'Unresolved conversations',
  changes_requested: 'Changes requested',
  draft_pr: 'Draft PR',
  not_mergeable: 'Not mergeable',
};

export function blockedPill(blockers: ReadonlyArray<{ type: BlockerType }>): string {
  const first = blockers[0];
  if (!first) return 'Blocked';
  const more = blockers.length - 1;
  return `Blocked: ${BLOCKER_SHORT[first.type]}${more > 0 ? ` +${more}` : ''}`;
}

/** `4:12` for 252 s left; never negative. */
export function countdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function cooldownPill(mergeAt: string | null, now: number): string {
  const at = mergeAt ? Date.parse(mergeAt) : NaN;
  return Number.isFinite(at) ? `Cooling down ${countdown(at - now)}` : 'Cooling down';
}

export function mergingPill(step: MergeStepKey | null): string {
  const index = step ? MERGE_STEPS.findIndex((s) => s.key === step) : -1;
  return index >= 0 ? `Merging · step ${index + 1} of ${MERGE_STEPS.length}` : 'Merging';
}

export const FAILED_PILL = 'Last merge failed';
export const HELD_PILL = 'Waiting for batch';
export const READY_PILL = 'Ready';

// ─── Step tracker ─────────────────────────────────────────────────────────

/** The nine merge steps (the pre-Cut AwaitingMergePage tracker). */
export const MERGE_STEPS: ReadonlyArray<{ key: MergeStepKey; label: string }> = [
  { key: 'queued', label: 'Queued in merge queue' },
  { key: 'validating-pr', label: 'Validating PR state' },
  { key: 'preparing-work-agent', label: 'Preparing work agent' },
  { key: 'rebasing', label: 'Rebasing onto main' },
  { key: 'stripping-planning', label: 'Stripping .planning/ artifacts' },
  { key: 'verifying', label: 'Post-rebase verification' },
  { key: 'reporting-statuses', label: 'Reporting commit statuses' },
  { key: 'squash-merging', label: 'Squash merge via forge' },
  { key: 'post-merge-cleanup', label: 'Post-merge cleanup' },
];

// ─── Car rows ─────────────────────────────────────────────────────────────

export function readyAgo(readyAt: string | null, now: number): string | null {
  const ago = formatAgo(readyAt, now);
  return ago ? `ready ${ago}` : null;
}

export const MERGE_POLICY_LABEL = 'Merge policy';
export const BLOCKED_BY_LABEL = 'Blocked by';
export const UAT_NOTES_LABEL = 'Reviewer UAT notes';

/** R3 / D2: merging a live-batch member alone voids its batch. */
export function mergeAloneConfirm(issueId: string, batchName: string): ConfirmCopy {
  return {
    title: `Merge ${issueId} alone?`,
    message: `Merge ${issueId} alone? This voids batch ${shortName(batchName)}; its other members wait for the next batch.`,
    confirmLabel: `Merge ${issueId} alone`,
    variant: 'destructive',
  };
}

export function mergeCarConfirm(issueId: string, projectName: string): ConfirmCopy {
  return {
    title: `Merge ${issueId} to main?`,
    message: `Merges ${issueId} to main in ${projectName} now, without waiting. The merge gate re-checks approval, checks and mergeability first.`,
    confirmLabel: `Merge ${issueId} to main`,
  };
}

export function retryCarConfirm(issueId: string): ConfirmCopy {
  return {
    title: `Retry the merge of ${issueId}?`,
    message: `Runs the merge of ${issueId} to main again. The merge gate re-checks approval, checks and mergeability first.`,
    confirmLabel: `Retry merge of ${issueId}`,
  };
}

// ─── Strike lane ──────────────────────────────────────────────────────────

export function strikeLaneHeading(count: number): string {
  return `Strike PRs (${count}) · front of the train`;
}

export const STRIKE_PILL: Record<StrikeState, string> = {
  'checks-pending': 'Checks running',
  reviewing: 'Bot review running',
  flagged: 'Flagged by review',
  'waiting-uat': 'Waits for UAT',
  queued: 'Merging next',
  merging: 'Merging',
  failed: 'Last merge failed',
  blocked: 'Blocked',
  ready: 'Approved',
};

export const STRIKE_REVIEW_CONFIRM: ConfirmCopy = {
  title: 'Merge without the bot review?',
  message: 'Merge without the bot review? The strike merges to main now, before its expedited review finishes.',
  confirmLabel: 'Merge without review',
  variant: 'destructive',
};

export function strikeMergeConfirm(issueId: string, prNumber: number): ConfirmCopy {
  return {
    title: `Merge strike ${issueId} to main?`,
    message: `Merges strike PR #${prNumber} for ${issueId} to main now. The merge gate re-checks checks and mergeability first.`,
    confirmLabel: `Merge ${issueId} to main`,
  };
}

// ─── Batches ──────────────────────────────────────────────────────────────

/** The status badge text of a batch card. */
export function batchStatusText(gen: Pick<UatGenerationPayload, 'status' | 'shipStatus' | 'versionSyncConfigured'>): string {
  switch (gen.status) {
    case 'ready': return 'ready to test';
    case 'assembling': return 'assembling';
    case 'superseded': return 'superseded';
    case 'invalidated': return 'voided';
    case 'failed': return 'assembly failed';
    case 'promoted': {
      const version = gen.shipStatus?.status === 'passed' ? gen.shipStatus.version : undefined;
      return version ? `merged · v${version} shipped` : 'merged · version not shipped';
    }
    default: return gen.status;
  }
}

/** The one-word status an older batch row names. */
export function olderBatchStatus(status: UatGenerationPayload['status']): string {
  switch (status) {
    case 'invalidated': return 'voided';
    case 'promoted': return 'merged';
    case 'failed': return 'assembly failed';
    default: return status;
  }
}

export const SHOW_LABEL = 'show';
export const HIDE_OLDER_LABEL = 'hide older batch';

export function builtAgo(createdAt: string, now: number): string | null {
  const ago = formatAgo(createdAt, now);
  return ago ? `built ${ago}` : null;
}

export function resolvedLine(resolutions: UatGenerationPayload['resolutions']): string {
  const n = resolutions.length;
  const detail = resolutions.map((r) => `${r.issueIds.join(' ↔ ')} · ${r.files.join(', ')} @ ${r.commitSha.slice(0, 7)}`).join('; ');
  return `✓ ${n} conflict${n === 1 ? '' : 's'} resolved in batch: ${detail}`;
}

export function mergeBatchLabel(memberCount: number): string {
  return `Merge batch (${memberCount}) to main`;
}

export const MERGE_BATCH_CONFIRM_NOTE = 'Lands exactly the tree you tested.';
export const REBUILD_LABEL = 'Rebuild';
export const SHIP_VERSION_LABEL = 'Ship version';
export const OPEN_UAT_LABEL = 'Open UAT';
export const START_UAT_LABEL = 'Start & open';
export const MERGE_ALONE_LABEL = 'Merge alone…';

export function whatToUatLabel(count: number): string {
  return `What to UAT (${count})`;
}

export const PLAN_NOT_FOUND_LINE = 'Plan not found: no acceptance criteria. Exercise the feature described above.';
export const NO_UAT_STEPS_LINE = 'No UAT steps in the plan. Exercise the feature described above.';

/** WI-9: promote refused because the batch's UAT stack is not running. */
export const STACK_UNHEALTHY_MERGE_ANYWAY = 'Merge anyway…';
export const STACK_OVERRIDE_REASON_LABEL = 'Why merge without a healthy UAT stack?';
export const STACK_OVERRIDE_REASON_REQUIRED = 'A reason is required to merge without a healthy UAT stack.';
export const STACK_OVERRIDE_SUBMIT = 'Merge with this reason';

// ─── Recent merges ────────────────────────────────────────────────────────

export function recentSummary(recent: readonly RecentMerge[], now: number): string | null {
  const last = recent[0];
  if (!last) return null;
  const ago = formatAgo(last.mergedAt, now);
  return `${last.issueIds.join(', ')}${ago ? ` · ${ago}` : ''}`;
}

export const LAST_MERGED_LABEL = 'Last merged:';

export function showRecentLabel(count: number): string {
  return `show ${count}`;
}

export const HIDE_RECENT_LABEL = 'hide';

export function recentVia(merge: RecentMerge): string {
  switch (merge.via) {
    case 'auto-merge': return 'auto-merge';
    case 'batch': return `batch ${merge.batchName ? shortName(merge.batchName) : ''}${merge.version ? ` · v${merge.version}` : ''}`.trim();
    case 'overdeck': return 'Overdeck';
    case 'outside-train': return 'outside the train';
  }
}

// ─── Policy toggle ────────────────────────────────────────────────────────

export const POLICY_READ_ONLY_TITLE = 'Set the auto-merge / hold-for-uat label in the tracker';
export const POLICY_DEFAULT_MARKER = 'default';

// ─── Time ─────────────────────────────────────────────────────────────────

/** `22m ago`, `3h ago`, `2d ago`, `just now`; null when unreadable. */
export function formatAgo(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
