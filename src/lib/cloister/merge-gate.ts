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
  getPrFacts,
  type MergeReadiness,
  type PrFacts,
  type PrFactsOptions,
  type ReadGitHubReviews,
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
