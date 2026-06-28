// Cost data for an issue
export interface IssueCost {
  issueId: string;
  totalCost: number;
  tokenCount: number;
  sessionCount: number;
  model?: string;
  durationMinutes?: number;
}

export interface PlanningState {
  hasPlan: boolean;
  hasBeads: boolean;
  planningComplete: boolean;
}
