/**
 * PAN-3903: the pipeline READ DOOR.
 *
 * Before this module, 93 files (37 under `src/lib/cloister/`) each read the
 * `review_status` store on their own, and the two readers did not even agree:
 * `getReviewStatusSync` reconciles the durable journal on read, while
 * `loadReviewStatuses` returns the raw SQLite cache. A patrol that took one
 * snapshot could not tell whether another actor was already mid-transition, so
 * it acted on a state someone else owned. That is PAN-3842: `reviewStaleSince`
 * was set at 07:30 with "no automatic re-dispatch" by design, and
 * `checkOrphanedCompletions` then "recovered" the issue nine times in
 * forty-five minutes, stacking a review convoy on top of the work agent's own
 * re-review.
 *
 * This module is the only place under `src/lib/cloister/` allowed to touch
 * `review_status` (enforced by `scripts/lint-pipeline-read-door.sh`). It answers
 * two questions together, so they can never disagree:
 *
 *   1. what state is this issue in, and
 *   2. **who owns the current transition** (`inFlightOwner`).
 *
 * A patrol whose action is a pipeline transition write must skip an issue with
 * a non-null owner. A patrol that only reports, classifies agents, or *is* the
 * owner must ignore it — see `docs/PIPELINE-GATES.md`.
 */

import {
  getReviewStatusSync,
  getReviewStatusesSync,
  loadReviewStatuses,
} from '../review-status.js';
import { needsReviewDispatch } from '../review-dispatch-decision.js';
import type { ReviewStatus } from '../review-status-reconcile.js';

export type PipelineOwnerActor =
  | 'review'
  | 'test'
  | 'uat'
  | 'verification'
  | 'merge'
  | 'strike'
  | 'conflict-resolution'
  | 'work';

/** Who is already handling this issue's next transition, and since when. */
export interface PipelineOwner {
  actor: PipelineOwnerActor;
  /** ISO timestamp the ownership was established (falls back to the row's `updatedAt`). */
  since: string;
  /** Human-readable transition the owner is performing, for the skip log line. */
  transition: string;
}

/** The canonical pipeline answer for one issue. */
export interface PipelineView {
  issueId: string;
  status: ReviewStatus;
  /** Non-null when another actor is mid-transition; acting patrols must skip. */
  inFlightOwner: PipelineOwner | null;
}

const TERMINAL_REVIEW = new Set(['passed', 'failed', 'blocked', 'skipped']);

function isoOr(updatedAt: string, ...candidates: Array<string | number | undefined>): string {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === 'number') return new Date(candidate).toISOString();
    if (candidate) return candidate;
  }
  return updatedAt;
}

/**
 * Derive the in-flight owner from durable transition writes alone — never from
 * tmux, a live pane, or agent liveness. Every marker below is a field some
 * actor wrote when it took the transition, so a dead actor's claim is visible
 * to the recovery patrols that exist to revive it (which is why auto-resume and
 * the crash/stuck handlers deliberately do NOT skip on an owner).
 *
 * Precedence runs latest-stage first: a merge claim outranks a review claim,
 * because an issue that reached the merge queue is no longer the reviewer's.
 */
