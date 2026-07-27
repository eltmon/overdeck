import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { isGitHubAppConfigured, listPullRequestsForHead } from './github-app.js';

const execFileAsync = promisify(execFile);

export function githubPrLookupSource(): string {
  return isGitHubAppConfigured() ? 'GitHub App PR lookup' : 'gh pr list';
}

export interface BranchPullRequest {
  number: number;
  state: string;
  mergedAt: string | null;
}

export async function lookupPullRequestForBranch(
  owner: string,
  repo: string,
  branchName: string,
): Promise<BranchPullRequest | null> {
  if (isGitHubAppConfigured()) {
    const prs = await Effect.runPromise(listPullRequestsForHead(owner, repo, branchName, 'all'));
    const pr = prs[0];
    if (!pr) return null;
    return {
      number: pr.number,
      state: pr.merged ? 'MERGED' : pr.state.toUpperCase(),
      mergedAt: pr.mergedAt,
    };
  }

  const { stdout } = await execFileAsync(
    'gh',
    [
      'pr', 'list',
      '--repo', `${owner}/${repo}`,
      '--head', branchName,
      '--state', 'all',
      '--json', 'number,state,mergedAt',
      '--limit', '1',
    ],
    { encoding: 'utf-8', timeout: 15000 },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const [pr] = JSON.parse(trimmed) as Array<{
    number?: number;
    state?: string;
    mergedAt?: string | null;
  }>;
  if (!pr || !Number.isFinite(pr.number)) return null;
  return {
    number: pr.number as number,
    state: typeof pr.state === 'string' ? pr.state.toUpperCase() : 'CLOSED',
    mergedAt: typeof pr.mergedAt === 'string' ? pr.mergedAt : null,
  };
}

export async function lookupPullRequestNumberForBranch(
  owner: string,
  repo: string,
  branchName: string,
): Promise<number | null> {
  return (await lookupPullRequestForBranch(owner, repo, branchName))?.number ?? null;
}
