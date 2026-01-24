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
  status: 'healthy' | 'warning' | 'stuck' | 'dead';
  pid?: number;
  startedAt: string;
  lastActivity?: string;
  consecutiveFailures: number;
  killCount: number;
  workspace?: string;
  git?: GitStatus;
  type?: 'agent' | 'planning';
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
  | 'planning'      // NEW: Human + AI discovery phase
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'canceled';

// For backward compatibility
export type IssueStatus = CanonicalState;

export const STATUS_ORDER: CanonicalState[] = [
  'backlog',
  'todo',
  'planning',       // NEW: Between todo and in_progress
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

  // Planning states (NEW)
  'In Planning': 'planning',
  'Planning': 'planning',
  'Planned': 'planning',       // Linear Project status name
  'Discovery': 'planning',

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
  planning: 'started',
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