export function deriveInFlightOwner(status: ReviewStatus | null | undefined): PipelineOwner | null {
  if (!status) return null;
  if (status.retiredAt) return null;
  if (status.mergeStatus === 'merged') return null;

  const at = status.updatedAt;

  if (status.mergeStatus === 'queued' || status.mergeStatus === 'merging' || status.mergeStatus === 'verifying') {
    return { actor: 'merge', since: at, transition: `merge ${status.mergeStatus}` };
  }

  // `ready` is unclaimed (the salvage patrol's job is to land it) and `landed`
  // is terminal; `landing`/`recovering` are claimed and `needs_you` is the
  // operator's. PAN-3898: re-arming a strike in any of the latter three is the
  // double-action bug.
  if (
    status.strikeLandingState === 'landing'
    || status.strikeLandingState === 'recovering'
    || status.strikeLandingState === 'needs_you'
  ) {
    return {
      actor: 'strike',
      since: isoOr(at, status.strikeNextAttemptAt, status.strikeReadyAt),
      transition: `strike landing ${status.strikeLandingState}`,
    };
  }

  if (status.verificationStatus === 'running') {
    return { actor: 'verification', since: at, transition: 'verification running' };
  }

  if (status.uatStatus === 'testing') {
    return { actor: 'uat', since: at, transition: 'uat running' };
  }

  if (status.testStatus === 'testing') {
    return { actor: 'test', since: at, transition: 'test running' };
  }

  if (status.reviewStatus === 'reviewing') {
    return {
      actor: 'review',
      since: isoOr(at, status.reviewSpawnedAt),
      transition: 'review convoy running',
    };
  }

  if (status.conflictResolutionDispatchedAt && !TERMINAL_REVIEW.has(status.reviewStatus)) {
    return {
      actor: 'conflict-resolution',
      since: status.conflictResolutionDispatchedAt,
      transition: 'conflict resolution dispatched',
    };
  }

  // A review convoy was spawned and has not reported a terminal verdict yet.
  if (status.reviewSpawnedAt && !TERMINAL_REVIEW.has(status.reviewStatus)) {
    return {
      actor: 'review',
      since: isoOr(at, status.reviewSpawnedAt),
      transition: 'review convoy dispatched',
    };
  }

  // PAN-3847: a passed review whose anchor drifted. The row deliberately carries
  // "no automatic re-dispatch" — only `pan done` or `pan review request` clears
  // it — so the work agent owns the next transition. This is the PAN-3842 case.
  if (status.reviewStaleSince) {
    return {
      actor: 'work',
      since: status.reviewStaleSince,
      transition: 'rework after post-review commits (review stale)',
    };
  }

  // A terminal failure was routed back to the work agent; the work agent owns
  // the fix. Recovery patrols that revive a dead work agent must not skip here.
  const failed =
    (status.reviewStatus === 'failed' && 'review')
    || (status.testStatus === 'failed' && 'test')
    || (status.verificationStatus === 'failed' && 'verification')
    || (status.uatStatus === 'failed' && 'uat')
    || null;
  if (failed && !status.readyForMerge) {
    return { actor: 'work', since: at, transition: `rework after ${failed} failed` };
  }

  // PAN-1988: `pan done` wrote a review request that the reactive dispatcher has
  // not serviced yet. Re-requesting review on top of it is a duplicate convoy.
  if (needsReviewDispatch(status)) {
    return {
      actor: 'work',
      since: isoOr(at, status.reviewRequestedAt),
      transition: 'review requested by pan done, dispatch pending',
    };
  }

  return null;
}

function toView(issueId: string, status: ReviewStatus | null): PipelineView | null {
  if (!status) return null;
  return { issueId, status, inFlightOwner: deriveInFlightOwner(status) };
}

/** The canonical single-issue read. Journal-reconciled. */
export function getPipelineView(issueId: string): PipelineView | null {
  return toView(issueId, getReviewStatusSync(issueId));
}

/**
 * The canonical bulk read, keyed by issue id.
 *
 * Deliberately routed through `getReviewStatusesSync` rather than the raw
 * `loadReviewStatuses` cache read: the single-issue door reconciles the durable
 * journal, and a bulk door that skipped that step would answer differently for
 * the same issue — the exact divergence PAN-3903 exists to remove.
 */
export function listPipelineViews(): Record<string, PipelineView> {
  const ids = Object.keys(loadReviewStatuses());
  return listPipelineViewsForIssues(ids);
}

/** The canonical bulk read restricted to `issueIds`. */
export function listPipelineViewsForIssues(issueIds: string[]): Record<string, PipelineView> {
  const statuses = getReviewStatusesSync(issueIds);
  const views: Record<string, PipelineView> = {};
  for (const [issueId, status] of Object.entries(statuses)) {
    const view = toView(issueId, status);
    if (view) views[issueId] = view;
  }
  return views;
}

/** Bulk read that yields the raw statuses, for readers that only display them. */
export function listPipelineStatuses(): Record<string, ReviewStatus> {
  const views = listPipelineViews();
  return Object.fromEntries(Object.entries(views).map(([id, view]) => [id, view.status]));
}

/** The single-issue status without the owner, for readers that only display it. */
export function getPipelineStatus(issueId: string): ReviewStatus | null {
  return getPipelineView(issueId)?.status ?? null;
}

/** One-line skip reason for a patrol that declines to act on an owned issue. */
export function describeOwner(issueId: string, owner: PipelineOwner): string {
  return `${issueId} is owned by ${owner.actor} since ${owner.since} (${owner.transition})`;
}
