/**
 * Pure classification for stale PR checks inherited from a red main branch.
 *
 * GitHub CLI timestamps use one normalized ISO-8601 format, so chronological
 * comparisons here intentionally use their string representation.
 */

import { FAILING_CHECK_CONCLUSIONS } from '../webhook-handlers.js';

export interface WorkflowRun {
  databaseId: number;
  workflowName: string;
  createdAt: string;
  conclusion: string;
  status: string;
  attempt: number;
  headSha?: string;
}

export interface RedWindow {
  start: string;
  end: string | null;
}

export type RerunSkipReason =
  | 'attempt-exceeded'
  | 'main-still-red'
  | 'no-red-window-match'
  | 'not-completed'
  | 'missing-attempt';

const isCompleted = (run: WorkflowRun): boolean => run.status.toLowerCase() === 'completed';

const isFailing = (run: WorkflowRun): boolean =>
  FAILING_CHECK_CONCLUSIONS.has(run.conclusion.toUpperCase());

export function computeRedWindows(mainRuns: WorkflowRun[]): Map<string, RedWindow[]> {
  const runsByWorkflow = new Map<string, WorkflowRun[]>();

  for (const run of mainRuns) {
    if (!isCompleted(run)) continue;
    const runs = runsByWorkflow.get(run.workflowName) ?? [];
    runs.push(run);
    runsByWorkflow.set(run.workflowName, runs);
  }

  const result = new Map<string, RedWindow[]>();
  for (const [workflowName, runs] of runsByWorkflow) {
    const windows: RedWindow[] = [];
    let openWindow: RedWindow | null = null;

    for (const run of runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
      if (isFailing(run)) {
        if (!openWindow) {
          openWindow = { start: run.createdAt, end: null };
          windows.push(openWindow);
        }
      } else if (run.conclusion.toUpperCase() === 'SUCCESS' && openWindow) {
        openWindow.end = run.createdAt;
        openWindow = null;
      }
    }

    if (windows.length > 0) result.set(workflowName, windows);
  }

  return result;
}

export function selectRerunCandidates(
  prFailingRuns: WorkflowRun[],
  redWindows: ReturnType<typeof computeRedWindows>,
): {
  rerun: WorkflowRun[];
  skipped: Array<{ run: WorkflowRun; reason: RerunSkipReason }>;
} {
  const rerun: WorkflowRun[] = [];
  const skipped: Array<{ run: WorkflowRun; reason: RerunSkipReason }> = [];

  for (const run of prFailingRuns) {
    if (!isCompleted(run)) {
      skipped.push({ run, reason: 'not-completed' });
      continue;
    }
    if (typeof run.attempt !== 'number') {
      skipped.push({ run, reason: 'missing-attempt' });
      continue;
    }
    if (run.attempt !== 1) {
      skipped.push({ run, reason: 'attempt-exceeded' });
      continue;
    }
    if (!isFailing(run)) {
      skipped.push({ run, reason: 'no-red-window-match' });
      continue;
    }

    const containingWindow = (redWindows.get(run.workflowName) ?? []).find(({ start, end }) =>
      start <= run.createdAt && (end === null || run.createdAt < end));

    if (!containingWindow) {
      skipped.push({ run, reason: 'no-red-window-match' });
    } else if (containingWindow.end === null) {
      skipped.push({ run, reason: 'main-still-red' });
    } else {
      rerun.push(run);
    }
  }

  return { rerun, skipped };
}
