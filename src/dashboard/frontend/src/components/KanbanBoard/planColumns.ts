/**
 * PAN-2908 C-BOARD v2 — column assembly incl. the Plan split.
 * Extracted from KanbanBoard.tsx (file-size ratchet).
 */
import { STATUS_ORDER, type Issue, type Agent, type CanonicalState } from '../../types';
import { COLUMN_TITLES } from './kanban-utils';
import type { PlanningState } from './types';

export interface BoardColumn {
  key: CanonicalState | 'plan';
  title: string;
  issues: Issue[];
  rollup?: boolean;
}

/** Split todo into plan-phase (active planning agent, or a plan ready to
 *  start) vs plain backlog, then assemble the full column order. */
export function buildBoardColumns(
  sortedGrouped: Record<string, Issue[]>,
  agents: Agent[],
  planningStateById: Record<string, PlanningState>,
): BoardColumn[] {
  const planIssues: Issue[] = [];
  const todoRest: Issue[] = [];
  for (const issue of sortedGrouped.todo ?? []) {
    const hasActivePlanning = agents.some(
      (a) => a.id?.startsWith('planning-') && a.issueId?.toLowerCase() === issue.identifier.toLowerCase() && !['stopped', 'dead', 'failed'].includes(a.status),
    );
    const hasPlanReady = planningStateById[issue.identifier]?.hasPlan === true;
    if (hasActivePlanning || hasPlanReady) planIssues.push(issue);
    else todoRest.push(issue);
  }
  return [
    { key: 'todo', title: COLUMN_TITLES.todo, issues: todoRest, rollup: true },
    { key: 'plan', title: 'Plan', issues: planIssues },
    ...STATUS_ORDER.filter((s) => s !== 'backlog' && s !== 'todo').map((s) => ({ key: s, title: COLUMN_TITLES[s], issues: sortedGrouped[s] })),
  ];
}
