/**
 * Active-review artifact evidence (PAN-3511).
 *
 * Review artifacts live in a workspace, so they are evidence for recovery, not
 * an authority to write a terminal review status. The canonical verdict enters
 * through recordReviewVerdict when `pan admin specialists done review` runs.
 *
 * Recovery callers must supply the host-recorded active review run ID. Binding
 * the read to that run prevents an older review cycle from affecting a newer
 * reviewing row and avoids scanning arbitrary workspace-owned run directories.
 */
import { readLatestSynthesisVerdict, type SynthesisArtifactVerdict } from './synthesis-verdict.js';

export interface ActiveReviewArtifactOptions {
  runId?: string;
  workspacePath?: string;
  now?: number;
}

/**
 * Return fresh artifact evidence for the host-recorded active review run.
 * Missing run identity is intentionally no evidence: a workspace artifact
 * cannot independently complete a review.
 */
export function readActiveReviewArtifact(
  issueId: string,
  options: ActiveReviewArtifactOptions,
): SynthesisArtifactVerdict | null {
  if (!options.runId) return null;
  return readLatestSynthesisVerdict(issueId, {
    runId: options.runId,
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}
