/**
 * PAN-4264: GitHub issue listings for pipeline membership that fall back to
 * the gh user token when the GitHub App is not installed on a repo.
 *
 * The App path is tried first. A 404 from it marks the repo in repo-notes.json
 * for 6 hours and retries the same listing through `gh api` (caller
 * `pipeline-membership`). While the mark lasts the App path is skipped
 * entirely, so a repo without the App costs one gh listing per refresh
 * instead of a failed App call plus a fresh installation token.
 */

import { STALE_PIPELINE_LABELS } from './cloister/label-reconciler.js';
import { withConcurrencyLimit } from './concurrency.js';
import {
  listIssuesWithAnyLabel,
  listOpenIssuesWithLabels,
  type GitHubIssueLabels,
  type GitHubOpenIssueLabels,
} from './github-app.js';
import { isAppMarkedNotInstalled, markAppNotInstalled } from './github-quota/repo-notes.js';
import { runGh } from './github-quota/run-gh.js';

const APP_NOT_INSTALLED_PATTERN = / failed: 404 /;

interface RestIssue {
  number: number;
  state?: 'open' | 'closed';
  pull_request?: unknown;
  labels?: Array<string | { name?: string | null }>;
}

export interface AppFallbackListerDeps {
  listOpenIssuesViaApp(owner: string, repo: string): Promise<GitHubOpenIssueLabels[]>;
  listLabeledIssuesViaApp(owner: string, repo: string, labels: readonly string[]): Promise<GitHubIssueLabels[]>;
  /** `gh api --paginate --slurp <path>` → the flattened rows. */
  ghListIssues(path: string): Promise<RestIssue[]>;
  now(): number;
}

async function ghListIssues(path: string): Promise<RestIssue[]> {
  const { stdout } = await runGh(['api', '--paginate', '--slurp', path], {
    caller: 'pipeline-membership',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return (JSON.parse(stdout) as RestIssue[][]).flat();
}

function labelNames(issue: RestIssue): string[] {
  return (issue.labels ?? [])
    .map((label) => typeof label === 'string' ? label : label.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

const defaultDeps: AppFallbackListerDeps = {
  listOpenIssuesViaApp: listOpenIssuesWithLabels,
  listLabeledIssuesViaApp: listIssuesWithAnyLabel,
  ghListIssues,
  now: () => Date.now(),
};

export function createAppFallbackIssueListers(deps: AppFallbackListerDeps = defaultDeps) {
  async function withFallback<T>(
    owner: string,
    repo: string,
    viaApp: () => Promise<T>,
    viaGh: () => Promise<T>,
  ): Promise<T> {
    if (isAppMarkedNotInstalled(owner, repo, deps.now())) return viaGh();
    try {
      return await viaApp();
    } catch (error) {
      if (!(error instanceof Error) || !APP_NOT_INSTALLED_PATTERN.test(error.message)) throw error;
      markAppNotInstalled(owner, repo, deps.now());
      return viaGh();
    }
  }

  return {
    listOpenIssues(owner: string, repo: string): Promise<GitHubOpenIssueLabels[]> {
      return withFallback(owner, repo, () => deps.listOpenIssuesViaApp(owner, repo), async () =>
        (await deps.ghListIssues(`repos/${owner}/${repo}/issues?state=open&per_page=100`))
          .filter((issue) => issue.pull_request == null)
          .map((issue) => ({ number: issue.number, labels: labelNames(issue) })));
    },

    listPhaseLabeledIssues(owner: string, repo: string): Promise<GitHubIssueLabels[]> {
      return withFallback(owner, repo, () => deps.listLabeledIssuesViaApp(owner, repo, STALE_PIPELINE_LABELS), async () => {
        const byNumber = new Map<number, GitHubIssueLabels>();
        const groups = await withConcurrencyLimit(STALE_PIPELINE_LABELS.map((label) => () =>
          deps.ghListIssues(`repos/${owner}/${repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(label)}`)), 3);
        for (const issue of groups.flat()) {
          if (issue.pull_request != null) continue;
          byNumber.set(issue.number, { number: issue.number, state: issue.state ?? 'open', labels: labelNames(issue) });
        }
        return [...byNumber.values()];
      });
    },
  };
}
