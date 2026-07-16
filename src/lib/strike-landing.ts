export type StrikeLandingState = 'ready' | 'landing' | 'recovering' | 'landed' | 'needs_you';

export interface StrikeLandingAttempt {
  timestamp: string;
  strikeHead: string;
  mainHead: string;
  outcome: string;
  detail: string;
}

export interface StrikeLandingStatus {
  strikeReadyHead?: string;
  strikeReadyAt?: string;
  strikeLandingState?: StrikeLandingState;
  strikeRecoveryCount?: number;
  strikeLandingAttempts?: StrikeLandingAttempt[];
}
