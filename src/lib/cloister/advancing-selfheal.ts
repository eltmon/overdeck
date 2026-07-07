import { Effect } from 'effect';
import {
  getAgentStateSync,
  markAgentStoppedState,
  saveAgentStateSync,
  type AgentState,
} from '../agents.js';
import {
  getReviewStatusSync,
  loadReviewStatuses,
  type ReviewStatus,
} from '../review-status.js';
import { listSessionNames } from '../tmux.js';

const JOURNAL_RECONCILE_STATES = new Set([
  'pending',
  'reviewing',
  'passed',
  'failed',
  'blocked',
  'testing',
  'dispatch_failed',
]);

export interface AdvancingSelfHealDeps {
  loadReviewStatuses(): Record<string, ReviewStatus>;
  getReviewStatusSync(issueId: string): ReviewStatus | null;
  listSessionNames(): Promise<readonly string[]>;
  getAgentStateSync(session: string): AgentState | null;
  saveAgentStateSync(state: AgentState): void;
  markAgentStoppedState(state: AgentState): AgentState;
  warn(message: string): void;
}

const defaultDeps: AdvancingSelfHealDeps = {
  loadReviewStatuses,
  getReviewStatusSync,
  listSessionNames: () => Effect.runPromise(listSessionNames()),
  getAgentStateSync,
  saveAgentStateSync,
  markAgentStoppedState,
  warn: (message) => console.warn(message),
};

function isReconciliableStatus(status: ReviewStatus): boolean {
  if (status.mergeStatus === 'merged') return false;
  return JOURNAL_RECONCILE_STATES.has(status.reviewStatus)
    && JOURNAL_RECONCILE_STATES.has(status.testStatus);
}

export function parseAdvancingIssueId(sessionName: string): string | null {
  const match = sessionName.match(/^agent-([a-z0-9]+-\d+)-(?:review|test|ship)(?:-.+)?$/i);
  return match ? match[1].toUpperCase() : null;
}

function statusChanged(before: ReviewStatus | null | undefined, after: ReviewStatus | null): boolean {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

/**
 * Host-side sweep for journaled review/test verdicts whose HTTP status POST
 * failed. getReviewStatusSync owns the journal -> DB reconcile; this patrol
 * step makes sure in-flight and tmux-alive advancing issues are read by the
 * host even when the agent has gone idle.
 */
export async function reconcileInFlightJournals(
  deps: AdvancingSelfHealDeps = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const statuses = deps.loadReviewStatuses();
  const issueIds = new Set<string>();

  for (const [issueId, status] of Object.entries(statuses)) {
    if (!isReconciliableStatus(status)) continue;
    issueIds.add(issueId.toUpperCase());
  }

  let sessionNames: readonly string[] = [];
  try {
    sessionNames = await deps.listSessionNames();
  } catch (error) {
    deps.warn(`[deacon] reconcileInFlightJournals: failed to list tmux sessions: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const sessionName of sessionNames) {
    const issueId = parseAdvancingIssueId(sessionName);
    if (!issueId) continue;
    const status = statuses[issueId];
    if (status && !isReconciliableStatus(status)) continue;
    issueIds.add(issueId);
  }

  for (const issueId of issueIds) {
    const before = statuses[issueId] ?? null;
    try {
      const after = deps.getReviewStatusSync(issueId);
      if (!statusChanged(before, after)) continue;
      actions.push(`Reconciled journaled advancing verdict for ${issueId}`);
    } catch (error) {
      deps.warn(`[deacon] reconcileInFlightJournals: failed to reconcile ${issueId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return actions;
}

export function markAdvancingSessionStopped(
  session: string,
  deps: Pick<AdvancingSelfHealDeps, 'getAgentStateSync' | 'saveAgentStateSync' | 'markAgentStoppedState'> = defaultDeps,
): boolean {
  const state = deps.getAgentStateSync(session);
  if (!state || state.status === 'stopped') return false;

  const stopped = deps.markAgentStoppedState(state);
  deps.saveAgentStateSync(stopped);
  return true;
}
