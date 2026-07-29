import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSettledTtlPromiseCache } from './concurrency.js';

const execFileAsync = promisify(execFile);

export interface GitLabMergeRequestRow {
  iid?: number;
  title?: string;
  web_url?: string;
  state?: string;
  source_branch: string;
  target_branch?: string;
  sha?: string;
  draft?: boolean;
}

const OPEN_MR_CACHE_TTL_MS = 30_000;
const cachedOpenMergeRequests = createSettledTtlPromiseCache<string, GitLabMergeRequestRow[]>(OPEN_MR_CACHE_TTL_MS);

const MERGED_MR_CACHE_TTL_MS = 30_000;
// Cache stores repoPath -> the set of source branches with at least one merged MR.
const cachedMergedSourceBranches = createSettledTtlPromiseCache<string, Set<string>>(MERGED_MR_CACHE_TTL_MS);

/**
 * Runner function type for executing glab commands.
 * @param args - Command arguments (e.g., ['mr', 'list', ...])
 * @param cwd - Working directory where glab should execute
 * @returns stdout from the command
 */
export type GitLabRunner = (args: string[], cwd: string) => Promise<string>;

/**
 * Default glab runner using child_process.execFile
 */
async function defaultGitLabRunner(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('glab', args, {
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    cwd,
  });
  return stdout;
}

/**
 * List all open merge requests in a GitLab repository.
 * Results are paginated (100 per page) and cached for 30 seconds.
 *
 * @param repoPath - Path to the git repository (used as cwd for glab)
 * @param runner - Optional custom runner for testing; defaults to glab execFileAsync
 * @returns Array of open merge requests with source_branch and web_url
 */
export async function listOpenGitLabMergeRequests(
  repoPath: string,
  runner: GitLabRunner = defaultGitLabRunner,
): Promise<GitLabMergeRequestRow[]> {
  const cacheKey = repoPath.toLowerCase();
  return cachedOpenMergeRequests(cacheKey, async () => {
    const rows: GitLabMergeRequestRow[] = [];
    let page = 1;

    while (true) {
      const stdout = await runner(
        ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', String(page)],
        repoPath,
      );

      if (!stdout.trim()) {
        break; // Empty page signals end of results
      }

      const pageRows = JSON.parse(stdout) as GitLabMergeRequestRow[];
      if (!Array.isArray(pageRows)) {
        throw new Error(`Expected array from glab mr list, got ${typeof pageRows}`);
      }
      if (pageRows.length === 0) break;

      rows.push(...pageRows);

      // If we got fewer than 100 rows, we're on the last page
      if (pageRows.length < 100) break;

      page++;
    }

    return rows;
  });
}

/**
 * Get the subset of heads that have at least one merged merge request.
 * Results are paginated (100 per page) and cached per repository for 30 seconds.
 *
 * PAN-3267: this used to run one `glab mr list --merged --source-branch <head>`
 * per head, so a polyrepo project cost one subprocess per (repo × head) —
 * mind-your-now spawned on the order of 240 glab processes per membership
 * refresh. That was slow enough to stall the dashboard's issue list, and
 * unreliable enough that something failed every cycle; a single failure aborts
 * the whole gather as `forge_unavailable`, so membership never refreshed. One
 * repo-wide list answers every head from the same data, matching how
 * listOpenGitLabMergeRequests already reads open MRs.
 *
 * @param repoPath - Path to the git repository (used as cwd for glab)
 * @param heads - Array of branch names to check for merged MRs
 * @param runner - Optional custom runner for testing
 * @returns Subset of heads with at least one merged MR
 */
export async function listGitLabMergedMergeRequestHeads(
  repoPath: string,
  heads: string[],
  runner: GitLabRunner = defaultGitLabRunner,
): Promise<string[]> {
  if (!heads.length) return [];

  const cacheKey = repoPath.toLowerCase();
  const mergedSourceBranches = await cachedMergedSourceBranches(cacheKey, async () => {
    const branches = new Set<string>();
    let page = 1;

    while (true) {
      const stdout = await runner(
        ['mr', 'list', '--merged', '--output', 'json', '--per-page', '100', '--page', String(page)],
        repoPath,
      );

      if (!stdout.trim()) {
        break; // Empty page signals end of results
      }

      const pageRows = JSON.parse(stdout) as GitLabMergeRequestRow[];
      if (!Array.isArray(pageRows)) {
        throw new Error(`Expected array from glab mr list, got ${typeof pageRows}`);
      }
      if (pageRows.length === 0) break;

      for (const row of pageRows) {
        if (row.source_branch) branches.add(row.source_branch);
      }

      // If we got fewer than 100 rows, we're on the last page
      if (pageRows.length < 100) break;

      page++;
    }

    return branches;
  });

  return heads.filter((head) => mergedSourceBranches.has(head));
}
