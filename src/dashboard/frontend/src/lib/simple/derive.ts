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
import { userFacingDisplay, type UserFacingDisplay } from './userFacingState';

export interface SimpleIssueDerivation {
  issue: Issue;
  pipelineState: PipelineState;
  rail: PhaseRailState;
  display: UserFacingDisplay;
  /** The agent the UI talks to (running work > plan > review > test > ship, else newest). */
  primaryAgent: AgentSnapshot | undefined;
  /** First agent with an outstanding question/plan approval. */
  pendingInputAgent: AgentSnapshot | undefined;
  agents: AgentSnapshot[];
  taskProgress: { completed: number; total: number } | null;
  costSoFar: number | null;
  prUrl: string | null;
  /** reviewStatus.updatedAt when merged — for the Finished section. */
  activityAt: string | null;
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

export function deriveSimpleIssue(
  issue: Issue,
  agents: AgentSnapshot[],
  reviewStatus?: ReviewStatusSnapshot | undefined,
): SimpleIssueDerivation {
  const primaryAgent = pickPrimaryAgent(agents);
  const pendingInputAgent = agents.find(hasPendingInput);
  const stuck =
    agents.some((a) => a.troubled || isAgentProblemStatus(a.status)) || reviewStatus?.stuck === true;

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
    display: userFacingDisplay({ pipelineState, pendingInput: !!pendingInputAgent, stuck }),
    primaryAgent,
    pendingInputAgent,
    agents,
    taskProgress: issue.taskCounts ?? null,
    costSoFar: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    prUrl: reviewStatus?.prUrl ?? null,
    // Fall back to agent activity so done issues without a review snapshot
    // still land in Finished within their window.
    activityAt: reviewStatus?.updatedAt ?? lastAgentActivity ?? null,
  };
}

export type NeedsYouKind = 'question' | 'problems' | 'stuck';

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
        const kind: NeedsYouKind = d.pendingInputAgent ? 'question' : d.agents.some((a) => a.troubled || isAgentProblemStatus(a.status)) ? 'stuck' : 'problems';
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
