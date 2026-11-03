/**
 * The repository merge guards (PAN-4852 WI-16, AD-21): the rules about what a
 * PR's diff may carry, composed into one call per merge door.
 *
 *   - Deft (PAN-4820): a Deft issue's PR may not carry Directive install paths,
 *     edited Deft-hidden files, or a stale Deft state archive. It runs for every
 *     Deft issue, whatever the PR's readiness, so drift reaches the operator as
 *     soon as a merge door looks.
 *   - SageOx (PAN-4852 WI-15): a PR may not carry `.sageox/` link files unless
 *     the project opted in to committing them. It runs for every issue, but
 *     only when the PR is otherwise ready (AD-19), which bounds its cost to one
 *     local diff (and at most one fetch) per ready PR.
 *
 * The first refusal wins, Deft first. Both guards fail closed: a head or a
 * diff they cannot read refuses the merge.
 *
 * `evaluateIssueMergeGate` (the merge-ready set, the Merge button, the
 * auto-merge executor, the merge queue, approval refresh) and the
 * `POST /api/issues/:issueId/forge-merge` route each call this once.
 */
import { isDeftPipelineIssue } from '../deft/issue-pipeline.js';
import { deftMergeGuardForIssue } from '../deft/merge-guard.js';
import { sageoxMergeGuardForIssue } from '../sageox/merge-guard.js';

export interface RepoGuardFacts {
  headSha: string | null;
  headBranch: string | null;
  /**
   * False when the PR is not otherwise merge-ready: only the Deft guard runs.
   * Omitted means ready (the forge-merge route has no readiness to report).
   */
  otherwiseReady?: boolean;
}

export interface RepoGuardDeps {
  /** The Deft guard for the issue's PR, or null for an issue that is not on Deft's pipeline. */
  deft?: (issueId: string, headSha: string | null) => Promise<{ ok: boolean; reason?: string; drifted?: string[] } | null>;
  sageox?: typeof sageoxMergeGuardForIssue;
}

export type RepoGuardVerdict = { ok: true } | { ok: false; reason: string; deftDrift?: string[] };

/** The merged gate's refusal for a Deft PR the forge reported no head for. */
export const DEFT_NO_HEAD_REASON = 'the Deft merge guard needs the PR head, and the forge reported none';

/**
 * PAN-4820's guard for a Deft issue, null otherwise. A null head is resolved
 * by `deftMergeGuardForIssue` from the PR facts, and refuses when it cannot be.
 */
async function defaultDeftGuard(issueId: string, headSha: string | null) {
  if (!(await isDeftPipelineIssue(issueId))) return null;
  return deftMergeGuardForIssue(issueId, headSha);
}

export async function evaluateRepoMergeGuards(
  issueId: string,
  facts: RepoGuardFacts,
  deps: RepoGuardDeps = {},
): Promise<RepoGuardVerdict> {
  const deft = await (deps.deft ?? defaultDeftGuard)(issueId, facts.headSha);
  if (deft && !deft.ok) {
    return {
      ok: false,
      reason: deft.reason ?? `the Deft merge guard refused ${issueId.toUpperCase()}`,
      ...(deft.drifted ? { deftDrift: deft.drifted } : {}),
    };
  }
  if (facts.otherwiseReady === false) return { ok: true };
  const sageox = await (deps.sageox ?? sageoxMergeGuardForIssue)(issueId, facts.headSha, facts.headBranch);
  return sageox.ok ? { ok: true } : { ok: false, reason: sageox.reason };
}
