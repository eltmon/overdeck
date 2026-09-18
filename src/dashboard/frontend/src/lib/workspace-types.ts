import type { GitStatus } from '../types';

export interface ContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'unknown';
  ports?: number[];
  lastProbeAt?: string;
  lastFailureReason?: string;
}

export interface WorkspaceStackHealth {
  healthy: boolean;
  reasons: string[];
  lastObserved: string;
}

export interface PendingOperation {
  type:
    | 'approve'
    | 'close'
    | 'containerize'
    | 'start'
    | 'review'
    | 'merge'
    | 'rebuild-stack'
    | 'start-stack'
    | 'stop-stack'
    | 'restart-stack'
    | 'reap-workspace';
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
  stackHealth?: WorkspaceStackHealth;
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
    hasTasks: boolean;
    tasksCount: number;
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
