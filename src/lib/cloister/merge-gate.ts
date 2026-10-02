/**
 * The merge gate for one issue: the forge's facts judged against the project's
 * and the issue's policy (#4016, #4021, #4036).
 *
 * `evaluateMergeReadiness` in `pr-facts.ts` is the pure rule. This module
 * resolves the two policy inputs it cannot know by itself:
 *
 *   - whether the project runs `verification.tests: ci` (#4021), in which case
 *     the CI test job must have passed on the PR head;
 *   - whether UAT is required for the issue (#4036), in which case a failed UAT
 *     verdict at the PR head blocks the merge.
 *
 * Every merge door asks this one function: the merge-ready set
 * (`getMergeReadyIssues`), the dashboard Merge button and the auto-merge
 * executor (both through `triggerMerge`), and the per-project merge queue.
 * Nothing is stored: each input is read from the forge, `projects.yaml`, the
 * tracker's labels, or the global setting at the moment it is asked.
 */
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { issueHoldsForUat } from './auto-merge-eligibility.js';
import {
  evaluateMergeReadiness,
  forgeApprovalAtHead,
  getPrFacts,
  type MergeReadiness,
  type PrFacts,
  type PrFactsOptions,
  type ReadGitHubReviews,
  recordApprovalAtHead,
  withForgeApprovalAtHead,
} from './pr-facts.js';
import { issueRunsTestsOnCi } from './verification-tests-mode.js';

export interface MergeGateDeps {
  getFacts?: (issueId: string, options?: PrFactsOptions) => Promise<PrFacts>;
  /** True when the issue's project runs `verification.tests: ci`. */
  ciTestsRequired?: (issueId: string) => boolean;
  /** True when UAT is required for the issue (the `issueHoldsForUat` tiers). */
  uatRequired?: (issueId: string) => Promise<boolean>;
  /** The GitHub reviews read that proves an approval of the head (`forgeApprovalAtHead`). */
  readReviews?: ReadGitHubReviews;
  /** The logins Overdeck posts as, for a review whose association alone is not trusted. */
  overdeckLogins?: () => Promise<readonly string[]>;
}

export interface MergeGateResult extends MergeReadiness {
  facts: PrFacts;
}

/** The issue's project config, or null when no project claims the issue. */
function projectConfigFor(issueId: string) {
  const resolved = resolveProjectFromIssueSync(issueId);
  return resolved ? getProjectSync(resolved.projectKey) : null;
}

export interface UatRequiredDeps {
  getIssueLabels?: (issueId: string) => Promise<string[]>;
  project?: { auto_merge_default?: unknown } | null;
  globalRequireUat?: boolean;
}

/**
 * #4036: UAT is required when the issue is held for UAT — the tiers
 * auto-merge eligibility applies: the `auto-merge` / `hold-for-uat` label, else
 * the project's `auto_merge_default`, else the global
 * `flywheel.require_uat_before_merge`. An `auto-merge` label is the operator
 * saying UAT is not required, so a failed verdict there is advisory.
 *
 * Strict: a label read that fails throws (the gate then holds) rather than
 * falling back to the project and global tiers, which could not see an
 * `auto-merge` or `hold-for-uat` label either way.
 */
export async function defaultUatRequired(issueId: string, deps: UatRequiredDeps = {}): Promise<boolean> {
  const globalRequireUat = deps.globalRequireUat
    ?? (await import('../overdeck/control-settings.js')).isFlywheelRequireUatBeforeMerge();
  const project = deps.project !== undefined ? deps.project : projectConfigFor(issueId);
  return issueHoldsForUat(issueId, project, globalRequireUat, {
    strict: true,
    ...(deps.getIssueLabels ? { getIssueLabels: deps.getIssueLabels } : {}),
  });
}

/**
 * Is this issue's PR ready to merge right now? Never throws: a failed forge
 * read comes back not-ready with the lookup error as the reason.
 *
 * The UAT requirement is resolved only when a failed UAT verdict applies to the
 * head, so the common case costs no tracker label read.
 *
 * #3983: on GitHub the approval must be proven on the exact head: a trusted
 * verdict marker whose `sha=` is the head, or a GitHub review approving that
 * commit. `reviewDecision` alone, a marker without `sha=`, or a marker naming
 * another commit never approves a merge. The reviews are read only when no
 * marker already proves it and the PR is otherwise green and mergeable.
 */
export async function evaluateIssueMergeGate(
  issueId: string,
  deps: MergeGateDeps = {},
  options: PrFactsOptions = {},
): Promise<MergeGateResult> {
  const read = deps.getFacts
    ? await deps.getFacts(issueId, options)
    : await getPrFacts(issueId, {}, options);
  const facts = await withForgeApprovalAtHead(read, deps.readReviews, deps.overdeckLogins);
  // #4066 review: the board's derived `ready` reads this answer (no forge read).
  recordApprovalAtHead(facts);
  const ciTestsRequired = facts.forge === 'github' && (deps.ciTestsRequired ?? issueRunsTestsOnCi)(issueId);
  let uatRequired = false;
  if (facts.uatVerdict?.status === 'failed') {
    try {
      uatRequired = await (deps.uatRequired ?? defaultUatRequired)(issueId);
    } catch {
      // The requirement could not be read; a failed UAT at this head holds.
      uatRequired = true;
    }
  }
  return {
    ...evaluateMergeReadiness(facts, { ciTestsRequired, uatRequired, requireApprovalAtHead: true }),
    facts,
  };
}

