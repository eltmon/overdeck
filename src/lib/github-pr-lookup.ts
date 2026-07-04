import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { isGitHubAppConfigured, listPullRequestsForHead } from './github-app.js';

const execFileAsync = promisify(execFile);

export function githubPrLookupSource(): string {
  return isGitHubAppConfigured() ? 'GitHub App PR lookup' : 'gh pr list';
}

export async function lookupPullRequestNumberForBranch(
  owner: string,
  repo: string,
  branchName: string,
): Promise<number | null> {
  if (isGitHubAppConfigured()) {
    const prs = await Effect.runPromise(listPullRequestsForHead(owner, repo, branchName, 'all'));
    return prs[0]?.number ?? null;
  }

  const { stdout } = await execFileAsync(
    'gh',
    [
      'pr', 'list',
      '--repo', `${owner}/${repo}`,
      '--head', branchName,
      '--state', 'all',
      '--json', 'number',
      '--limit', '1',
      '--jq', '.[0].number',
    ],
    { encoding: 'utf-8', timeout: 15000 },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
