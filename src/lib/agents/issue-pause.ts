/**
 * The issue pause (PAN-3911): what an operator pause of an issue's work agent
 * does to the issue's review and test agents, and what `pan unpause` does to
 * bring them back.
 *
 * - **Pause** stops the issue's running review convoy (lanes and synthesis
 *   parent) and test agent, records their ids next to the pause
 *   (`pauseStoppedAgents`), and journals `review.halted` when reviewers were
 *   stopped. The journal entry ends the run for `recoverStalledReviews`, which
 *   only relaunches lanes against the parent they were started with, and that
 *   parent is now stopped.
 * - **Unpause** clears the operator-stop gate on those rows and starts the
 *   review again through the normal review-request door: a fresh synthesis
 *   parent and convoy for the current head. A test agent alone is re-dispatched
 *   through the test dispatch door.
 *
 * The specialists are stopped with cause `'system'`. `'operator'` would set
 * `stoppedByUser` on each of them, and `messageAgent` answers that gate by
 * queueing mail that nothing drains, so a lane's `REVIEWER_*` signal or a
 * convoy notice would sit unread. The hold lives in one place instead: the
 * issue gate (`getIssuePause`), which `messageAgent` reads before it resumes a
 * stopped review or test agent, and which stalled-review recovery reads too.
 */
import { Effect } from 'effect';

import {
  clearAgentStoppedByUser,
  getAgentState,
  issuePauseAgentId,
  recordPauseStoppedAgents,
  type AgentState,
} from './agent-state.js';
import type { LivenessVerdict } from './liveness.js';

export interface AgentProblem {
  readonly agentId: string;
  readonly reason: string;
}

/** What the specialist sweep did. It never throws. */
export interface IssueSpecialistSweep {
  /** Agents that were running and are now stopped. */
  readonly stopped: string[];
  /** Agents whose terminal could not be closed; they may still be running. */
  readonly failed: AgentProblem[];
  /** Agents whose liveness could not be determined; left alone. */
  readonly unknown: AgentProblem[];
  /** Herdr panes of the issue's review/test roles that no agent row listed, closed by the second pass. */
  readonly closedPanes: string[];
}

const SPECIALIST_ROLES = ['review', 'test'] as const;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stop an issue's running review and test agents. "Running" is the liveness
 * oracle's answer (`isAlive`), not the row's status: a row that says `stopped`
 * over a live Herdr pane is running. An agent whose liveness is indeterminate
 * is reported as `unknown` and not touched, and then the Herdr second pass is
 * skipped too, since it would close that agent's pane.
 *
 * Lanes go first and the synthesis parent last, so a lane that reports while
 * it is being closed reaches a parent that is still alive.
 */
export async function stopIssueSpecialistAgents(issueId: string): Promise<IssueSpecialistSweep> {
  const sweep: IssueSpecialistSweep = { stopped: [], failed: [], unknown: [], closedPanes: [] };
  const upperIssueId = issueId.trim().toUpperCase();
  if (!upperIssueId) return sweep;

  let agents: AgentState[];
  let isAlive: (agentId: string) => Promise<LivenessVerdict>;
  let closeIssuePanes: typeof import('../terminal-backends/launch.js').closeIssuePanes;
  let stopAgent: typeof import('./termination.js').stopAgent;
  try {
    const { listAgentStates } = await import('./queries.js');
    ({ isAlive } = await import('./liveness.js'));
    ({ closeIssuePanes } = await import('../terminal-backends/launch.js'));
    ({ stopAgent } = await import('./termination.js'));
    agents = listAgentStates();
  } catch (err) {
    sweep.unknown.push({ agentId: upperIssueId, reason: `could not list the issue's agents: ${errorText(err)}` });
    return sweep;
  }

  const parentId = `${issuePauseAgentId(upperIssueId)}-review`;
  const specialists = agents
    .filter((agent) => (SPECIALIST_ROLES as readonly string[]).includes(agent.role))
    .filter((agent) => (agent.issueId ?? '').trim().toUpperCase() === upperIssueId)
    .sort((a, b) => Number(a.id === parentId) - Number(b.id === parentId));

  for (const agent of specialists) {
    const verdict = await isAlive(agent.id).catch((): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }));
    if (!verdict.alive) {
      if (verdict.reason === 'runtime-indeterminate') {
        sweep.unknown.push({ agentId: agent.id, reason: 'liveness could not be determined' });
      }
      continue;
    }
    try {
      const close = await Effect.runPromise(stopAgent(agent.id, 'system'));
      if (close.outcome === 'failed') sweep.failed.push({ agentId: agent.id, reason: close.reason });
      else sweep.stopped.push(agent.id);
    } catch (err) {
      sweep.failed.push({ agentId: agent.id, reason: errorText(err) });
    }
  }

  if (sweep.unknown.length === 0) {
    const closed = await closeIssuePanes(upperIssueId, { roles: SPECIALIST_ROLES }).catch(() => [] as string[]);
    sweep.closedPanes.push(...closed.filter((id) => !sweep.stopped.includes(id)));
  }
  return sweep;
}

