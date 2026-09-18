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
  issue?: Pick<Issue, 'labels' | 'stateType'> | null,
): PipelineIssuePhase {
  if (!derived) return issue && isPipelineReady(issue) ? 'ready' : 'todo';
  if (derived.state === 'backlog' && issue && isPipelineReady(issue)) return 'ready';
  return PHASE_BY_DERIVED_STATE[derived.state];
}
