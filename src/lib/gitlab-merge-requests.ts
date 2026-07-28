import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSettledTtlPromiseCache, withConcurrencyLimitPromise } from './concurrency.js';

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
// Cache stores (repoPath:head) -> boolean (whether head has merged MRs)
const cachedMergedMergeRequestHeads = createSettledTtlPromiseCache<string, boolean>(MERGED_MR_CACHE_TTL_MS);

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
 * Queries are made per head with --merged flag and cached for 30 seconds.
 * Multiple heads are queried concurrently (limit 5).
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

  const results = await withConcurrencyLimitPromise(
    heads.map((head) => async () => {
      const cacheKey = `${repoPath.toLowerCase()}:${head}`;
      const hasMerged = await cachedMergedMergeRequestHeads(cacheKey, async () => {
        let page = 1;
        let found = false;

        while (true) {
          const stdout = await runner(
            ['mr', 'list', '--merged', '--source-branch', head, '--output', 'json', '--per-page', '100', '--page', String(page)],
            repoPath,
          );

          if (!stdout.trim()) return found;

          const pageRows = JSON.parse(stdout) as GitLabMergeRequestRow[];
          if (!Array.isArray(pageRows)) {
            throw new Error(`Expected array from glab mr list, got ${typeof pageRows}`);
          }
          if (pageRows.length > 0) found = true;

          // A short page is the final page; return whether any page contained a merged MR.
          if (pageRows.length < 100) return found;

          page++;
        }
      });
      // Return head if merged, null otherwise
      return hasMerged ? head : null;
    }),
    5, // Concurrency limit of 5
  );

  return results.filter((head) => head !== null) as string[];
}
