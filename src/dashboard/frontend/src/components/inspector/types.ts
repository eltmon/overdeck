import type { GitStatus } from '../../types';

export interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge' | 'inspect' | 'uat' | 'verification';
  status: string;
  timestamp: string;
  notes?: string;
}

export interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed';
  inspectNotes?: string;
  uatStatus?: 'pending' | 'testing' | 'passed' | 'failed';
  uatNotes?: string;
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  mergeNotes?: string;
  mergeRetryCount?: number;
  updatedAt: string;
  /** Timestamp when the current/last review fan-out was dispatched. */
  reviewSpawnedAt?: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
  history?: StatusHistoryEntry[];
  /** Active review orchestrator session (agent-<issueId>-review) */
  reviewCoordinatorSessionName?: string;
  /** Active review sub-role session names (agent-<issueId>-review-<role>) */
  reviewSessionNames?: string[];
  /** Per-role completion status for parallel review sub-agents */
  reviewSubStatuses?: Record<string, 'running' | 'done'>;
  /** PAN-366: Queue position — null = not queued, 0 = active, 1+ = position */
  queuePosition?: number | null;
  /** PAN-366: Which specialist is active or will handle this issue */
  activeSpecialist?: 'review' | 'test' | 'merge' | null;
  /** PAN-905: GitHub-native merge blockers preventing merge */
  blockerReasons?: ReadonlyArray<{ type: string; summary: string; details?: string; detectedAt: string }>;
}

export interface ContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'unknown';
  ports?: number[];
  lastProbeAt?: string;
  lastFailureReason?: string;
}

export interface PendingOperation {
  type: 'approve' | 'close' | 'containerize' | 'start' | 'review' | 'merge';
  issueId: string;
  startedAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

export interface SalvageableStashInfo {
  ref: string;
  stackRef?: string;
  issueId: string;
  message: string;
  shortDescription: string;
  createdAt?: string;
}

export interface WorkspaceInfo {
  exists: boolean;
  corrupted?: boolean;
  message?: string;
  issueId: string;
  path?: string;
  frontendUrl?: string;
  apiUrl?: string;
  containers?: Record<string, ContainerStatus> | null;
  hasDocker?: boolean;
  canContainerize?: boolean;
  pendingOperation?: PendingOperation | null;
  location?: 'local' | 'remote';
  mrUrl?: string | null;
  hasAgent?: boolean;
  agentSessionId?: string | null;
  agentModel?: string;
  agentModelFull?: string;
  git?: GitStatus;
  repoGit?: { frontend: GitStatus | null; api: GitStatus | null };
  services?: { name: string; url?: string }[];
  planningState?: {
    hasPlan: boolean;
    hasBeads: boolean;
    beadsCount: number;
    planningComplete: boolean;
    workspacePath?: string;
  };
  costs?: IssueCostData;
}

export interface IssueCostData {
  issueId: string;
  totalCost: number;
  resolvedTotalCost?: number;
  aggregateCost?: number;
  liveCost?: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  sessions: { model: string; cost: number; tokens: number; durationMs?: number }[];
  byModel: Record<string, { cost: number; tokens: number }>;
  byStage?: Record<string, { cost: number; tokens: number }>;
  budget?: number;
  budgetWarning?: boolean;
  lastUpdated?: string;
}

export interface ContainerMenuState {
  x: number;
  y: number;
  containerName: string;
  isRunning: boolean;
}
