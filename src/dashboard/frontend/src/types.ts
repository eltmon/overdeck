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
  stateType?: string;  // Linear state type (backlog, unstarted, started, completed, canceled)
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
  state?: string;  // Canonical issue state (e.g. 'canceled', 'done', 'in_review')
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
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';  // From review-status, set by specialist pipeline
}

export interface GitStatus {
  branch: string;
  uncommittedFiles: number;
  latestCommit: string;
}

export type AgentResolution = 'working' | 'done' | 'needs_input' | 'stuck' | 'completed' | 'unclear' | 'abandoned';

export interface WorkAgentLifecycle {
  agentId: string;
  hasAgentState: boolean;
  hasLiveTmuxSession: boolean;
  hasSavedSession: boolean;
  hasWorkspace: boolean;
  isPlaceholder: boolean;
  isOrphaned: boolean;
  isRunning: boolean;
  isStopped: boolean;
  isCompleted: boolean;
  isCrashed: boolean;
  runtimeState: string;
  agentStatus: string;
  canStartFresh: boolean;
  canResumeSession: boolean;
  canRestartWithContext: boolean;
  canResetSession: boolean;
  requiresSessionResetBeforeFreshStart: boolean;
  recommendedAction: 'start' | 'resume' | 'restart_with_context' | 'reset_session' | 'none';
  reason?: string;
}

export interface Agent {
  id: string;
  issueId?: string;
  runtime: string;
  model: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead' | 'stopped' | 'starting' | 'running' | 'failed';
  error?: string;
  pid?: number;
  startedAt: string;
  lastActivity?: string;
  consecutiveFailures: number;
  killCount: number;
  workspace?: string;
  workspaceLocation?: 'local' | 'remote';
  git?: GitStatus;
  type?: 'agent';
  agentPhase?: 'planning' | 'implementation' | 'exploration' | string;
  hasPendingQuestion?: boolean;
  pendingQuestionCount?: number;
  resolution?: AgentResolution;  // Lifecycle completion signal (PAN-309)
  resolutionCount?: number;      // How many times this resolution was set
  runtimeState?: string;         // 'completed' when agent finished normally (not session lost)
  hasSession?: boolean;          // Whether a resumable Claude session exists
  lifecycle?: WorkAgentLifecycle;
}

export interface AgentHealth {
  agentId: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead';
  reason?: string;
  lastPing?: string;
  consecutiveFailures: number;
  killCount: number;
  contextPercent?: number | null;
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
  'In Planning': 'in_progress',
  'Planning': 'in_progress',
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

// Reverse map: Linear stateType → canonical state (fallback for custom status names)
export const STATE_TYPE_TO_CANONICAL: Record<string, CanonicalState> = {
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'canceled',
  cancelled: 'canceled',
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

// Resource monitoring types (PAN-295)
export interface ContainerStats {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsage: number;    // bytes
  memoryLimit: number;    // bytes
  memoryPercent: number;
  networkIn: number;      // bytes
  networkOut: number;     // bytes
  status: 'running' | 'stopped' | 'unhealthy' | 'restarting';
}

export interface ContainerHistory {
  timestamps: number[];   // unix ms
  cpuPercent: number[];
  memoryPercent: number[];
}

export type ResourceGroupBy = 'issue' | 'type' | 'status';

export interface ResourcesSnapshot {
  containers: ContainerStats[];
  agents: Agent[];
  updatedAt: string;
}

export interface SystemHealthAgentProcess {
  id: string;
  issueId: string;
  kind: 'work' | 'planning' | 'specialist' | 'other';
  status: string;
  tmuxActive: boolean;
  memoryBytes: number;
  memoryGb: number;
  currentIssue?: string;
}

export interface SystemHealthLeakedSpecialist {
  name: string;
  currentIssue: string;
  reason: string;
}

export interface SystemHealthConsumer {
  id: string;
  label: string;
  type: 'agent' | 'specialist' | 'container';
  memoryBytes: number;
  memoryGb: number;
  cpuPercent?: number;
  issueId?: string;
  currentIssue?: string;
  leaked?: boolean;
  killTarget?: {
    kind: 'agent' | 'specialist' | 'container';
    agentId?: string;
    containerId?: string;
    projectKey?: string;
    issueId?: string;
    specialistType?: string;
  };
}

export interface SystemHealthSnapshot {
  severity: 'normal' | 'warning' | 'critical';
  updatedAt: string;
  summary: {
    cpuPercent: number;
    loadAverage1m: number;
    loadPerCore1m: number;
    totalMemoryBytes: number;
    usedMemoryBytes: number;
    availableMemoryBytes: number;
    memoryUsedPercent: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
    swapUsedPercent: number;
    overcommitPercent: number;
    agentCount: number;
    workAgentCount: number;
    planningAgentCount: number;
    specialistSessionCount: number;
    leakedSpecialistCount: number;
    containerCount: number;
    containerMemoryBytes: number;
    panopticonMemoryBytes: number;
    panopticonMemoryPercent: number;
  };
  thresholds: {
    memoryAvailableWarningBytes: number;
    memoryAvailableCriticalBytes: number;
    swapUsedWarningPercent: number;
    swapUsedCriticalPercent: number;
    cpuLoadWarningPerCore: number;
    cpuLoadCriticalPerCore: number;
    overcommitWarningPercent: number;
    overcommitCriticalPercent: number;
  };
  reasons: string[];
  agents: SystemHealthAgentProcess[];
  leakedSpecialists: SystemHealthLeakedSpecialist[];
  topConsumers: SystemHealthConsumer[];
}

// State transition result
export interface StateTransitionResult {
  success: boolean;
  panopticonState: CanonicalState;
  trackerState: string;
  fallbacksUsed: string[];
  warnings: string[];
}
