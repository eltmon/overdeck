/**
 * commandDeckActions — pure mapping from pipeline state → action surface for the
 * unified Command Deck (PAN-830, blocker-2 in 001-review-agent-changes-requested).
 *
 * The PRD's core goal is "single, complete surface" — every action reachable
 * elsewhere (IssueCard, InspectorPanel, BadgeBar, StatusFlowControl,
 * WorkspacePane) must also be reachable from the three Command Deck zones.
 *
 * This module exposes two pure functions:
 *
 *   - `getZoneAActions(input)` returns the issue-scoped action keys, partitioned
 *     into `primary` (always rendered inline), `secondary` (rendered inline as
 *     room allows), and `overflow` (folded into the `…` menu when the action
 *     surface gets crowded).
 *
 *   - `getZoneBActions(input)` returns the session-scoped action keys for the
 *     focused session.
 *
 * The functions are pure — no React, no hooks, no side effects — so they can be
 * exercised directly in unit tests. The actual rendering happens in
 * `ZoneActionStrip.tsx`, which translates `ActionKey` values into the existing
 * action button components (`MergeButton`, `StopAgentButton`, `RecoverButton`,
 * etc.) so behaviour is identical to the inspector / kanban card surfaces.
 */

import type { ReviewStatus, WorkspaceInfo } from '../components/inspector/types';
import type { Agent, WorkAgentLifecycle } from '../types';
import { isReviewPipelineStuck } from './pipeline-state';

// ─── Action vocabulary ────────────────────────────────────────────────────────

/**
 * A canonical key for every distinct action the Command Deck can present.
 *
 * NB: these strings are matched verbatim by `ZoneActionStrip` and the parity
 * smoke test, so extend with care — adding a new key without a renderer leaves
 * the action invisible. Renaming a key without updating the renderer breaks the
 * mapping silently.
 */
export type ActionKey =
  // Workspace / pipeline actions
  | 'merge'
  | 'reviewTest'
  | 'recover'
  | 'stopAgent'
  | 'startAgent'
  | 'resumeSession'
  | 'resetSession'
  | 'createWorkspace'
  | 'copySettings'
  // Issue artifact / planning surface
  | 'beads'
  | 'vbrief'
  | 'state'
  | 'prd'
  | 'inference'
  | 'discussions'
  | 'transcripts'
  | 'upload'
  | 'syncDiscussions'
  | 'statusReview'
  // Danger zone
  | 'reopen'
  | 'restartFromPlan'
  | 'resetIssue'
  | 'cancel'
  // Session-scoped actions (Zone B)
  | 'stopSession'
  | 'viewTerminal';

/** Partitioned action lists. `primary` always renders inline; `overflow` folds. */
export interface ActionLayout {
  primary: ActionKey[];
  secondary: ActionKey[];
  overflow: ActionKey[];
}

// ─── Zone A inputs ────────────────────────────────────────────────────────────

export interface ZoneAInput {
  reviewStatus?: ReviewStatus | null;
  agent?: Pick<Agent, 'status'> | null;
  lifecycle?: Pick<WorkAgentLifecycle, 'canResumeSession'> | null;
  workspace?: Pick<WorkspaceInfo, 'exists'> | null;
  hasPlan: boolean;
  beadsCount: number;
  hasInference: boolean;
  hasTranscripts: boolean;
  hasDiscussions: boolean;
  /** Canonical state (lowercased) — e.g. `'done'`, `'canceled'`, `'in_progress'`. */
  issueCanonicalState?: string | null;
  /** When true the merge has already landed — danger zone collapses. */
  isMerged?: boolean;
}

// ─── Zone B inputs ────────────────────────────────────────────────────────────

export interface ZoneBInput {
  presence: 'active' | 'idle' | 'ended' | string;
  type: string;
  /** When true the session has a tmux pane available so we can deep-link. */
  hasTerminal?: boolean;
}

// ─── Pure mappers ─────────────────────────────────────────────────────────────

/**
 * Compute the issue-scoped action surface for Zone A.
 *
 * The split between primary / secondary / overflow is deterministic and stable
 * — the renderer can apply density rules (REQ-D6) on top by collapsing more
 * keys into overflow without changing the inputs.
 */
