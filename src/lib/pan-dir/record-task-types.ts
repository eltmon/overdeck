export interface TaskClaim {
  writerId: string;
  agentId: string | null;
  pid: number;
  host: string;
  claimedAt: string;
}

export interface TaskClaimHistoryEntry extends TaskClaim {
  itemId: string;
  releasedAt: string;
  outcome: 'completed' | 'blocked' | 'cancelled' | 'released';
  reason?: string;
  forced?: boolean;
}

export interface PanIssueTasksRecord {
  sequence: number;
  claims: Record<string, TaskClaim>;
  claimHistory?: TaskClaimHistoryEntry[];
  statusReasons?: Record<string, { reason: string; updatedAt: string; forced?: boolean }>;
}
