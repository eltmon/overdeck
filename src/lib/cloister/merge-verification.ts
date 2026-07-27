import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { resolveProjectFromIssueSync } from '../projects.js';
import { isGitHubAppConfigured, listPullRequestsForHead } from '../github-app.js';
import { getMergeSetSync } from '../merge-set.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { assessMergeCompleteness, hasPositiveMergedEvidence } from './merge-completeness.js';
import type { VerificationRunnerOutcome } from './verification-types.js';

const execAsync = promisify(exec);

/**
 * One repo's positive merge evidence from a polyrepo batch promotion
 * (PAN-3093): a real merge commit, in a real git repo, against the branch that
 * repo actually targets.
 */
export interface VerifiedMergedRepo {
  repoKey: string;
  /** Absolute path to that member repo's git root — NOT the wrapper. */
  repoPath: string;
  /** The merge commit published to `targetBranch`. */
  mergeSha: string;
  /** The branch it was published to; often but not always `main`. */
  targetBranch: string;
}

export interface PostMergeLifecycleOptions {
  skipDeploy?: boolean;
  allowVerifiedNoPrMerge?: boolean;
  markReviewPassed?: boolean;
  verifiedMergedRef?: string;
  /**
   * Per-repo merge evidence for a batch promotion that spans several repos.
   * The single-ref `verifiedMergedRef` cannot express this: its ancestry check
   * runs one `git merge-base` against `origin/main` in the PROJECT path, which
   * for a polyrepo project is a wrapper with no git repo, and the repos may
   * target branches other than main.
   */
  verifiedMergedRepos?: readonly VerifiedMergedRepo[];
}

type MergeStatus = 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';

type MergeStateBeforeAttempt = {
  mergeStatus?: MergeStatus;
  mergeStep?: string;
  mergeNotes?: string;
} | null | undefined;

type PostRebaseVerificationDeferralDeps = {
  appendShipLog: (issueId: string, message: string, phase: 'verifying') => void;
  setReviewStatus: (issueId: string, update: {
    mergeStatus?: MergeStatus;
    mergeStep?: string;
    mergeNotes?: string;
  }) => unknown;
  completePendingOperation: (issueId: string, error: string) => void;
};

