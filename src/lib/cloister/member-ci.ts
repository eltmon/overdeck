/**
 * PAN-5637: the CI waiver for polyrepo member repos that run no CI.
 *
 * A checks verdict of `none` (the forge reported no pipeline for the head) is
 * the absence of evidence, so merge readiness refuses it (FR-9). A member repo
 * that declares `ci: none` in `projects.yaml` has no CI by the operator's own
 * statement; for an MR there, `none` passes. `red` and `pending` never pass,
 * so a repo that later gains a failing pipeline still blocks. The ready set,
 * the merge gate and the merge-train board all ask this one predicate.
 */

/** True when the checks verdict lets a merge through. */
export function checksPass(facts: { readonly checks: string; readonly ciNone?: boolean }): boolean {
  return facts.checks === 'green' || (facts.checks === 'none' && facts.ciNone === true);
}

/** The facts marked `ciNone` when the member repo they were read from declares `ci: none`. */
export function withMemberCi<T extends object>(facts: T, repo: { readonly ciNone?: boolean }): T {
  return repo.ciNone === true ? { ...facts, ciNone: true } : facts;
}
