import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { extractPrefixSync, parseIssueIdSync } from '../issue-id.js';
import { resolveGitHubIssueSync, resolveTrackerTypeSync } from '../tracker-utils.js';
import { getGitHubConfig } from '../../dashboard/server/services/tracker-config.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

export type DiscussionSource =
  | 'linear'
  | 'github-issue'
  | 'github-pr-conversation'
  | 'github-pr-review'
  | 'github-pr-review-comment';

export interface DiscussionItem {
  id: string;
  source: DiscussionSource;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  prNumber?: number;
  reviewState?: string;
  filePath?: string;
  line?: number;
}

export interface IssueDiscussionsResponse {
  issueId: string;
  items: DiscussionItem[];
  prNumber: number | null;
  errors?: string[];
}

interface FetchDiscussionsDeps {
  /** Resolve a Linear issue ref ("MIN-449") to its UUID. */
  linearGetIssueId?: (ref: string) => Promise<string | null>;
  /** Fetch comments for a Linear issue UUID. */
  linearGetComments?: (
    uuid: string,
  ) => Promise<readonly { author: string; body: string; createdAt: string }[]>;
}

export async function fetchIssueDiscussions(
  issueId: string,
  deps: FetchDiscussionsDeps = {},
): Promise<IssueDiscussionsResponse> {
  const upper = issueId.toUpperCase();
  const items: DiscussionItem[] = [];
  const errors: string[] = [];
  let prNumber: number | null = null;

  const trackerType = resolveTrackerTypeSync(issueId);
  const githubCheck = isGitHubIssue(issueId);

  // Steps 1-3 are independent network calls. Fan them out with Promise.all
  // so the slowest governs total wall-clock instead of the sum (PAN-847).
  const linearTask = (async () => {
    // 1. Linear issue comments — only when tracker is Linear and deps provided.
    if (trackerType === 'linear' && deps.linearGetIssueId && deps.linearGetComments) {
      try {
        const uuid = await deps.linearGetIssueId(issueId);
        if (uuid) {
          const linearComments = await deps.linearGetComments(uuid);
          const collected: DiscussionItem[] = [];
          for (let i = 0; i < linearComments.length; i++) {
            const c = linearComments[i]!;
            collected.push({
              id: `linear-${uuid}-${i}`,
              source: 'linear',
              author: c.author,
              body: c.body,
              createdAt: c.createdAt,
            });
          }
          return collected;
        }
      } catch (err: any) {
        errors.push(`linear comments failed: ${err?.message ?? String(err)}`);
      }
    }
    return [] as DiscussionItem[];
  })();

  const ghIssueCommentsTask = (async () => {
    // 2. GitHub issue comments — only when the tracker resolves the issue to
    //    GitHub (not when we're in Linear and a PR happens to exist).
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const { owner, repo, number } = githubCheck as { owner: string; repo: string; number: number };
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${owner}/${repo}/issues/${number}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
        }>;
        const collected: DiscussionItem[] = [];
        for (const c of arr) {
          collected.push({
            id: `gh-issue-${c.id}`,
            source: 'github-issue',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
          });
        }
        return collected;
      } catch (err: any) {
        errors.push(`gh issue comments failed: ${err?.message ?? String(err)}`);
      }
    }
    return [] as DiscussionItem[];
  })();

  // 3. Resolve PR number for the feature branch (if a GitHub repo is mapped
  //    via tracker config). This is independent of the issue tracker — even
  //    Linear-tracked issues end up with feature/<id-lower> branches in a
  //    GitHub repo, so PR comments belong on the timeline.
  let prRepoArg: string | null = null;
  let prOwner: string | null = null;
  let prRepo: string | null = null;
  if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
    prRepoArg = `${githubCheck.owner}/${githubCheck.repo}`;
    prOwner = githubCheck.owner;
    prRepo = githubCheck.repo;
  } else {
    // Try the project-resolved repo (Linear-tracked issues whose project maps
    // to a GitHub repo — common for Overdeck).
    const issuePrefix = extractPrefixSync(issueId);
    const projectKey = issuePrefix ?? issueId.split('-')[0] ?? '';
    const ghConfig = getGitHubConfig();
    const repoConfig = ghConfig?.repos.find((r) => {
      const prefix = (r.prefix ?? r.repo).toUpperCase().replace(/-/g, '');
      return prefix === projectKey.toUpperCase();
    });
    if (repoConfig) {
      prRepoArg = `${repoConfig.owner}/${repoConfig.repo}`;
      prOwner = repoConfig.owner;
      prRepo = repoConfig.repo;
    }
  }

  const prNumberTask = (async () => {
    if (prRepoArg) {
      if (!parseIssueIdSync(issueId)) {
        throw new Error(`Invalid issue id: ${issueId}`);
      }
      const branchName = `feature/${issueId.toLowerCase()}`;
      try {
        const { stdout } = await execFileAsync(
          'gh',
          [
            'pr', 'list',
            '--repo', prRepoArg,
            '--head', branchName,
            '--state', 'all',
            '--json', 'number',
            '--limit', '1',
            '--jq', '.[0].number',
          ],
          { encoding: 'utf-8', timeout: 15000 },
        );
        const trimmed = stdout.trim();
        if (trimmed) {
          const parsed = parseInt(trimmed, 10);
          if (Number.isFinite(parsed)) return parsed;
        }
      } catch (err: any) {
        errors.push(`gh pr list failed: ${err?.message ?? String(err)}`);
      }
    }
    return null;
  })();

  const [linearItems, ghIssueItems, resolvedPrNumber] = await Promise.all([
    linearTask,
    ghIssueCommentsTask,
    prNumberTask,
  ]);
  items.push(...linearItems, ...ghIssueItems);
  prNumber = resolvedPrNumber;

  if (prNumber !== null && prRepoArg && prOwner && prRepo) {
    // Three independent gh API calls. Each takes 200–800ms; running them
    // sequentially compounded latency on every 30s poll. Fan out with
    // Promise.all (each block catches its own error so the outer await never
    // rejects) and the slowest call now governs total wall-clock instead of
    // the sum of all three.
    const collectedItems: DiscussionItem[] = [];

    // 4. PR conversation comments (issue-comments endpoint against the PR).
    const prConversation = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/issues/${prNumber}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
        }>;
        for (const c of arr) {
          collectedItems.push({
            id: `gh-pr-conv-${c.id}`,
            source: 'github-pr-conversation',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
            prNumber,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr conversation failed: ${err?.message ?? String(err)}`);
      }
    })();

    // 5. PR review submissions (approve / changes-requested / commented).
    const prReviews = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/pulls/${prNumber}/reviews?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          state?: string;
          submitted_at?: string;
          html_url?: string;
        }>;
        for (const r of arr) {
          if (!r.body && r.state === 'COMMENTED') continue; // empty comment-only reviews are noise
          collectedItems.push({
            id: `gh-pr-review-${r.id}`,
            source: 'github-pr-review',
            author: r.user?.login ?? 'unknown',
            body: r.body ?? '',
            createdAt: r.submitted_at ?? '',
            url: r.html_url,
            prNumber,
            reviewState: r.state,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr reviews failed: ${err?.message ?? String(err)}`);
      }
    })();

    // 6. Inline PR review comments (review-thread replies on diff lines).
    const prInlineComments = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/pulls/${prNumber}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
          path?: string;
          line?: number | null;
        }>;
        for (const c of arr) {
          collectedItems.push({
            id: `gh-pr-rc-${c.id}`,
            source: 'github-pr-review-comment',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
            prNumber,
            filePath: c.path,
            line: typeof c.line === 'number' ? c.line : undefined,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr review comments failed: ${err?.message ?? String(err)}`);
      }
    })();

    await Promise.all([prConversation, prReviews, prInlineComments]);
    items.push(...collectedItems);
  }

  // Sort chronologically (oldest first). Items with no createdAt sink to the bottom.
  items.sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return {
    issueId: upper,
    items,
    prNumber,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
