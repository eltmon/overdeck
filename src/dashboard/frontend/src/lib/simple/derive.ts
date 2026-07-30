/**
 * PAN-2908 · C-SIMPLE — per-issue derivation for simple mode.
 *
 * Pure functions joining Issue × AgentSnapshot[] × ReviewStatusSnapshot into
 * the five user-facing states. Pages compose these; tests cover them without
 * rendering anything. Advanced-mode derivations (drawer/cockpit) stay
 * untouched — this is the simple-mode projection only.
 */
import type { AgentSnapshot, ReviewStatusSnapshot } from '@overdeck/contracts';
import type { Issue } from '../../types';
import { derivePipelineState, type PipelineState } from '../issuePipelineState';
import { isAgentProblemStatus } from '../pipeline-state';
import { phaseRailState, type PhaseRailState } from './phases';
import { userFacingDisplay, type NeedsYouReason, type UserFacingDisplay } from './userFacingState';

export interface SimpleIssueDerivation {
  issue: Issue;
  pipelineState: PipelineState;
  rail: PhaseRailState;
  display: UserFacingDisplay;
  /** The agent the UI talks to (running work > plan > review > test > ship, else newest). */
  primaryAgent: AgentSnapshot | undefined;
  /** First agent with an outstanding question/plan approval. */
  pendingInputAgent: AgentSnapshot | undefined;
  /** An agent is troubled or in a problem status — "Get it unstuck" recovers the agent. */
  agentStuck: boolean;
  /** The review-status row carries the persistent stuck flag — "Get it unstuck" must call the unstick door (PAN-3073). */
  reviewStuck: boolean;
  agents: AgentSnapshot[];
  taskProgress: { completed: number; total: number } | null;
  costSoFar: number | null;
  prUrl: string | null;
  /** Plain-English expectation: elapsed + rough time-to-go from task progress. */
  expectation: string | null;
  /** reviewStatus.updatedAt when merged — for the Finished section. */
  activityAt: string | null;
}

function formatDuration(mins: number): string {
  if (mins < 1) return '<1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * C-SIMPLE expectations: honest, computable-locally only. Elapsed comes from
 * the agent's startedAt; time-to-go is a rough extrapolation from task
 * progress — never fabricated precision when there is no basis.
 */
export function deriveExpectation(
  agent: AgentSnapshot | undefined,
  taskProgress: { completed: number; total: number } | null,
  now = Date.now(),
): string | null {
  if (!agent?.startedAt) return null;
  const started = Date.parse(agent.startedAt);
  if (!Number.isFinite(started)) return null;
  const elapsedMin = (now - started) / 60_000;
  if (elapsedMin < 0) return null;
  const elapsed = `started ${formatDuration(elapsedMin)} ago`;
  if (taskProgress && taskProgress.completed > 0 && taskProgress.completed < taskProgress.total) {
    const remainingMin = elapsedMin * (taskProgress.total / taskProgress.completed - 1);
    return `${elapsed} · about ${formatDuration(remainingMin)} to go`;
  }
  return elapsed;
}

const ROLE_PRIORITY: Record<string, number> = { work: 0, plan: 1, review: 2, test: 3, ship: 4 };

function isRunning(agent: AgentSnapshot): boolean {
  return agent.status === 'running' || agent.status === 'starting';
}

function pickPrimaryAgent(agents: AgentSnapshot[]): AgentSnapshot | undefined {
  const running = agents
    .filter(isRunning)
    .sort((a, b) => (ROLE_PRIORITY[a.role ?? ''] ?? 9) - (ROLE_PRIORITY[b.role ?? ''] ?? 9));
  if (running.length > 0) return running[0];
  return [...agents].sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))[0];
}

export function hasPendingInput(agent: AgentSnapshot): boolean {
  return (
    !!agent.pendingAskUserQuestion ||
    !!agent.pendingProposedPlan ||
    (agent.pendingInputCount ?? 0) > 0
  );
}

/**
 * True when the agent's only pending signal is `agentTurnEnded` — it stopped
 * talking, it did not ask anything. An idle plan agent always trips this once
 * planning finishes (agent-enrichment.ts adds the kind for interactive roles),
 * so simple mode must not read it as an open question. Unknown/absent kinds
 * stay conservative and report false.
 */
export function isBareTurnEnd(agent: AgentSnapshot): boolean {
  if (agent.pendingAskUserQuestion || agent.pendingProposedPlan) return false;
  const kinds = agent.pendingInputKinds ?? [];
  return kinds.length > 0 && kinds.every((k) => k === 'agentTurnEnded');
}

