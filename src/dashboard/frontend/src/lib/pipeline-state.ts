import type { Agent, DerivedIssueState, DerivedIssueStateName, Issue } from '../types';

/**
 * Pipeline lanes. PAN-3917: every lane is now fed by one derived issue state —
 * there is no 'verifying' lane, because nothing derives "verifying on main".
 */
export type PipelineIssuePhase = 'ship' | 'review' | 'work' | 'plan' | 'ready' | 'todo';

/** The one place the nine derived states map onto lanes. Every surface imports this. */
export const PHASE_BY_DERIVED_STATE: Record<DerivedIssueStateName, PipelineIssuePhase> = {
  backlog: 'todo',
  parked: 'todo',
  planned: 'plan',
  working: 'work',
  'in-review': 'review',
  'changes-requested': 'review',
  ready: 'ship',
  merged: 'ship',
  closed: 'ship',
};

/**
 * An issue occupies a pipeline slot: past planning, not yet landed. The one
 * definition — order books, the merge-policy roster and capacity reads share it.
 */
export const IN_FLIGHT_STATES: ReadonlySet<DerivedIssueStateName> = new Set([
  'working',
  'in-review',
  'changes-requested',
  'ready',
]);

export function isIssueInFlight(derived?: DerivedIssueState | null): boolean {
  return !!derived && IN_FLIGHT_STATES.has(derived.state);
}

export function hasActualPendingQuestion(agent?: Pick<Agent, 'hasPendingQuestion' | 'pendingQuestionCount' | 'pendingQuestionPrompt'> | null): boolean {
  return agent?.hasPendingQuestion === true && ((agent.pendingQuestionCount ?? 0) > 0 || !!agent.pendingQuestionPrompt?.trim());
}

export function getPendingQuestionTitle(agent?: Pick<Agent, 'pendingQuestionCount' | 'pendingQuestionPrompt' | 'pendingQuestionReason'> | null): string {
  const prompt = agent?.pendingQuestionPrompt?.trim();
  if (prompt) {
    const firstLine = prompt.split('\n').find((line) => line.trim().length > 0)?.trim() ?? prompt;
    const prefix = agent?.pendingQuestionReason === 'tool_permission'
      ? 'Permission prompt'
      : agent?.pendingQuestionReason === 'planning_done'
        ? 'Planning complete'
        : agent?.pendingQuestionReason === 'confirmation'
          ? 'Confirmation prompt'
          : 'Awaiting input';
    return `${prefix}: ${firstLine}`;
  }
  const count = agent?.pendingQuestionCount || 1;
  return `Agent is waiting for user input (${count} question${count > 1 ? 's' : ''})`;
}

export function isAgentRunningStatus(status?: Agent['status'] | null): boolean {
  return status === 'running' || status === 'starting' || status === 'healthy' || status === 'warning';
}

export function isAgentProblemStatus(status?: Agent['status'] | null): boolean {
  return status === 'stuck' || status === 'stalled' || status === 'failed' || status === 'error' || status === 'unknown';
}

/** The issue is not moving and the operator has to look (FR-6 attention states). */
export function isIssueStuck(derived?: DerivedIssueState | null): boolean {
  return derived?.attention === 'stuck' || derived?.attention === 'api-error';
}

export function issueNeedsYou(derived?: DerivedIssueState | null): boolean {
  return derived?.attention === 'needs-you';
}

/**
 * Definition of Ready (PAN-1966): an issue is deliberately "ready to work" when
 * it carries a GitHub/GitLab `ready` label OR sits in a Linear `Todo` column
 * (stateType 'unstarted'). A raw open/backlog issue is NOT ready — readiness is
 * an explicit human act. See docs/PIPELINE-READY-AND-DONE.md.
 */
export function isPipelineReady(issue: Pick<Issue, 'labels' | 'stateType'>): boolean {
  return (issue.labels?.includes('ready') ?? false) || issue.stateType === 'unstarted';
}

/**
 * The issue's lane. The derived state decides it; the tracker's Definition of
 * Ready only splits unplanned work between the Ready and Backlog lanes.
 */
export function getPipelineIssuePhase(
  derived?: DerivedIssueState | null,
  issue?: Pick<Issue, 'labels' | 'stateType' | 'pipelineMembership'> | null,
): PipelineIssuePhase {
  // The canonical membership resolver still owns post-merge limbo — an issue
  // whose branch landed but whose tracker has not caught up (PAN-3341). It is
  // derived, not stored, so it outranks the tracker's lagging state.
  if (issue?.pipelineMembership?.available === true && issue.pipelineMembership.bucket === 'post_merge_limbo') {
    return 'ship';
  }
  if (!derived) return issue && isPipelineReady(issue) ? 'ready' : 'todo';
  if (derived.state === 'backlog' && issue && isPipelineReady(issue)) return 'ready';
  return PHASE_BY_DERIVED_STATE[derived.state];
}

/** The lanes the pipeline board renders, in order. 'todo' (raw backlog) is never shown (PAN-1966). */
export const PIPELINE_BOARD_PHASES = ['ship', 'review', 'work', 'plan', 'ready'] as const satisfies readonly PipelineIssuePhase[];

export function derivedForIssue(
  derivedByIssueId: Record<string, DerivedIssueState>,
  issue: Pick<Issue, 'identifier'>,
): DerivedIssueState | undefined {
  return derivedByIssueId[issue.identifier] ?? derivedByIssueId[issue.identifier.toUpperCase()];
}

function priorityRank(priority: number) {
  return 5 - priority;
}

export function comparePipelineIssues(a: Issue, b: Issue): number {
  const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
  if (priorityDelta !== 0) return priorityDelta;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function isClosedIssue(issue: Issue): boolean {
  const state = issue.state ?? issue.status;
  return issue.stateType === 'completed' || issue.stateType === 'canceled'
    || state === 'done' || state === 'canceled' || state === 'Canceled'
    || state === 'Closed' || state === 'Completed' || state === 'completed';
}

export function isOutsidePipeline(issue: Issue): boolean {
  return issue.pipelineMembership?.available !== false && issue.pipelineMembership
    ? issue.pipelineMembership.inPipeline !== true
    : isClosedIssue(issue);
}

/** First agent per issue, keyed by lowercase issue id — the row's agent on every pipeline surface. */
export function firstAgentByIssueId(agents: readonly Agent[]): Map<string, Agent> {
  const map = new Map<string, Agent>();
  for (const agent of agents) {
    const key = agent.issueId?.toLowerCase();
    if (key && !map.has(key)) {
      map.set(key, agent);
    }
  }
  return map;
}

/** Active issues grouped by board phase, each group sorted by comparePipelineIssues. */
export function groupPipelineIssues(
  issues: readonly Issue[],
  derivedByIssueId: Record<string, DerivedIssueState>,
): Record<(typeof PIPELINE_BOARD_PHASES)[number], Issue[]> {
  const groups = { ship: [], review: [], work: [], plan: [], ready: [] } as Record<(typeof PIPELINE_BOARD_PHASES)[number], Issue[]>;
  for (const issue of issues) {
    if (isOutsidePipeline(issue)) continue;
    const phase = getPipelineIssuePhase(derivedForIssue(derivedByIssueId, issue), issue);
    if (phase === 'todo') continue;
    groups[phase].push(issue);
  }
  for (const phase of PIPELINE_BOARD_PHASES) groups[phase].sort(comparePipelineIssues);
  return groups;
}
