/**
 * PAN-4786: a PR adopted into a pipeline workspace (PAN-4605) was opened outside the
 * pipeline and has no xBRIEF, so the plan checklist gate could never pass. When the
 * workspace journal shows `workspace.adopted` and no xBRIEF resolves for the issue,
 * verification skips the checklist through the existing `skipPlanChecklist` option —
 * the same skip strike merges use. An xBRIEF, when one exists, is still enforced.
 */
import { Effect } from 'effect';

import { findPlan } from '../xbrief/io.js';
import { readPipelineJournal } from './pipeline-journal.js';
import type { VerificationRunnerOptions } from './verification-types.js';

/** True when the workspace was adopted from an outside PR and no xBRIEF resolves for its issue. */
export async function isAdoptedWorkspaceWithoutPlan(workspacePath: string): Promise<boolean> {
  if (!readPipelineJournal(workspacePath).some((entry) => entry.type === 'workspace.adopted')) return false;
  const planPath = await Effect.runPromise(
    findPlan(workspacePath).pipe(Effect.orElseSucceed(() => 'unreadable' as const)),
  );
  return planPath === null;
}

/** The caller's options, with `skipPlanChecklist: true` added for an adopted workspace that has no xBRIEF. */
export async function withAdoptedPlanChecklistSkip<T extends Pick<VerificationRunnerOptions, 'skipPlanChecklist'>>(
  workspacePath: string,
  options: T,
): Promise<T> {
  if (options.skipPlanChecklist) return options;
  if (!(await isAdoptedWorkspaceWithoutPlan(workspacePath))) return options;
  console.log(`[verification] ${workspacePath}: adopted PR workspace with no xBRIEF — skipping the plan checklist (PAN-4786)`);
  return { ...options, skipPlanChecklist: true };
}
