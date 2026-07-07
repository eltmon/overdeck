import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { isGitHubAppConfigured, listPullRequestsForHead } from '../github-app.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execAsync = promisify(exec);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function verifyMergedBeforeLifecycle(
  issueId: string,
  projectPath: string,
  sourceBranch?: string,
  options?: { allowVerifiedNoPrMerge?: boolean },
): Promise<{ merged: boolean; reason: string }> {
  // PAN-1531: single merge oracle — GitHub PR API is the authoritative answer
  // for "is this PR merged." Non-GitHub projects still require manual confirmation.
  const branchName = sourceBranch?.trim() || `feature/${issueId.toLowerCase()}`;

  const ghResolved = resolveGitHubIssueSync(issueId);
  if (!ghResolved.isGitHub) {
    return { merged: false, reason: `Non-GitHub project for ${issueId}; merge state cannot be auto-verified` };
  }

  const { owner, repo } = ghResolved;
  try {
    if (isGitHubAppConfigured()) {
      const prs = await Effect.runPromise(listPullRequestsForHead(owner, repo, branchName, 'all'));
      const mergedPr = prs.find((pr) => pr.merged || pr.mergedAt || pr.mergeCommit);
      if (mergedPr) {
        return { merged: true, reason: `GitHub PR #${mergedPr.number} is merged` };
      }
      if (prs.length === 0) {
        if (options?.allowVerifiedNoPrMerge) {
          return { merged: true, reason: `No PR found for ${branchName}; accepting caller-verified non-PR merge` };
        }
        return { merged: false, reason: `No PR found for ${branchName}; refusing to infer merge from branch state alone` };
      }
      return { merged: false, reason: `GitHub PR for ${branchName} is open and not merged` };
    }

    const quotedBranch = shellQuote(branchName);
    const { stdout } = await execAsync(
      `gh pr list --repo ${shellQuote(`${owner}/${repo}`)} --state all --head ${quotedBranch} --json number,mergedAt,mergeCommit --limit 5`,
      { cwd: projectPath },
    );
    const prs = JSON.parse(stdout || '[]') as Array<{ number: number; state: 'open' | 'closed' | 'MERGED'; mergedAt: string | null }>;
    const mergedPr = prs.find((pr) => (pr.state === 'closed' || pr.state === 'MERGED') && pr.mergedAt != null);
    if (mergedPr) {
      return { merged: true, reason: `GitHub PR #${mergedPr.number} is merged` };
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
