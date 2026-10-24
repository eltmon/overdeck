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
 */
export function canRetryAssembly(input: { featureCount: number; holdsForUat?: boolean }): boolean {
  return input.featureCount >= 2 || (input.featureCount === 1 && input.holdsForUat !== false);
}

export function retryAssemblyConfirmCopy(input: { projectName: string; failedName: string; readyCount: number }): ConfirmCopy {
  const { projectName, failedName, readyCount } = input;
  return {
    title: `Retry batch assembly for ${projectName}?`,
    message: `The last attempt, ${failedName}, failed. This builds a new test batch from ${projectName}'s ${readyCount} ready feature${readyCount === 1 ? '' : 's'} on a fresh branch off current main.\n\nIt runs git operations in ${projectName}. Nothing merges to main until you click Merge batch.`,
    confirmLabel: 'Retry batch assembly',
  };
}
