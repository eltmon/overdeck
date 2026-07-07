/**
 * CodeRabbit review ingestion (PAN-2374).
 *
 * Quota invariant: CodeRabbit reviews PRs only sometimes. An empty finding
 * array means any of: no findings, quota miss, CodeRabbit absent, or fetch
 * error. Callers MUST treat all four identically — this module is advisory
 * and must never gate anything.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { lookupPullRequestNumberForBranch } from '../github-pr-lookup.js';

const execAsync = promisify(exec);

const CODERABBIT_BOT_LOGIN = 'coderabbitai[bot]';

export interface CodeRabbitFinding {
  path?: string;
  line?: number;
  body: string;
  url?: string;
}

async function resolveOwnerRepo(workspace: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execAsync('gh repo view --json owner,name', {
      cwd: workspace,
      encoding: 'utf-8',
      timeout: 15000,
    });
    const parsed = JSON.parse(stdout) as { owner?: { login?: string }; name?: string };
    const owner = parsed.owner?.login;
    const repo = parsed.name;
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

async function fetchFindingsFromReviews(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CodeRabbitFinding[]> {
  const { stdout } = await execAsync(
    `gh api "repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100"`,
    { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
  );
  const arr = JSON.parse(stdout) as Array<{
    user?: { login?: string } | null;
    body?: string | null;
    state?: string;
    html_url?: string;
  }>;
  return arr
    .filter(r => r.user?.login === CODERABBIT_BOT_LOGIN && r.state !== 'DISMISSED')
    .map(r => ({
      body: r.body ?? '',
      url: r.html_url,
    }));
}

async function fetchFindingsFromComments(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CodeRabbitFinding[]> {
  const { stdout } = await execAsync(
    `gh api "repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100"`,
    { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
  );
  const arr = JSON.parse(stdout) as Array<{
    user?: { login?: string } | null;
    body?: string | null;
    html_url?: string;
    path?: string;
    line?: number | null;
  }>;
  return arr
    .filter(c => c.user?.login === CODERABBIT_BOT_LOGIN)
    .map(c => ({
      path: c.path,
      line: typeof c.line === 'number' ? c.line : undefined,
      body: c.body ?? '',
      url: c.html_url,
    }));
}

export async function fetchCodeRabbitFindings(opts: {
  workspace: string;
  branch: string;
}): Promise<CodeRabbitFinding[]> {
  try {
    const ownerRepo = await resolveOwnerRepo(opts.workspace);
    if (!ownerRepo) return [];
    const { owner, repo } = ownerRepo;

    const prNumber = await lookupPullRequestNumberForBranch(owner, repo, opts.branch);
    if (!prNumber) return [];

    const [reviewFindings, commentFindings] = await Promise.all([
      fetchFindingsFromReviews(owner, repo, prNumber).catch(() => [] as CodeRabbitFinding[]),
      fetchFindingsFromComments(owner, repo, prNumber).catch(() => [] as CodeRabbitFinding[]),
    ]);

    return [...reviewFindings, ...commentFindings];
  } catch (err) {
    console.warn(
      `[coderabbit-ingestion] fetch failed — skipping: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
