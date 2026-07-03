import { exec } from 'node:child_process';
import { promisify } from 'node:util';

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
    const { stdout } = await execAsync(
      `gh pr list --repo ${shellQuote(`${owner}/${repo}`)} --state all --head ${quotedBranch} --json number,mergedAt,mergeCommit --limit 5`,
      { cwd: projectPath },
    );
    const prs = JSON.parse(stdout || '[]') as Array<{ number: number; mergedAt: string | null; mergeCommit: unknown | null }>;
    const mergedPr = prs.find((pr) => pr.mergedAt || pr.mergeCommit);
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
