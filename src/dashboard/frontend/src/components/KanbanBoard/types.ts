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
  hasTasks: boolean;
  planningComplete: boolean;
}

export type ComplexityLevel = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

export type CycleFilter = 'current' | 'all' | 'backlog' | 'canceled';