export function getZoneAActions(input: ZoneAInput): ActionLayout {
  const { reviewStatus, agent, lifecycle, workspace } = input;
  const merged = input.isMerged === true || reviewStatus?.mergeStatus === 'merged';
  const agentRunning = !!agent && agent.status !== 'stopped' && agent.status !== 'failed' && agent.status !== 'dead';
  const noAgentOrStopped = !agent || agent.status === 'stopped';
  const isResume = noAgentOrStopped && lifecycle?.canResumeSession === true;

  const stuck = isReviewPipelineStuck(reviewStatus ?? undefined);
  const readyForMerge = !!reviewStatus?.readyForMerge && !merged;

  const primary: ActionKey[] = [];
  const secondary: ActionKey[] = [];
  const overflow: ActionKey[] = [];

  // ── Workspace / pipeline ───────────────────────────────────────────────────
  // Merge is the most-promoted action whenever it's available.
  if (readyForMerge) {
    primary.push('merge');
  }

  // Review & Test is contextual: promote to primary when the pipeline is
  // failed/blocked or ready for re-review; otherwise demote to secondary so the
  // density rule can hide it in default state (REQ-D6).
  const reviewTestPromoted = stuck || readyForMerge
    || reviewStatus?.reviewStatus === 'failed'
    || reviewStatus?.reviewStatus === 'blocked'
    || reviewStatus?.testStatus === 'failed'
    || reviewStatus?.testStatus === 'dispatch_failed'
    || reviewStatus?.mergeStatus === 'failed';
  if (reviewTestPromoted) {
    primary.push('reviewTest');
  } else if (reviewStatus) {
    secondary.push('reviewTest');
  }

  if (stuck) {
    primary.push('recover');
  }

  if (agentRunning) {
    primary.push('stopAgent');
  } else if (noAgentOrStopped && !merged) {
    primary.push(isResume ? 'resumeSession' : 'startAgent');
    if (isResume) secondary.push('resetSession');
    if (workspace?.exists) {
      secondary.push('copySettings');
    } else {
      secondary.push('createWorkspace');
    }
  }

  // ── Artifacts / planning ──────────────────────────────────────────────────
  if (input.beadsCount > 0 || input.hasPlan) secondary.push('beads');
  if (input.hasPlan) secondary.push('vbrief');
  secondary.push('state', 'prd');
  if (input.hasInference) secondary.push('inference');
  if (input.hasDiscussions) secondary.push('discussions');
  if (input.hasTranscripts) secondary.push('transcripts');
  secondary.push('statusReview', 'syncDiscussions', 'upload');

  // ── Danger zone (always overflow — shown via "…" menu) ────────────────────
  if (!merged) {
    if (input.issueCanonicalState === 'done' || input.issueCanonicalState === 'canceled') {
      overflow.push('reopen');
    }
    overflow.push('restartFromPlan');
    if (input.issueCanonicalState !== 'done' && input.issueCanonicalState !== 'canceled') {
      overflow.push('resetIssue');
    }
    overflow.push('cancel');
  }

  return { primary, secondary, overflow };
}

/**
 * Compute the session-scoped action surface for Zone B.
 *
 * Sessions only expose two contextual actions today: `stopSession` for any
 * non-terminal presence, and `viewTerminal` when a pane is available. The
 * vocabulary is intentionally narrow so it doesn't shadow Zone A's
 * issue-scoped controls — the bulk of action parity lives there.
 */
export function getZoneBActions(input: ZoneBInput): ActionLayout {
  const primary: ActionKey[] = [];
  const secondary: ActionKey[] = [];
  const overflow: ActionKey[] = [];

  if (input.presence === 'active' || input.presence === 'idle') {
    primary.push('stopSession');
  }
  if (input.hasTerminal) {
    secondary.push('viewTerminal');
  }

  return { primary, secondary, overflow };
}

/**
 * Convenience: flatten an `ActionLayout` to a single array, preserving the
 * primary / secondary / overflow order. Useful for parity tests and for
 * callers that don't care about the layout split.
 */
export function flattenActions(layout: ActionLayout): ActionKey[] {
  return [...layout.primary, ...layout.secondary, ...layout.overflow];
}
