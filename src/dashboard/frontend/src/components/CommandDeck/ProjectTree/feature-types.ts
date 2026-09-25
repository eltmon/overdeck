import type { IssueState, PipelineBucket, SessionNode } from '@overdeck/contracts';

/**
 * The ProjectFeature/resource type family, split out of ProjectNode.tsx so
 * leaf components (ResourceCluster, pipelineStrip) can depend on the shapes
 * without importing ProjectNode — which imports FeatureItem, which would
 * otherwise import back into ProjectNode and cycle.
 */

export type ResourceSource = 'tracker' | 'tmux' | 'workspace' | 'branch' | 'pr' | 'prd' | 'vbrief' | 'tasks' | 'docker' | 'remote-agent' | 'conversation';

export interface ProjectFeatureResourceDetails {
  hasWorkspace: boolean;
  localBranchCount: number;
  remoteBranchCount: number;
  tmuxSessionCount: number;
  prs: Array<{
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
  }>;
  hasXbrief: boolean;
  hasTasks: boolean;
  hasPrd: boolean;
  dockerContainerCount: number;
  /** PAN-1523: actual HEAD of the agent's workspace, or null when workspace is missing. */
  actualBranch?: string | null;
  /** PAN-1523: true when workspace HEAD differs from expected feature/<id> branch. */
  branchDrifted?: boolean;
  /** PAN-2602: true when a feature/* or bypass/* branch for the issue has unmerged commits not on main. */
  branchAheadOfMain?: boolean;
  /** PAN-1523: true when workspace path is configured but missing on disk. */
  workspaceMissing?: boolean;
  /** PAN-1676: remote (fly.io) work agent for this issue, when one is active. */
  remoteAgent?: { vmName: string; status: string; model: string; startedAt: string } | null;
  /** Non-archived conversations explicitly linked to this issue (PAN-2602). */
  conversations: Array<{ id: number; name: string; title: string | null; status: string }>;
}

export interface ProjectFeatureResourceIdentifiers {
  workspacePaths: string[];
  localBranchNames: string[];
  remoteBranchNames: string[];
  tmuxSessionNames: string[];
  prs: Array<{
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
  }>;
  dockerContainerNames: string[];
}

export interface ProjectFeature {
  issueId: string;
  title: string;
  projectName: string;
  branch: string;
  status: string;
  stateLabel: string;
  /** Derived issue state (PAN-3917 FR-6) from /api/issues/resource-allocated; null when not derived. */
  state?: IssueState | null;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  cost?: number;
  isRally?: boolean;
  childCount?: number;
  completedCount?: number;
  inProgressCount?: number;
  rawTrackerState?: string;
  pipelineBucket?: PipelineBucket;
  specOnlyPlanned?: boolean;
  sessions?: readonly SessionNode[];
  resourceSources?: ResourceSource[];
  resourceDetails?: ProjectFeatureResourceDetails;
  /** PAN-2602: per-issue task rollup totals from the cached bulk rollup. */
  taskTotals?: { total: number; closed: number; inProgress: number; lastUpdated: string | null } | null;
}
