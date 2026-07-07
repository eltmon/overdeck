import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { resolveProjectFromIssueSync } from '../projects.js';
import { isGitHubAppConfigured, listPullRequestsForHead } from '../github-app.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execAsync = promisify(exec);

export interface PostMergeLifecycleOptions {
  skipDeploy?: boolean;
  allowVerifiedNoPrMerge?: boolean;
  markReviewPassed?: boolean;
  verifiedMergedRef?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function verifyMergedBeforeLifecycle(
  issueId: string,
  projectPath: string,
  sourceBranch?: string,
  options?: Pick<PostMergeLifecycleOptions, 'allowVerifiedNoPrMerge' | 'verifiedMergedRef'>,
): Promise<{ merged: boolean; reason: string }> {
  // PAN-1531: GitHub PR state remains the authoritative merge oracle. A caller-
  // supplied merged ref is only accepted when git proves it is reachable from main.
  const branchName = sourceBranch?.trim() || `feature/${issueId.toLowerCase()}`;
  const quotedBranch = shellQuote(branchName);

  const ghResolved = resolveGitHubIssueSync(issueId);
  if (!ghResolved.isGitHub) {
    return { merged: false, reason: `Non-GitHub project for ${issueId}; merge state cannot be auto-verified` };
  }

  const { owner, repo } = ghResolved;
  try {
    if (isGitHubAppConfigured()) {
      const prs = await Effect.runPromise(listPullRequestsForHead(owner, repo, branchName, 'all'));
      const mergedPr = prs.find((pr) => pr.merged === true || pr.mergedAt != null);
      if (mergedPr) {
        return { merged: true, reason: `GitHub PR #${mergedPr.number} is merged` };
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
    const prs = JSON.parse(stdout || '[]') as Array<{ number: number; state: 'open' | 'closed'; mergedAt: string | null }>;
    const mergedPr = prs.find((pr) => pr.state === 'closed' && pr.mergedAt != null);
    if (mergedPr) {
      return { merged: true, reason: `GitHub PR #${mergedPr.number} is merged` };
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
