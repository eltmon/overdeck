export interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge';
  status: string;
  timestamp: string;
  notes?: string;
}

export interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped';
  mergeStatus?: 'pending' | 'merging' | 'merged' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
  history?: StatusHistoryEntry[];
}

export interface ContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string;
}

export interface PendingOperation {
  type: 'approve' | 'close' | 'containerize' | 'start' | 'review' | 'merge';
  issueId: string;
  startedAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
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
}

export interface ContainerMenuState {
  x: number;
  y: number;
  containerName: string;
  isRunning: boolean;
}