export function handlePostRebaseVerificationDeferral(
  issueId: string,
  outcome: VerificationRunnerOutcome,
  _previous: MergeStateBeforeAttempt,
  deps: PostRebaseVerificationDeferralDeps,
): {
  success: false;
  statusCode: 409;
  error: string;
  deferred: true;
  mergeStatus: 'queued';
} | null {
  if (outcome.outcome !== 'deferred') return null;
  const message = `Post-rebase verification deferred: ${outcome.reason} — merge retries after the deploy.`;
  deps.appendShipLog(issueId, message, 'verifying');
  deps.setReviewStatus(issueId, {
    mergeStatus: 'queued',
    mergeStep: 'queued',
    mergeNotes: message,
  });
  deps.completePendingOperation(issueId, message);
  return {
    success: false,
    statusCode: 409,
    error: message,
    deferred: true,
    mergeStatus: 'queued',
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Positive ancestry results for a (repo, merge, target) tuple.
 *
 * A batch promotion fans the SAME generation-wide evidence out to every member,
 * so an N-member batch across R repos ran N x R identical `git merge-base`
 * processes, N of them concurrently. Only positives are cached: once a commit is
 * an ancestor of a branch it stays one, whereas a negative can become positive
 * as soon as the merge lands, so caching that would be wrong.
 */
const provenAncestry = new Set<string>();
/** Bound the set so a long-lived server cannot accumulate entries forever. */
const PROVEN_ANCESTRY_LIMIT = 512;

/**
 * Checks currently running, so concurrent callers share one process.
 *
 * The cache alone is not enough: every member's lifecycle consults it BEFORE
 * any first check has settled, so all of them miss and each spawns the same
 * `git merge-base`. A 100-member, 3-repo generation still meant ~300 duplicate
 * checks and ~100 concurrent processes per repo. Coalescing on the in-flight
 * promise collapses that to one process per distinct tuple.
 */
const inFlightAncestry = new Map<string, Promise<boolean>>();

async function mergeIsAncestorOfTarget(evidence: VerifiedMergedRepo): Promise<boolean> {
  const key = `${evidence.repoPath}|${evidence.mergeSha}|${evidence.targetBranch}`;
  if (provenAncestry.has(key)) return true;

  const running = inFlightAncestry.get(key);
  if (running) return running;

  const check = (async () => {
    try {
      await execAsync(
        `git merge-base --is-ancestor ${shellQuote(evidence.mergeSha)} ${shellQuote(`origin/${evidence.targetBranch}`)}`,
        { cwd: evidence.repoPath },
      );
    } catch {
      return false;
    }
    // Only successes are retained: an ancestor stays an ancestor, whereas a
    // negative becomes positive the moment the merge lands.
    if (provenAncestry.size >= PROVEN_ANCESTRY_LIMIT) provenAncestry.clear();
    provenAncestry.add(key);
    return true;
  })();

  inFlightAncestry.set(key, check);
  try {
    return await check;
  } finally {
    inFlightAncestry.delete(key);
  }
}

async function requireCompletePolyrepoMerge(
  issueId: string,
  mergedResult: { merged: true; reason: string },
): Promise<{ merged: boolean; reason: string }> {
  try {
    const mergeSet = getMergeSetSync(issueId);
    if (!mergeSet || mergeSet.repos.length <= 1) return mergedResult;

    const completeness = await assessMergeCompleteness(issueId);
    if (!completeness.complete) {
      return {
        merged: false,
        reason: `sibling repo(s) unmerged: ${completeness.summary}`,
      };
    }
    return mergedResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { merged: false, reason: `sibling repo merge state is unverifiable: ${message}` };
  }
}

export async function verifyMergedBeforeLifecycle(
  issueId: string,
  projectPath: string,
  sourceBranch?: string,
  options?: Pick<PostMergeLifecycleOptions, 'allowVerifiedNoPrMerge' | 'verifiedMergedRef' | 'verifiedMergedRepos'>,
): Promise<{ merged: boolean; reason: string }> {
  // PAN-1531: GitHub PR state remains the authoritative merge oracle. A caller-
  // supplied merged ref is only accepted when git proves it is reachable from main.
  const branchName = sourceBranch?.trim() || `feature/${issueId.toLowerCase()}`;
  const quotedBranch = shellQuote(branchName);

  // Batch promotion across several repos proves itself directly: each repo's
  // merge commit must be an ancestor of the branch it was published to, checked
  // inside that repo. This runs before the GitHub PR oracle because the
  // per-feature PRs of a polyrepo batch are not what landed — the uat branch
  // was — and because non-GitHub members are rejected outright below.
  const verifiedRepos = options?.verifiedMergedRepos ?? [];
  if (verifiedRepos.length > 0) {
    const unproven: string[] = [];
    for (const evidence of verifiedRepos) {
      if (!/^[0-9a-f]{7,40}$/i.test(evidence.mergeSha)) {
        unproven.push(`${evidence.repoKey} (no merge sha recorded)`);
        continue;
      }
      if (!(await mergeIsAncestorOfTarget(evidence))) {
        unproven.push(`${evidence.repoKey}@${evidence.mergeSha.slice(0, 9)} not on origin/${evidence.targetBranch}`);
      }
    }
    if (unproven.length === 0) {
      return {
        merged: true,
        reason: `batch promotion verified in ${verifiedRepos.length} repo(s): ${verifiedRepos.map((r: VerifiedMergedRepo) => r.repoKey).join(', ')}`,
      };
    }
    return { merged: false, reason: `batch promotion unverified: ${unproven.join('; ')}` };
  }

  const ghResolved = resolveGitHubIssueSync(issueId);
  if (!ghResolved.isGitHub) {
    try {
      const completeness = await assessMergeCompleteness(issueId);
      const mergedRepos = completeness.repos.filter((repo) => repo.state === 'merged');
      if (completeness.complete && hasPositiveMergedEvidence(completeness.repos)) {
        return {
          merged: true,
          reason: `Forge confirms merge complete for ${mergedRepos.map((repo) => repo.repoKey).join(', ')}`,
        };
      }
      return { merged: false, reason: completeness.summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { merged: false, reason: `Non-GitHub merge state is unverifiable: ${message}` };
    }
  }

  const { owner, repo } = ghResolved;
  try {
    if (isGitHubAppConfigured()) {
      const prs = await Effect.runPromise(listPullRequestsForHead(owner, repo, branchName, 'all'));
      const mergedPr = prs.find((pr) => pr.merged === true || pr.mergedAt != null);
      if (mergedPr) {
        return requireCompletePolyrepoMerge(issueId, {
          merged: true,
          reason: `GitHub PR #${mergedPr.number} is merged`,
        });
      }

      const verifiedMergedRef = options?.verifiedMergedRef?.trim();
      if (verifiedMergedRef) {
        try {
          await execAsync(`git merge-base --is-ancestor ${shellQuote(verifiedMergedRef)} origin/main`, { cwd: projectPath });
          return { merged: true, reason: `${verifiedMergedRef} is an ancestor of origin/main` };
        } catch {
          // Fall through to the normal PR/no-PR refusal.
        }
      }

      if (prs.length === 0) {
        if (options?.allowVerifiedNoPrMerge) {
          return { merged: true, reason: `No PR found for ${branchName}; accepting caller-verified non-PR merge` };
        }
        return { merged: false, reason: `No PR found for ${branchName}; refusing to infer merge from branch state alone` };
      }
      return { merged: false, reason: `GitHub PR for ${branchName} is open and not merged` };
    }

    const { stdout } = await execAsync(
      `gh pr list --repo ${shellQuote(`${owner}/${repo}`)} --state all --head ${quotedBranch} --json number,state,mergedAt --limit 5`,
      { cwd: projectPath },
    );
    const prs = JSON.parse(stdout || '[]') as Array<{ number: number; state: 'open' | 'closed' | 'MERGED'; mergedAt: string | null }>;
    const mergedPr = prs.find((pr) => (pr.state === 'closed' || pr.state === 'MERGED') && pr.mergedAt != null);
    if (mergedPr) {
      return requireCompletePolyrepoMerge(issueId, {
        merged: true,
        reason: `GitHub PR #${mergedPr.number} is merged`,
      });
    }

    const verifiedMergedRef = options?.verifiedMergedRef?.trim();
    if (verifiedMergedRef) {
      try {
        await execAsync(`git merge-base --is-ancestor ${shellQuote(verifiedMergedRef)} origin/main`, { cwd: projectPath });
        return { merged: true, reason: `${verifiedMergedRef} is an ancestor of origin/main` };
      } catch {
        // Fall through to the normal PR/no-PR refusal.
      }
    }

    if (prs.length === 0) {
      if (options?.allowVerifiedNoPrMerge) {
        return { merged: true, reason: `No PR found for ${branchName}; accepting caller-verified non-PR merge` };
      }
      return { merged: false, reason: `No PR found for ${branchName}; refusing to infer merge from branch state alone` };
    }
    return { merged: false, reason: `GitHub PR for ${branchName} is open and not merged` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    return { merged: false, reason: `Unable to verify merge state for ${branchName} via GitHub PR API: ${message}` };
  }
}

export interface SkipDispatchAsMergedDeps {
  resolveProject?: (issueId: string) => { projectPath: string } | null;
  verifyMerged?: (
    issueId: string,
    projectPath: string,
    sourceBranch?: string,
  ) => Promise<{ merged: boolean; reason: string }>;
}

/**
 * GitHub-authoritative pre-dispatch guard. Returns `skip: true` only when we can
 * positively confirm the PR is already merged. Any failure to resolve the project
 * or read PR state fails open (`skip: false`) so a transient GitHub hiccup never
 * blocks a legitimate dispatch.
 */
export async function shouldSkipDispatchAsMerged(
  issueId: string,
  deps: SkipDispatchAsMergedDeps = {},
): Promise<{ skip: boolean; reason: string }> {
  try {
    const resolveProject = deps.resolveProject ?? resolveProjectFromIssueSync;
    const project = resolveProject(issueId);
    if (!project) {
      return { skip: false, reason: `Project unresolved for ${issueId}` };
    }

    const branch = `feature/${issueId.toLowerCase()}`;
    const verifyMerged = deps.verifyMerged ?? verifyMergedBeforeLifecycle;
    const result = await verifyMerged(issueId, project.projectPath, branch);
    return { skip: result.merged, reason: result.reason };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { skip: false, reason: `Merged-PR guard error: ${message}` };
  }
}