/**
 * The plan exists and the plan agent has stopped talking without asking
 * anything: nothing will happen until a human starts the work.
 *
 * Keyed on the written plan, NOT on the agent's process being dead. A finished
 * plan agent commonly sits idle at a live prompt for hours, which keeps the
 * machine in `planning_active` — so process state answers "is it alive", never
 * "is it still planning". Mid-planning there is no plan yet, so a turn-end
 * there is a real question and stays one.
 */
export function isPlanReadyToStart(issue: Issue, pendingInputAgent: AgentSnapshot | undefined): boolean {
  if (issue.hasPlan !== true) return false;
  if (!pendingInputAgent || pendingInputAgent.role !== 'plan') return false;
  return isBareTurnEnd(pendingInputAgent);
}

export function deriveSimpleIssue(
  issue: Issue,
  agents: AgentSnapshot[],
  reviewStatus?: ReviewStatusSnapshot | undefined,
): SimpleIssueDerivation {
  const primaryAgent = pickPrimaryAgent(agents);
  const pendingInputAgent = agents.find(hasPendingInput);
  const agentStuck = agents.some((a) => a.troubled || isAgentProblemStatus(a.status));
  const reviewStuck = reviewStatus?.stuck === true;
  const stuck = agentStuck || reviewStuck;

  const pipelineState = derivePipelineState({
    reviewStatus: reviewStatus ?? null,
    agent: primaryAgent ?? null,
    hasPlan: issue.hasPlan === true,
    hasTasks: issue.hasTasks === true,
    issueCanonicalState: issue.state ?? issue.status ?? null,
    isMerged: reviewStatus?.mergeStatus === 'merged',
  });

  const costs = agents.map((a) => a.costSoFar).filter((c): c is number => typeof c === 'number');
  const lastAgentActivity = agents
    .map((a) => a.lastActivity)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);

  return {
    issue,
    pipelineState,
    rail: phaseRailState(pipelineState),
    display: userFacingDisplay({
      pipelineState,
      pendingInput: !!pendingInputAgent,
      planReadyToStart: isPlanReadyToStart(issue, pendingInputAgent),
      stuck,
    }),
    primaryAgent,
    pendingInputAgent,
    agentStuck,
    reviewStuck,
    agents,
    taskProgress: issue.taskCounts ?? null,
    costSoFar: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    expectation: deriveExpectation(primaryAgent, issue.taskCounts ?? null),
    prUrl: reviewStatus?.prUrl ?? null,
    // Fall back to agent activity so done issues without a review snapshot
    // still land in Finished within their window.
    activityAt: reviewStatus?.updatedAt ?? lastAgentActivity ?? null,
  };
}

/** Why a needs-you card is on home — owned by userFacingDisplay, not re-derived. */
export type NeedsYouKind = NeedsYouReason;

export interface SimpleHomeBuckets {
  needsYou: { derivation: SimpleIssueDerivation; kind: NeedsYouKind }[];
  working: SimpleIssueDerivation[];
  ready: SimpleIssueDerivation[];
  finished: SimpleIssueDerivation[];
}

const FINISHED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bucket every issue into the simple-home sections. Backlog/not-started issues
 * are intentionally absent — simple home is about work in motion; new work
 * starts from the composer.
 */
export function bucketSimpleHome(
  derivations: SimpleIssueDerivation[],
  now = Date.now(),
): SimpleHomeBuckets {
  const buckets: SimpleHomeBuckets = { needsYou: [], working: [], ready: [], finished: [] };
  for (const d of derivations) {
    switch (d.display.state) {
      case 'needs-you': {
        const kind: NeedsYouKind = d.display.needsYouReason ?? 'problems';
        buckets.needsYou.push({ derivation: d, kind });
        break;
      }
      case 'working':
        buckets.working.push(d);
        break;
      case 'ready':
        buckets.ready.push(d);
        break;
      case 'done': {
        const t = d.activityAt ? Date.parse(d.activityAt) : NaN;
        if (Number.isFinite(t) && now - t < FINISHED_WINDOW_MS) buckets.finished.push(d);
        break;
      }
      case 'not-started':
        break; // backlog stays out of simple home
    }
  }
  const byActivityDesc = (a: SimpleIssueDerivation, b: SimpleIssueDerivation) =>
    (b.activityAt ?? '').localeCompare(a.activityAt ?? '');
  buckets.working.sort(byActivityDesc);
  buckets.ready.sort(byActivityDesc);
  buckets.finished.sort(byActivityDesc);
  buckets.needsYou.sort((a, b) => byActivityDesc(a.derivation, b.derivation));
  return buckets;
}