/**
 * The pause half. Runs only when `agentId` is the issue's work agent, the one
 * `getIssuePause` reads; a swarm slot pause pauses the slot and nothing else.
 * Returns null when the pause is not an issue pause. Never throws.
 */
export async function haltIssueSpecialistsForPause(
  agentId: string,
  state: AgentState,
  source: string,
): Promise<IssueSpecialistSweep | null> {
  const issueId = state.issueId?.trim().toUpperCase();
  if (!issueId || state.role !== 'work' || agentId !== issuePauseAgentId(issueId)) return null;

  const sweep = await stopIssueSpecialistAgents(issueId);
  if (sweep.stopped.length === 0) return sweep;

  try {
    await Effect.runPromise(recordPauseStoppedAgents(agentId, sweep.stopped));
  } catch (err) {
    console.warn(`[agents] Could not record the agents the ${issueId} pause stopped: ${errorText(err)}`);
  }
  const reviewers = sweep.stopped.filter((id) => roleOf(id) === 'review');
  if (reviewers.length > 0 && state.workspace) {
    try {
      const { appendPipelineEntry } = await import('../cloister/pipeline-journal.js');
      appendPipelineEntry(state.workspace, {
        type: 'review.halted',
        issueId,
        source,
        data: { reason: 'issue paused', stopped: reviewers },
      });
    } catch (err) {
      console.warn(`[agents] Could not journal the halted ${issueId} review: ${errorText(err)}`);
    }
  }
  return sweep;
}

function roleOf(agentId: string): string | undefined {
  try {
    return getAgentState(agentId)?.role;
  } catch {
    return undefined;
  }
}

export type ReviewRequestOutcome = { requested: true } | { requested: false; reason: string };

/** What `restartIssueAfterUnpause` did. */
export interface UnpauseRestart {
  /** Rows whose operator-stop gate was cleared. */
  readonly clearedStopGates: string[];
  /** Set when the pause had stopped reviewers. */
  readonly review?: ReviewRequestOutcome;
  /** Set when the pause had stopped only a test agent. */
  readonly test?: { dispatched: true } | { dispatched: false; reason: string };
}

export interface UnpauseRestartDeps {
  /** The review-request door for the caller's process: the HTTP route from the CLI, the registered starter in the dashboard. */
  readonly requestReview: (issueId: string) => Promise<ReviewRequestOutcome>;
  /** Test seam; defaults to `dispatchTestAgentAndNotify`. */
  readonly dispatchTest?: (issueId: string, workspace?: string) => Promise<{ dispatched: true } | { dispatched: false; reason: string }>;
}

async function dispatchTestDefault(issueId: string, workspace?: string): Promise<{ dispatched: true } | { dispatched: false; reason: string }> {
  const { dispatchTestAgentAndNotify } = await import('../cloister/test-agent-queue.js');
  const result = await Effect.runPromise(dispatchTestAgentAndNotify(issueId, workspace, `feature/${issueId.toLowerCase()}`));
  return result.delivered ? { dispatched: true } : { dispatched: false, reason: result.reason ?? 'not dispatched' };
}

/**
 * The unpause half. `stateBefore` is the work agent's state read before the
 * pause was cleared. When the pause stopped review or test agents, this clears
 * their operator-stop gates and starts them again through the normal doors:
 * a review re-request (a fresh synthesis parent and convoy for the current
 * head, never convoy recovery against the stopped parent), or a test dispatch
 * when only the test agent was stopped. Returns null when the pause stopped
 * nothing. Never throws.
 */
export async function restartIssueAfterUnpause(
  stateBefore: AgentState,
  deps: UnpauseRestartDeps,
): Promise<UnpauseRestart | null> {
  const stopped = stateBefore.pauseStoppedAgents ?? [];
  const issueId = stateBefore.issueId?.trim().toUpperCase();
  if (stateBefore.paused !== true || stopped.length === 0 || !issueId) return null;

  const clearedStopGates: string[] = [];
  const roles = new Set<string>();
  for (const agentId of stopped) {
    const role = roleOf(agentId);
    if (role) roles.add(role);
    try {
      if (await Effect.runPromise(clearAgentStoppedByUser(agentId))) clearedStopGates.push(agentId);
    } catch (err) {
      console.warn(`[agents] Could not clear the stop gate on ${agentId}: ${errorText(err)}`);
    }
  }

  if (roles.has('review')) {
    const review = await deps.requestReview(issueId).catch((err): ReviewRequestOutcome => ({
      requested: false,
      reason: errorText(err),
    }));
    return { clearedStopGates, review };
  }
  if (roles.has('test')) {
    const dispatch = deps.dispatchTest ?? dispatchTestDefault;
    const test = await dispatch(issueId, stateBefore.workspace).catch((err) => ({
      dispatched: false as const,
      reason: errorText(err),
    }));
    return { clearedStopGates, test };
  }
  return { clearedStopGates };
}

/** One line per problem, for the CLI and the dashboard response. */
export function describeSweepProblems(sweep: IssueSpecialistSweep): string[] {
  return [
    ...sweep.failed.map(({ agentId, reason }) => `could not stop ${agentId}: ${reason}`),
    ...sweep.unknown.map(({ agentId, reason }) => `did not stop ${agentId}: ${reason}`),
  ];
}
