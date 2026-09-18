/**
 * Operator waiver for the test-skip gate's `removed-test` rule (PAN-3906).
 *
 * The whole-diff balance and the deleted-subject exemption cover the mechanical
 * cases. What is left is a judgment call only a human can make: "these tests
 * are genuinely gone and nothing replaces them." `pan verify waive-test-removal
 * <id> --reason "…"` records that judgment against ONE head anchor, so the
 * waiver expires the moment the branch moves — a new commit gets a fresh gate,
 * not an open door. It never waives an added `.skip`/`.only`.
 */
import { readIssueRecordSync, resolveProjectForIssue } from '../pan-dir/record.js';

export interface TestSkipWaiver {
  /** Head anchor the waiver was granted against (`snapshotWorkspaceHeadsPromise` format). */
  sha: string;
  reason: string;
  at: string;
  /** Who granted it — an operator conversation id, or `operator` for a plain shell. */
  by?: string;
}

/** A waiver applies only to the exact head it was granted against. */
export function waiverCoversHead(waiver: TestSkipWaiver | undefined, head: string | undefined): boolean {
  if (!waiver?.sha || !head) return false;
  return waiver.sha.trim() === head.trim();
}

/**
 * The waiver on an issue's record when it covers `head`, else null. Read-only
 * and best-effort: an unreadable record simply means no waiver.
 */
export function resolveActiveTestSkipWaiverSync(issueId: string, head: string | undefined): TestSkipWaiver | null {
  if (!head) return null;
  try {
    const project = resolveProjectForIssue(issueId);
    if (!project) return null;
    const waiver = readIssueRecordSync(project, issueId)?.pipeline?.testSkipWaiver;
    return waiverCoversHead(waiver, head) ? waiver! : null;
  } catch {
    return null;
  }
}
