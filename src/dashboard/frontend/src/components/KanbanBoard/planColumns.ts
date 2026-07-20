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
  /** Done-cap: how many issues the cap hides (0/undefined = uncapped). */
  overflowCount?: number;
  /** Done-cap: the uncapped, recency-sorted list for the "show all" expansion. */
  fullIssues?: Issue[];
}

/** PAN-2908 C-BOARD: the Done column collapses to the cycle's recent N. */
export const DONE_DISPLAY_LIMIT = 12;

function byRecencyDesc(a: Issue, b: Issue): number {
  return (b.completedAt ?? b.updatedAt ?? '').localeCompare(a.completedAt ?? a.updatedAt ?? '');
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
    ...STATUS_ORDER.filter((s) => s !== 'backlog' && s !== 'todo').map((s) => {
      const issues = sortedGrouped[s] ?? [];
      // Done renders the cycle's recent N — a wall of finished cards is
      // storage, not a view (the board's job is WIP).
      if (s === 'done' && issues.length > DONE_DISPLAY_LIMIT) {
        const sorted = [...issues].sort(byRecencyDesc);
        return {
          key: s as CanonicalState | 'plan',
          title: COLUMN_TITLES[s],
          issues: sorted.slice(0, DONE_DISPLAY_LIMIT),
          overflowCount: issues.length - DONE_DISPLAY_LIMIT,
          fullIssues: sorted,
        };
      }
      return { key: s as CanonicalState | 'plan', title: COLUMN_TITLES[s], issues };
    }),
  ];
}
