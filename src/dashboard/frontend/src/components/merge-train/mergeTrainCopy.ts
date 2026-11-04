/**
 * Merge-train operator copy for the no-batch state (PAN-4598): the per-row
 * Merge confirmation, the retry-assembly confirmation, and the section line
 * that says what happened instead of promising a batch. Plain inputs only, so
 * this module never imports the view back.
 */

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
}

/** Short display name: uat/pan-otter-0610 → pan-otter-0610. */
export function shortName(name: string): string {
  return name.replace(/^uat\//, '');
}

/**
 * PAN-3965: the reconciler assembles no batch for a single ready feature — a
 * one-member batch is the PR branch itself and its CI run a duplicate — unless
 * the project holds merges for UAT, where that batch is the UAT stack.
 */
export const SINGLE_FEATURE_READY_LINE = '1 feature ready — merges directly; batches assemble when 2+ are ready.';

/** ` at Sep 20, 19:14` for a failed generation, or '' when its time is unreadable. */
export function formatFailedAt(gen: { updatedAt?: string; createdAt?: string }): string {
  const at = Date.parse(gen.updatedAt || gen.createdAt || '');
  if (!Number.isFinite(at)) return '';
  return ` at ${new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

/** The section line when no tested batch exists and nothing failed. */
export const NO_BATCH_YET_LINE = ' A test batch assembles at the next merge-train check, within a minute. Until then, you can merge a feature with its Merge button below.';
export const ASSEMBLING_LINE = ' A test batch is assembling below. Until it is ready, you can merge a feature on its own with its Merge button.';

export function assemblyFailedLine(failedName: string, failedAt: string): string {
  return ` The last batch assembly, ${failedName}, failed${failedAt}. No batch is ready to test, so merge a feature with its Merge button below, or retry batch assembly.`;
}

export function mergeRowConfirmCopy(input: {
  issueId: string;
  branchName: string;
  pr?: number;
  projectName: string;
  /** Unknown (undefined) is treated as held, like the rest of the view. */
  holdsForUat?: boolean;
  assembling: boolean;
}): ConfirmCopy {
  const pr = input.pr != null ? `, PR #${input.pr}` : '';
  const uatNote = input.holdsForUat === false
    ? ''
    : `\n\n${input.projectName} holds merges for UAT and no tested batch exists, so this merge skips batch testing.`;
  const assemblingNote = input.assembling ? '\n\nThe batch that is assembling rebuilds without it.' : '';
  return {
    title: `Merge ${input.issueId} to main?`,
    message: `Merges ${input.issueId} (${input.branchName}${pr}) to main in ${input.projectName}. The merge gate re-checks approval, CI and mergeability first, and the issue then closes out through the normal post-merge flow.${uatNote}${assemblingNote}`,
    confirmLabel: `Merge ${input.issueId} to main`,
  };
}

/**
 * Whether a forced reassembly can build a batch from this ready set. One
 * unheld feature merges directly — the reconciler returns `single-feature`
 * even when forced — so Retry is offered only for 2+ features or a held one.
 * PAN-4970: every ready feature merging through the per-PR auto-merge train
 * has no batch path at all, so Retry is never offered for that set either.
 */
export function canRetryAssembly(input: { featureCount: number; holdsForUat?: boolean; perPrCount?: number }): boolean {
  if (input.perPrCount === input.featureCount && input.featureCount > 0) return false;
  return input.featureCount >= 2 || (input.featureCount === 1 && input.holdsForUat !== false);
}

/**
 * PAN-4970: every ready feature in this section merges one at a time through
 * the per-PR auto-merge scheduler, so no test batch assembles for them.
 */
export function perPrTrainLine(count: number, projectName: string): string {
  return ` ${projectName} merges ${count === 1 ? 'it' : 'them'} one at a time through auto-merge (each waits a 5-minute cooldown), so no test batch assembles. Issues labelled hold-for-uat still batch.`;
}

/**
 * PAN-4970: a failed promote's toast and whether the operator's card is
 * stale. `wrong-status` and `not-found` mean the generation already changed
 * under them (promoted, invalidated, or gone) — the card should drop rather
 * than invite another doomed click. Plain inputs only, so `onError` can call
 * this with strings pulled off the thrown error.
 */
export function promoteFailureCopy(
  batchName: string,
  failure: { message?: string; reason?: string },
): { message: string; dropCard: boolean } {
  const detail = failure.message || 'Batch merge failed';
  const reason = failure.reason;
  const dropCard = reason === 'wrong-status' || reason === 'not-found';
  return {
    message: dropCard
      ? `Batch ${batchName} can no longer be merged: ${detail}. The list now shows the current batches.`
      : `Batch ${batchName} did not merge: ${detail}`,
    dropCard,
  };
}

export function retryAssemblyConfirmCopy(input: { projectName: string; failedName: string; readyCount: number }): ConfirmCopy {
  const { projectName, failedName, readyCount } = input;
  return {
    title: `Retry batch assembly for ${projectName}?`,
    message: `The last attempt, ${failedName}, failed. This builds a new test batch from ${projectName}'s ${readyCount} ready feature${readyCount === 1 ? '' : 's'} on a fresh branch off current main.\n\nIt runs git operations in ${projectName}. Nothing merges to main until you click Merge batch.`,
    confirmLabel: 'Retry batch assembly',
  };
}
