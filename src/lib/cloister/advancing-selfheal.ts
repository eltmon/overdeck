import { Effect } from 'effect';
import * as agents from '../agents.js';
import type { AgentState } from '../agents.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import {
  getReviewStatusSync,
  loadReviewStatuses,
  type ReviewStatus,
} from '../review-status.js';
import { killSession, listSessionNames } from '../tmux.js';
import { selectMergedAdvancingSessions } from './reap-terminal-sessions.js';

const JOURNAL_RECONCILE_STATES = new Set([
  'pending',
  'reviewing',
  'passed',
  'failed',
  'blocked',
  'testing',
  'skipped',
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
  getAgentStateSync: (session) => agents.getAgentStateSync(session),
  saveAgentStateSync: (state) => agents.saveAgentStateSync(state),
  markAgentStoppedState: (state) => agents.markAgentStoppedState(state),
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

/**
 * PAN-2341: Reap advancing-role sessions for already-merged issues.
 *
 * The warm-by-default lifecycle (PAN-2579) intentionally leaves review/test/ship
 * panes alive, but once the issue is MERGED those sessions have no remaining role
 * in the pipeline (close-out territory). Kill the tmux session and
 * mark the agents-table row stopped so countRunningAgents() frees the slot.
 */
export async function checkMergedAdvancingSessions(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const statuses = loadReviewStatuses();
    const aliveSessions = await Effect.runPromise(listSessionNames());
    const toKill = selectMergedAdvancingSessions(statuses, [...aliveSessions]);

    for (const session of toKill) {
      try {
        await Effect.runPromise(killSession(session));
      } catch (err) {
        console.warn(`[deacon] Failed to reap merged advancing session ${session}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const markedStopped = markAdvancingSessionStopped(session);
      actions.push(
        markedStopped
          ? `Reaped merged advancing session ${session} (issue merged, row stopped)`
          : `Reaped merged advancing session ${session} (issue merged)`,
      );
      console.log(`[deacon] Reaped merged advancing session ${session} (PAN-2341)`);
      logDeaconEventSync(`checkMergedAdvancingSessions: reaped ${session} — issue merged but advancing session alive (PAN-2341)`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error reaping merged advancing sessions:', msg);
  }
  return actions;
}

export interface BootAdvancingSelfHealDeps {
  reconcileInFlightJournals(): Promise<string[]>;
  checkMergedAdvancingSessions(): Promise<string[]>;
  log(message: string): void;
}

const defaultBootAdvancingSelfHealDeps: BootAdvancingSelfHealDeps = {
  reconcileInFlightJournals,
  checkMergedAdvancingSessions,
  log: logDeaconEventSync,
};

export async function runBootAdvancingSelfHeal(
  deps: BootAdvancingSelfHealDeps = defaultBootAdvancingSelfHealDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const steps: Array<[string, () => Promise<string[]>]> = [
    ['reconcileInFlightJournals', deps.reconcileInFlightJournals],
    ['checkMergedAdvancingSessions', deps.checkMergedAdvancingSessions],
  ];

  for (const [name, step] of steps) {
    try {
      const stepActions = await step();
      actions.push(...stepActions);
      if (stepActions.length > 0) {
        deps.log(`startDeacon: ${name} boot self-heal actions: ${stepActions.join('; ')}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.log(`startDeacon: ${name} boot self-heal failed: ${msg}`);
    }
  }

  return actions;
}
