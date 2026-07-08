export type BootReconciliationOutcomeReason =
  | 'resumed'
  | 'no-resumable-session'
  | 'deferred-concurrency'
  | 'deferred-load'
  | 'deferred-memory';

export interface BootReconciliationOutcome {
  id: string;
  issueId: string;
  outcome: 'resumed' | 'skipped';
  reason: BootReconciliationOutcomeReason;
}

export type BootReconciliationDecisionSkipBreakdown = {
  workspace_missing: number;
  merged: number;
  completed: number;
  other: number;
};

export interface BootReconciliationApplyResult {
  resumed: string[];
  outcomes: BootReconciliationOutcome[];
  skipped: BootReconciliationDecisionSkipBreakdown;
  deferred: number;
}

interface BootReconciliationOutcomeAgent {
  id: string;
  issueId: string;
}

export function resumedBootReconciliationOutcome(agent: BootReconciliationOutcomeAgent): BootReconciliationOutcome {
  return { id: agent.id, issueId: agent.issueId, outcome: 'resumed', reason: 'resumed' };
}

export function skippedBootReconciliationOutcome(
  agent: BootReconciliationOutcomeAgent,
  reason: Exclude<BootReconciliationOutcomeReason, 'resumed'>,
): BootReconciliationOutcome {
  return { id: agent.id, issueId: agent.issueId, outcome: 'skipped', reason };
}

export function skippedBootReconciliationOutcomes(
  agents: ReadonlyArray<BootReconciliationOutcomeAgent>,
  reason: Exclude<BootReconciliationOutcomeReason, 'resumed'>,
): BootReconciliationOutcome[] {
  return agents.map((agent) => skippedBootReconciliationOutcome(agent, reason));
}
