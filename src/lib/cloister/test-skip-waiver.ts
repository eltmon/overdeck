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
import { resolvePlanHome } from '../pan-dir/paths.js';
import { resolveProjectForIssue } from '../overdeck/issue-projects.js';
import { readContinueState } from '../xbrief/continue-state.js';

/** Decision id prefix the waiver is recorded under on the continue file. */
const TEST_SKIP_WAIVER_DECISION_PREFIX = 'D-test-removal-waived:';

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
 * The waiver on an issue's continue file when it covers `head`, else null.
 *
 * PAN-3917: the waiver used to live on the deleted per-issue record. It is a
 * decision an operator made about this issue, so it lives where the issue's
 * other decisions live — `<planHome>/.pan/continues/<ISSUE>.xbrief.json`, under
 * a decision id of `D-test-removal-waived:<sha>`. Read-only and best-effort:
 * an unreadable continue file simply means no waiver.
 */
export function resolveActiveTestSkipWaiverSync(issueId: string, head: string | undefined): TestSkipWaiver | null {
  if (!head) return null;
  try {
    const project = resolveProjectForIssue(issueId);
    if (!project) return null;
    const state = readContinueState(resolvePlanHome(project.path), issueId.toUpperCase());
    for (const decision of state?.decisions ?? []) {
      if (!decision.id.startsWith(TEST_SKIP_WAIVER_DECISION_PREFIX)) continue;
      const sha = decision.id.slice(TEST_SKIP_WAIVER_DECISION_PREFIX.length);
      const waiver: TestSkipWaiver = { sha, reason: decision.summary, at: decision.recordedAt };
      if (waiverCoversHead(waiver, head)) return waiver;
    }
    return null;
  } catch {
    return null;
  }
}
