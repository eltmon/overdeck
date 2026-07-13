import type { SessionNode } from '@overdeck/contracts';
import type {
  ActivityResponse,
  IssueCostData,
  ReviewStatusData,
  WorkspaceData,
} from '../CommandDeck/ZoneCOverviewTabs/queries';

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
  beads: IssueBeadsModel;
  activity: IssueActivityModel;
  resources: IssueResourcesModel;
  operator: IssueOperatorModel;
}

export interface IssueHeaderModel {
  issueId: string;
  title?: string;
  branch?: string;
  projectName?: string;
  /** Canonical pipeline phase (plan | work | review | test | ship | merged | verifying). */
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
 * Derived from contracts SessionNode + ReviewStatusData. The icon key is a
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
  /** Formatted cost string, e.g. "$1.23 · 4.5k tok", when available. */
  cost?: string;
  /** Session duration in seconds, or null. */
  duration: number | null;
  /** Reviewer verdict, if this row represents a reviewer. */
  verdict: 'approved' | 'changes_requested' | 'failed' | null;
  /** True when the session is awaiting operator input. */
  pendingInput: boolean;
}

export interface IssueVerificationModel {
  status: string;
  cycle?: string;
  gates: VerificationGateModel[];
}

export interface VerificationGateModel {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
}

export interface IssueShipModel {
  status: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed' | 'ready';
  readyForMerge: boolean;
  mergeStep: string | null;
  blockerReason?: string;
}

export interface IssueBeadsModel {
  total: number;
  completed: number;
  percent: number;
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
  /** Non-null when the operator must act before the pipeline can proceed. */
  needsYou: OperatorNeedsYou | null;
}

export interface OperatorNeedsYou {
  kind: 'troubled' | 'paused' | 'stopped' | 'ready_for_merge';
  sessionId?: string;
  reason?: string;
}

/** Raw data sources passed into the view builder. */
export interface IssueViewInputs {
  issueId: string;
  title?: string;
  branch?: string;
  projectName?: string;
  reviewStatus?: ReviewStatusData;
  costs?: IssueCostData;
  workspace?: WorkspaceData;
  activity?: ActivityResponse;
  agentsById: Record<string, import('@overdeck/contracts').AgentSnapshot>;
}
