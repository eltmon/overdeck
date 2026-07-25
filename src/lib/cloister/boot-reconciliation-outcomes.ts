export type BootReconciliationOutcomeReason =
  | 'resumed'
  /**
   * The agent was already running by the time the batch reached it — the
   * reactive stopped-event path beat the batch to it. That is a success, not a
   * skip, and must not be reported as `no-resumable-session` (PAN-3052).
   */
  | 'already-running'
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

/** Already running when the batch reached it — counted as resumed, not skipped. */
export function alreadyRunningBootReconciliationOutcome(
  agent: BootReconciliationOutcomeAgent,
): BootReconciliationOutcome {
  return { id: agent.id, issueId: agent.issueId, outcome: 'resumed', reason: 'already-running' };
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