export interface ConflictRepairGateResult {
  /** True when the PR is merge-ready in every respect except `mergeable: false`. */
  conflicting: boolean;
  /**
   * PAN-4467: GitHub only. The forge approved an older head but no approval
   * is proven at this one; the repaired head needs a fresh review.
   */
  staleApproval?: boolean;
  reason?: string;
  facts: PrFacts;
}

/**
 * PAN-4384: is this PR merge-ready except for a conflict with its base? The
 * same policy as evaluateIssueMergeGate, judged as if the forge said
 * `mergeable`. Approval must stand at the head: a marker, else a GitHub review
 * of the head read directly (withForgeApprovalAtHead skips unmergeable PRs).
 *
 * PAN-4451: CI evidence is waived. GitHub builds no merge ref for a conflicting
 * PR, so pull_request CI never runs on it; pending, absent or test-job-less
 * checks pass. Red checks still disqualify. The merge gate re-judges CI on the
 * repaired head.
 *
 * PAN-4467: a GitHub approval of an older head (the head moved since the
 * approving review) still counts here and is reported as `staleApproval`; the
 * merge gate still needs approval at the repaired head. A PR the forge does
 * not call approved at any head is not repaired.
 */
export async function evaluateConflictRepairGate(
  issueId: string,
  deps: MergeGateDeps = {},
): Promise<ConflictRepairGateResult> {
  const facts = deps.getFacts ? await deps.getFacts(issueId) : await getPrFacts(issueId);
  if (facts.error || !facts.open || facts.mergeable !== false) {
    return { conflicting: false, reason: facts.error ?? 'PR is not conflicting', facts };
  }
  if (facts.draft || facts.changesRequested) {
    return { conflicting: false, reason: 'PR is not otherwise merge-ready', facts };
  }
  // PAN-4451: GitHub builds no merge ref for a conflicting PR, so pull_request CI
  // never runs on it and its head cannot get a test result. Only a red head
  // disqualifies; the merge gate re-judges CI on the repaired head.
  if (facts.checks === 'red') {
    return { conflicting: false, reason: `CI checks failing on PR HEAD ${facts.headSha ?? 'unknown'}`, facts };
  }
  let approvedAtHead = facts.approvedAtHead === true;
  if (!approvedAtHead && facts.forge === 'github') {
    approvedAtHead = (await forgeApprovalAtHead(facts, deps.readReviews, deps.overdeckLogins)) === true;
  }
  // PAN-4467: an approval of an older head still routes a repair. Nothing
  // merges on it: the merge gate needs approval at the repaired head.
  const staleApproval = facts.forge === 'github' && !approvedAtHead && facts.approved === true;
  const asMergeable: PrFacts = {
    ...facts,
    mergeable: true,
    checks: 'green',
    ...(approvedAtHead || staleApproval ? { approvedAtHead: true } : {}),
  };
  let uatRequired = false;
  if (facts.uatVerdict?.status === 'failed') {
    try {
      uatRequired = await (deps.uatRequired ?? defaultUatRequired)(issueId);
    } catch {
      uatRequired = true;
    }
  }
  const readiness = evaluateMergeReadiness(asMergeable, { ciTestsRequired: false, uatRequired, requireApprovalAtHead: true });
  if (!readiness.ready) return { conflicting: false, reason: readiness.reason, facts };
  return staleApproval ? { conflicting: true, staleApproval: true, facts } : { conflicting: true, facts };
}

/**
 * PAN-4384: does the PR's approval stand at its current head? `true` when a
 * marker or a GitHub review names the head, `false` when the forge proves it
 * does not (the head moved since the approving review), `undefined` when it
 * cannot tell (lookup failed, GitLab, no PR).
 *
 * The facts are read fresh: a branch read is neither served from nor stored
 * in the PR-facts or PR-tab caches, and a cached pre-push head would answer
 * for the old head right after the agent pushed a new one.
 */
export async function readApprovalStandsAtHead(
  issueId: string,
  deps: Pick<MergeGateDeps, 'getFacts' | 'readReviews' | 'overdeckLogins'> = {},
): Promise<boolean | undefined> {
  const fresh: PrFactsOptions = { preferBranch: `feature/${issueId.toLowerCase()}` };
  const facts = deps.getFacts ? await deps.getFacts(issueId, fresh) : await getPrFacts(issueId, {}, fresh);
  if (facts.error || !facts.open) return undefined;
  if (facts.approvedAtHead === true) return true;
  if (facts.forge !== 'github') return undefined;
  return forgeApprovalAtHead(facts, deps.readReviews, deps.overdeckLogins);
}
