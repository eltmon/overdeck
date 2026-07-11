/**
 * PAN-1862 (FR-7, NFR-1): pure selection logic for selective re-review.
 *
 * On a re-review cycle (the work agent committed fixes after a BLOCKED verdict),
 * `roles.review.reReviewScope` governs which convoy reviewers actually re-run:
 *
 *   - `all`      — re-run all four reviewers every cycle (pre-PAN-1862 behavior).
 *   - `changed`  — (default) re-run reviewers that blocked, PLUS any reviewer whose
 *                  domain is touched by the files changed since its recorded verdict.
 *   - `blockers` — re-run only reviewers that blocked in the prior cycle.
 *
 * Reviewers NOT re-run carry their prior `passed` verdict forward; the dispatch
 * path materializes that as a stub report in the new run directory so synthesis
 * and the deacon fallback see four reports exactly as before.
 *
 * Quality-first bias (NFR-1): whenever the inputs are insufficient to prove a
 * reviewer can be skipped — no prior verdicts, a verdict without a commit anchor,
 * or an unknown changed-file set — the reviewer is INCLUDED. Skipping is only
 * ever an optimization on proven-safe ground.
 */

import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';

export type ReReviewScope = 'all' | 'changed' | 'blockers';

export interface ReviewerVerdictEntry {
  status: 'passed' | 'blocked';
  /** HEAD sha the verdict was recorded against (anchor for drift invalidation). */
  atCommit?: string;
  /** Path to the reviewer's findings report for that cycle. */
  findingsPath?: string;
}

export type ReviewerVerdictsMap = Partial<Record<ReviewSubRole, ReviewerVerdictEntry>>;

/**
 * Domain map for `changed` scope (PRD "open question", resolved conservatively):
 * `correctness` and `requirements` are in scope whenever ANY file changed;
 * `security` when a security-sensitive path changed; `performance` when a
 * hot-path-ish file changed. Patterns err toward matching (include the reviewer).
 */
const SECURITY_SENSITIVE = /auth|crypt|token|secret|credential|password|session|login|permission|sandbox|escape|inject|input|parse|network|http|request|fetch|socket|proxy|exec|spawn|shell|env|\.env|package(-lock)?\.json|bun\.lock|yarn\.lock|Dockerfile|docker-compose/i;
const PERFORMANCE_SENSITIVE = /query|sql|db|database|cache|index|loop|batch|stream|worker|pool|queue|schedul|poll|interval|timer|migration|perf|bench|concurren|parallel/i;

function domainTouched(subRole: ReviewSubRole, changedFiles: readonly string[]): boolean {
  if (changedFiles.length === 0) return false;
  switch (subRole) {
    case 'correctness':
    case 'requirements':
      return true; // every change is in scope for correctness + requirements
    case 'security':
      return changedFiles.some(f => SECURITY_SENSITIVE.test(f));
    case 'performance':
      return changedFiles.some(f => PERFORMANCE_SENSITIVE.test(f));
    default:
      return true; // unknown sub-role → include (fail toward quality)
  }
}

export interface ReviewersToRerunInput {
  scope: ReReviewScope;
  /** Prior cycle's per-reviewer verdicts; absent/empty = first cycle → all run. */
  priorVerdicts?: ReviewerVerdictsMap;
  /**
   * Files changed since the prior verdicts' commit anchor. `undefined` means the
   * changed set could NOT be determined — every reviewer runs (fail toward quality).
   */
  changedFiles?: readonly string[];
}

export function reviewersToRerun(input: ReviewersToRerunInput): ReviewSubRole[] {
  const all = [...REVIEW_SUB_ROLES];
  if (input.scope === 'all') return all;

  const verdicts = input.priorVerdicts ?? {};
  // A reviewer with no recorded verdict, or a verdict with no commit anchor,
  // cannot be proven safe to skip — it always runs.
  const unproven = all.filter(r => !verdicts[r] || !verdicts[r]!.atCommit);
  const blocked = all.filter(r => verdicts[r]?.status === 'blocked');

  if (input.scope === 'blockers') {
    return dedupe([...blocked, ...unproven]);
  }

  // scope === 'changed'
  if (input.changedFiles === undefined) return all; // unknown drift → everyone runs
  const touched = all.filter(r => verdicts[r]?.status === 'passed' && verdicts[r]!.atCommit && domainTouched(r, input.changedFiles!));
  return dedupe([...blocked, ...unproven, ...touched]);
}

function dedupe(roles: ReviewSubRole[]): ReviewSubRole[] {
  // Preserve the canonical REVIEW_SUB_ROLES ordering for stable prompts/logs.
  const set = new Set(roles);
  return REVIEW_SUB_ROLES.filter(r => set.has(r));
}
