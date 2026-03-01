export interface LinearProject {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

export type IssueSource = 'linear' | 'github' | 'gitlab' | 'jira' | 'rally';

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  assignee?: {
    name: string;
    email: string;
  };
  labels: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;  // ISO timestamp when issue was completed/canceled
  project?: LinearProject;
  source?: IssueSource;
  sourceRepo?: string;
  shadowStatus?: 'open' | 'in_progress' | 'closed';  // Shadow mode status tracking
  targetCanonicalState?: CanonicalState;  // Explicit column placement from drag-drop
  shadowedAt?: string;  // When shadow state was created
  parentRef?: string;  // Parent issue FormattedID (e.g., "F1234") for Rally hierarchy
  artifactType?: string;  // Rally artifact type (e.g., "HierarchicalRequirement", "PortfolioItem/Feature")
  rawTrackerState?: string;  // Original Rally state name (e.g., "Discovering", "In-Progress")
  derivedStatus?: string;  // Computed from children: 'in_progress' | 'closed'
  shadowTrackerStatus?: string;  // What the tracker actually says (from shadow state cache)
  totalChildCount?: number;  // Total children across all columns
  completedChildCount?: number;  // Children in Done state
  inProgressChildCount?: number;  // Children in active work
  mergeStatus?: 'pending' | 'merging' | 'merged' | 'failed';  // From review-status, set by specialist pipeline
}

export interface GitStatus {
  branch: string;
  uncommittedFiles: number;
  latestCommit: string;
}

export interface Agent {
  id: string;
  issueId?: string;
  runtime: string;
  model: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead' | 'stopped';
  pid?: number;
  startedAt: string;
  lastActivity?: string;
  consecutiveFailures: number;
  killCount: number;
  workspace?: string;
  workspaceLocation?: 'local' | 'remote';
  git?: GitStatus;
  type?: 'agent';
  hasPendingQuestion?: boolean;
  pendingQuestionCount?: number;
}

export interface AgentHealth {
  agentId: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead';
  reason?: string;
  lastPing?: string;
  consecutiveFailures: number;
  killCount: number;
}

export interface Skill {
  name: string;
  path: string;
  source: 'panopticon' | 'claude';
  hasSkillMd: boolean;
  description?: string;
}

// Panopticon's canonical states (richer than most trackers)
export type CanonicalState =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'canceled';

// For backward compatibility
export type IssueStatus = CanonicalState;

export const STATUS_ORDER: CanonicalState[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done'
];

// Map tracker state names to canonical states
export const STATUS_LABELS: Record<string, CanonicalState> = {
  // Backlog states
  'Backlog': 'backlog',
  'Triage': 'backlog',
  'Unknown': 'backlog',

  // Todo states
  'Todo': 'todo',
  'To Do': 'todo',
  'Ready': 'todo',
  'Unstarted': 'todo',

  // In Progress states
  'In Progress': 'in_progress',
  'Started': 'in_progress',
  'Active': 'in_progress',

  // In Review states
  'In Review': 'in_review',
  'Review': 'in_review',
  'QA': 'in_review',
  'Testing': 'in_review',

  // Done states
  'Done': 'done',
  'Completed': 'done',
  'Closed': 'done',

  // Canceled states (separate from done)
  'Canceled': 'canceled',
  'Cancelled': 'canceled',
  'Duplicate': 'canceled',
  'Won\'t Do': 'canceled',
  'Wontfix': 'canceled',
};

// State type categories (from Linear)
export type StateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export const STATE_TYPE_MAP: Record<CanonicalState, StateType> = {
  backlog: 'backlog',
  todo: 'unstarted',
  in_progress: 'started',
  in_review: 'started',
  done: 'completed',
  canceled: 'canceled',
};

// Panopticon's virtual state tracking
export interface PanopticonIssueState {
  issueId: string;
  panopticonState: CanonicalState;  // Our canonical state
  trackerState: string;              // What's in the tracker
  lastSyncedAt: string;
  syncStatus: 'synced' | 'pending' | 'conflict';
  fallbacksUsed: string[];           // e.g., ["label:planning"]
}

// State transition result
export interface StateTransitionResult {
  success: boolean;
  panopticonState: CanonicalState;
  trackerState: string;
  fallbacksUsed: string[];
  warnings: string[];
}
