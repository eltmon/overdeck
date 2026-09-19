import type { SessionNode } from '@overdeck/contracts';
import type {
  ActivityResponse,
  IssueCostData,
  WorkspaceData,
} from '../CommandDeck/ZoneCOverviewTabs/queries';
import type { BackendPane, DerivedIssueState } from '../../types';

/**
 * IssueViewModel — the single data model for every density of the unified issue view.
 *
 * One hook derives this object from the existing queries + the dashboard store.
 * The rail, cockpit, and console adapters will all consume this shape (PAN-2499).
 */
export interface IssueViewModel {
  header: IssueHeaderModel;
  narrative: IssueNarrativeModel;
  pipeline: IssuePipelineModel;
  agents: AgentRowModel[];
  verification: IssueVerificationModel;
  ship: IssueShipModel;
  activity: IssueActivityModel;
  resources: IssueResourcesModel;
  operator: IssueOperatorModel;
}

export interface IssueHeaderModel {
  issueId: string;
  title?: string;
  branch?: string;
  projectName?: string;
  /** The issue's derived state (FR-6), e.g. 'working', 'in-review', 'merged'. */
  phase: string;
  /** Resolved total cost formatted for display, e.g. "$1.23". */
  cost?: string;
  prNumber?: number;
  prUrl?: string;
}

export interface IssueNarrativeModel {
  /** One-line description of what is happening right now. */
  now: string;
  /** One-line next action for the operator. */
  nextAction: string;
  recentEvents: IssueStatusEvent[];
}

export interface IssueStatusEvent {
  type: string;
  status: string;
  timestamp: string;
}

export interface IssuePipelineModel {
  plan: PipelineStepModel;
  work: PipelineStepModel;
  review: PipelineStepModel;
  test: PipelineStepModel;
  ship: PipelineStepModel;
}

export interface PipelineStepModel {
  status: string;
  active: boolean;
  done: boolean;
}

/**
 * AgentRowModel — one row in the unified agents list.
 *
 * Derived from contracts SessionNode + the backend pane inventory. The icon key is a
 * UI-agnostic identifier; the rendering layer maps it to the appropriate icon.
 */
export interface AgentRowModel {
  sessionId: string;
  type: SessionNode['type'];
  /** Display label for the row, e.g. "Work", "Slot 2", "Reviewer". */
  label: string;
  /** Icon key derived from type/role, e.g. "work", "reviewer-correctness". */
  icon: string;
  /** Specialist role when type === 'reviewer'. */
  role?: string;
  /** Human-readable status label. */
  status: string;
  /** True when the agent is actively running right now. */
  active: boolean;
  /** Short model name, e.g. "sonnet-5" instead of "claude-sonnet-5". */
  model: string;
  /** Harness that spawned the session (claude-code | pi | codex). */
  harness?: string;
  /** Session start timestamp used by run-detail surfaces. */
  startedAt: string;
  /** Formatted cost string, e.g. "$1.23 · 4.5k tok", when available. */
  cost?: string;
  /** Session duration in seconds, or null. */
  duration: number | null;
  /** Reviewer verdict, if this row represents a reviewer. */
  verdict: 'approved' | 'changes_requested' | 'failed' | null;
  /** True when the session is awaiting operator input. */
  pendingInput: boolean;
}

/**
 * PAN-3917 — verification is the PR's check runs (FR-8). Nothing stores a
 * verification status, so there is one gate and it is the forge's answer.
 */
export interface IssueVerificationModel {
  status: 'pending' | 'passed' | 'failed';
  gates: VerificationGateModel[];
}

export interface VerificationGateModel {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
}

/**
 * PAN-3917 — the merge door writes no record, so ship progress is what the
 * forge says: is the PR mergeable, are its checks green, has it merged.
 */
export interface IssueShipModel {
  status: 'pending' | 'ready' | 'merged';
  prUrl?: string;
  prNumber?: number;
  checks?: 'green' | 'red' | 'pending';
  mergeable?: boolean;
  blockerReason?: string;
}

export interface IssueActivityModel {
  sections: ActivityResponse['sections'];
  totalCost: number;
  aggregateCost: number | null;
}

export interface IssueResourcesModel {
  exists: boolean;
  workspace?: WorkspaceData;
}

export interface IssueOperatorModel {
  /** Legacy primary operator state retained for existing density consumers. */
  needsYou: OperatorNeedsYou | null;
  /** Every active cockpit needs-you signal, ordered by operator priority. */
  needsYouItems: OperatorNeedsYou[];
}

export interface OperatorNeedsYou {
  kind:
    | 'awaiting_input'
    | 'stuck'
    | 'paused'
    | 'blocker'
    | 'pickup_gate'
    | 'stopped'
    | 'ready_for_merge';
  sessionId?: string;
  reason?: string;
  prompt?: string;
}

/** Raw data sources passed into the view builder. */
export interface IssueViewInputs {
  issueId: string;
  title?: string;
  branch?: string;
  projectName?: string;
  derived?: DerivedIssueState;
  panes?: readonly BackendPane[];
  costs?: IssueCostData;
  workspace?: WorkspaceData;
  activity?: ActivityResponse;
  agentsById: Record<string, import('@overdeck/contracts').AgentSnapshot>;
}
