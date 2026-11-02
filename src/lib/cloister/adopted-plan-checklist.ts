/**
 * PAN-4786: a PR adopted into a pipeline workspace (PAN-4605) was opened outside the
 * pipeline and has no xBRIEF, so the plan checklist gate could never pass. When the
 * workspace journal shows an adoption and no xBRIEF resolves for the issue,
 * verification skips the checklist through the existing `skipPlanChecklist` option —
 * the same skip strike merges use. An xBRIEF, when one exists, is still enforced.
 *
 * PAN-4810: an adoption is `workspace.adopted` or `workspace.adoption-failed`. Only
 * adoption writes either, so both mean the PR came from outside the pipeline; a
 * failed adoption whose workspace verification later moved to the PR head must not
 * stall on a plan it never had. A feedback-only `.pan/continues/<id>.xbrief.json`
 * (written by a failed run) is not a plan: `findPlan` reads specs and drafts only.
 * The runner asks again at the checklist step, because a review requested while
 * adoption was still creating the workspace is dispatched before the journal entry.
 */
import { Effect } from 'effect';

import { findPlan } from '../xbrief/io.js';
import { readPipelineJournal } from './pipeline-journal.js';
import type { VerificationRunnerOptions } from './verification-types.js';

const ADOPTION_ENTRIES = new Set(['workspace.adopted', 'workspace.adoption-failed']);

/** True when the workspace was adopted from an outside PR and no xBRIEF resolves for its issue. */
export async function isAdoptedWorkspaceWithoutPlan(workspacePath: string): Promise<boolean> {
  if (!readPipelineJournal(workspacePath).some((entry) => ADOPTION_ENTRIES.has(entry.type))) return false;
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
