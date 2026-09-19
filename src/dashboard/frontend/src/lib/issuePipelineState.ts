import type { BackendPane, DerivedIssueState } from '../types';

/**
 * The dashboard's internal lifecycle vocabulary. PAN-3917: every value is a
 * projection of the derived issue state (FR-6) plus the terminal backend's own
 * pane inventory — nothing here reads a stored status field. The states that
 * only a stored field could produce (testing, verification, merging, verifying
 * on main) are gone with it.
 */
export type PipelineState =
  | 'planning_active'
  | 'planning_done_awaiting_work'
  | 'in_progress_work_running'
  | 'in_progress_work_idle'
  | 'in_review_reviewers_running'
  | 'in_review_changes_requested'
  | 'in_review_approved'
  | 'ready_to_merge'
  | 'merged'
  | 'done'
  | 'canceled'
  | 'generic';

export interface PipelineStateInput {
  derived?: DerivedIssueState | null;
  /** Backend panes whose `issue` token names this issue. */
  panes?: readonly BackendPane[];
  /** Tracker canonical state — the only thing that separates canceled from done. */
  issueCanonicalState?: string | null;
}

const LIVE_PANE_STATES = new Set<BackendPane['state']>(['idle', 'working', 'blocked']);

export function normalizeCanonicalState(state?: string | null): string | null {
  if (!state) return null;
  return state.trim().toLowerCase().replace(/[-\s]+/g, '_');
}

/** A pane the backend still owns — anything but `done`/`exited`/`unknown`. */
export function isPaneLive(pane: Pick<BackendPane, 'state'>): boolean {
  return LIVE_PANE_STATES.has(pane.state);
}

export function hasLivePane(panes: readonly BackendPane[] | undefined, role: BackendPane['role']): boolean {
  return (panes ?? []).some((pane) => pane.role === role && isPaneLive(pane));
}

export function derivePipelineState(input: PipelineStateInput): PipelineState {
  const { derived, panes } = input;
  if (normalizeCanonicalState(input.issueCanonicalState) === 'canceled') return 'canceled';
  if (!derived) return 'generic';

  switch (derived.state) {
    case 'merged':
      return 'merged';
    case 'closed':
      return 'done';
    case 'ready':
      return 'ready_to_merge';
    case 'changes-requested':
      return 'in_review_changes_requested';
    case 'in-review':
      return derived.pr?.reviewState === 'APPROVED' ? 'in_review_approved' : 'in_review_reviewers_running';
    case 'working':
      return hasLivePane(panes, 'work') ? 'in_progress_work_running' : 'in_progress_work_idle';
    case 'planned':
      return hasLivePane(panes, 'plan') ? 'planning_active' : 'planning_done_awaiting_work';
    default:
      return 'generic';
  }
}
