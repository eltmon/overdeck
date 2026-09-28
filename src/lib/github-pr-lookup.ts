import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isGitHubAppConfigured, listPullRequestsForHead, type GitHubPullRequestForHead } from './github-app.js';
import { selectPullRequestForHead } from './github-pr-selection.js';

const execFileAsync = promisify(execFile);

export function githubPrLookupSource(): string {
  return isGitHubAppConfigured() ? 'GitHub App PR lookup' : 'gh pr list';
}

export interface BranchPullRequest {
  number: number;
  state: string;
  mergedAt: string | null;
}

/**
 * The PR the merge gate judges for a branch (PAN-4263): open (most recently
 * updated) above merged (most recent merge) above closed. Both the REST list
 * and `gh pr list` sort by creation, so the first row can be a newer closed PR.
 */
export async function lookupPullRequestForBranch(
  owner: string,
  repo: string,
  branchName: string,
): Promise<BranchPullRequest | null> {
  const prs = isGitHubAppConfigured()
    ? await listPullRequestsForHead(owner, repo, branchName, 'all')
    : await listPullRequestsWithGh(owner, repo, branchName);
  const pr = selectPullRequestForHead(prs, { includeClosed: true });
  if (!pr) return null;
  return {
    number: pr.number,
    state: pr.merged ? 'MERGED' : pr.state.toUpperCase(),
    mergedAt: pr.mergedAt,
  };
}

async function listPullRequestsWithGh(
  owner: string,
  repo: string,
  branchName: string,
): Promise<GitHubPullRequestForHead[]> {
  const { stdout } = await execFileAsync(
    'gh',
    [
      'pr', 'list',
      '--repo', `${owner}/${repo}`,
      '--head', branchName,
      '--state', 'all',
      '--json', 'number,state,mergedAt,updatedAt',
      '--limit', '20',
    ],
    { encoding: 'utf-8', timeout: 15000 },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  const rows = JSON.parse(trimmed) as Array<{
    number?: number;
    state?: string;
    mergedAt?: string | null;
    updatedAt?: string | null;
  }>;
  return rows
    .filter((row) => Number.isFinite(row.number))
    .map((row) => {
      const state = typeof row.state === 'string' ? row.state.toUpperCase() : 'CLOSED';
      return {
        number: row.number as number,
        state: state === 'OPEN' ? 'open' : 'closed',
        merged: state === 'MERGED',
        mergedAt: typeof row.mergedAt === 'string' ? row.mergedAt : null,
        mergeCommit: null,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
      };
    });
}

export async function lookupPullRequestNumberForBranch(
  owner: string,
  repo: string,
  branchName: string,
): Promise<number | null> {
  return (await lookupPullRequestForBranch(owner, repo, branchName))?.number ?? null;
}
