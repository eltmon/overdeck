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
 * PAN-4852 (AD-21): it runs the repository merge guards (Deft, SageOx) through
 * one `evaluateRepoMergeGuards` call.
 * Nothing is stored: each input is read from the forge, `projects.yaml`, the
 * tracker's labels, or the global setting at the moment it is asked.
 */
import { isDeftPipelineIssue } from '../deft/issue-pipeline.js';
import { type DeftGuardVerdict, deftMergeGuardForIssue } from '../deft/merge-guard.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { issueHoldsForUat } from './auto-merge-eligibility.js';
import { DEFT_NO_HEAD_REASON, evaluateRepoMergeGuards, type RepoGuardFacts, type RepoGuardVerdict } from './repo-merge-guards.js';
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
  /** PAN-4820: true when the issue runs on Deft Directive's pipeline. */
  isDeftPipeline?: (issueId: string) => Promise<boolean>;
  /** PAN-4820: the Deft merge guard for the issue's PR at a head. */
  deftGuard?: (issueId: string, headSha: string | null) => Promise<DeftGuardVerdict & { drifted: string[] }>;
  /** PAN-4852: the repository merge guards; by default Deft (from the two deps above) then SageOx. */
  repoGuards?: (issueId: string, facts: RepoGuardFacts) => Promise<RepoGuardVerdict>;
}

/**
 * PAN-4540: GitHub recomputes `mergeable` after the base branch moves and
 * answers UNKNOWN (null) meanwhile. The first gate read after another PR
 * merges usually lands in that window, so an otherwise-ready PR is read once
 * more after this delay before the gate decides.
 */
export const MERGEABILITY_REREAD_MS = 3_000;

/** An open, green PR whose only missing fact may be the forge's mergeability. */
function mergeabilityPending(facts: PrFacts): boolean {
  return !facts.error && facts.open && !facts.draft && facts.checks === 'green' && facts.mergeable === null;
}

export interface MergeGateResult extends MergeReadiness {
  facts: PrFacts;
  /** PAN-4820: Deft-hidden files edited outside any commit; the caller raises an operator decision. */
  deftDrift?: string[];
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
 * PAN-4750: `requireApprovalAtHead` defaults to true. Only an operator-started
 * strike merge passes `false`, which waives approval entirely: a strike PR is
 * authored as the operator, who cannot approve their own PR. Every other check
 * (draft, changes requested, checks, CI test job, UAT, mergeability) still applies.
 *
 * PAN-4820 (AD-4): a Deft issue defaults to `false` too, because no Overdeck
 * reviewer runs for it; the person who clicks Merge is the approval. Its PR
 * must also pass the Deft merge guard.
 */
export interface MergeGateOptions extends PrFactsOptions {
  requireApprovalAtHead?: boolean;
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
  options: MergeGateOptions = {},
): Promise<MergeGateResult> {
  const deft = await (deps.isDeftPipeline ?? isDeftPipelineIssue)(issueId);
  const { requireApprovalAtHead = !deft, ...readOptions } = options;
  const getFacts = (readOptions: PrFactsOptions) => deps.getFacts
    ? deps.getFacts(issueId, readOptions)
    : getPrFacts(issueId, {}, readOptions);
  let read = await getFacts(readOptions);
  if (mergeabilityPending(read)) {
    await new Promise<void>((resolve) => setTimeout(resolve, MERGEABILITY_REREAD_MS));
    read = await getFacts({ ...readOptions, fresh: true });
  }
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
  const readiness = evaluateMergeReadiness(facts, {
    ciTestsRequired, uatRequired, requireApprovalAtHead, requireApproval: requireApprovalAtHead,
  });
  // The Deft guard runs for every Deft issue (PAN-4820); SageOx only when the
  // PR is otherwise ready (AD-19). A non-Deft PR that is not ready runs neither.
  if (readiness.ready || deft) {
    const repoGuards = deps.repoGuards
      ?? ((id: string, guardFacts: RepoGuardFacts) => evaluateRepoMergeGuards(id, guardFacts, {
        deft: async (guardId, headSha) => {
          if (!deft) return null;
          // The guard judges the PR's diff at a head; with no head (a GitLab read can
          // lack one) there is nothing to judge, so a Deft PR is refused, not waved through.
          if (!headSha) return { ok: false, reason: DEFT_NO_HEAD_REASON };
          return (deps.deftGuard ?? deftMergeGuardForIssue)(guardId, headSha);
        },
      }));
    const verdict = await repoGuards(issueId, {
      headSha: facts.headSha,
      headBranch: facts.headBranch,
      otherwiseReady: readiness.ready,
    });
    if (!verdict.ok) {
      return { ...readiness, ready: false, reason: verdict.reason, facts, ...(verdict.deftDrift ? { deftDrift: verdict.deftDrift } : {}) };
    }
  }
  return { ...readiness, facts };
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
 * checks pass. Red checks still disqualify, unless every failing check was
 * cancelled, timed out or went stale (PAN-4917). The merge gate re-judges CI
 * on the repaired head.
 *
 * PAN-4467: a GitHub approval of an older head (the head moved since the
 * approving review) still counts here and is reported as `staleApproval`; the
 * merge gate still needs approval at the repaired head. A PR the forge does
 * not call approved at any head is not repaired.
 */

/**
 * PAN-4917: conclusions of a check that stopped before it judged the code.
 * GitHub reports a job killed by its own timeout-minutes as CANCELLED, the same
 * as a run a newer push superseded, so the rule is by conclusion, not cause.
 */
const UNFINISHED_CHECK_CONCLUSIONS = new Set(['CANCELLED', 'TIMED_OUT', 'STALE']);

/**
 * PAN-4917: why a red head is not repaired, naming each failing check, or null
 * when every failing check is unfinished. The repair pushes a new head that CI
 * runs again, and the merge gate judges CI there. With no per-check detail
 * (GitLab) a red head still declines.
 */
function redHeadDeclineReason(facts: PrFacts): string | null {
  const failures = facts.checkFailures ?? [];
  if (failures.length > 0 && failures.every((check) => UNFINISHED_CHECK_CONCLUSIONS.has(check.conclusion))) return null;
  const named = failures.map((check) => `${check.name} (${check.conclusion})`).join(', ');
  return `CI checks failing on PR HEAD ${facts.headSha ?? 'unknown'}${named ? `: ${named}` : ''}`;
}

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
  // disqualifies, and not one whose failing checks never finished (PAN-4917);
  // the merge gate re-judges CI on the repaired head.
  if (facts.checks === 'red') {
    const reason = redHeadDeclineReason(facts);
    if (reason) return { conflicting: false, reason, facts };
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
