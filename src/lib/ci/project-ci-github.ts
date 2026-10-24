import { runGh } from '../github-quota/run-gh.js';

export type ProjectCiGhApi = (path: string) => Promise<unknown>;

/** PAN-4264: metered as caller ci-repair, skipped (GitHubQuotaPausedError) during a user REST pause. */
export const projectCiGhApi: ProjectCiGhApi = async (path) => {
  const { stdout } = await runGh(
    ['api', path, '-H', 'Accept: application/vnd.github+json'],
    { caller: 'ci-repair', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
};

export async function resolveDefaultBranchHead(
  repo: string,
  branch: string,
  ghApi: ProjectCiGhApi = projectCiGhApi,
): Promise<string | null> {
  const response = await ghApi(
    `repos/${repo}/branches/${encodeURIComponent(branch)}`,
  ) as { commit?: { sha?: string } };
  return response.commit?.sha ?? null;
}

/** PAN-4618: the workflow whose newest push run marks the commit CI describes. */
export const MAIN_CI_WORKFLOW_FILE = 'ci.yml';

/**
 * PAN-4618: the newest default-branch commit CI was started for — the head_sha
 * of the newest push run of the CI workflow. Bookkeeping pushes start no CI
 * run, so this is usually older than the branch head. Falls back to the branch
 * head when the project has no such workflow (404) or no push run of it yet.
 */
export async function resolveCiHead(
  repo: string,
  branch: string,
  ghApi: ProjectCiGhApi = projectCiGhApi,
): Promise<string | null> {
  let response: { workflow_runs?: Array<{ head_sha?: string }> };
  try {
    response = await ghApi(
      `repos/${repo}/actions/workflows/${MAIN_CI_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(branch)}&event=push&per_page=1`,
    ) as typeof response;
  } catch (error) {
    // runGh rethrows the execFile error: the gh text `gh: Not Found (HTTP 404)` is on `stderr` and in `message`.
    const failure = error as { message?: unknown; stderr?: unknown };
    if (!/HTTP 404/.test(`${String(failure?.stderr ?? '')} ${String(failure?.message ?? error)}`)) throw error;
    response = {};
  }
  return response.workflow_runs?.[0]?.head_sha ?? resolveDefaultBranchHead(repo, branch, ghApi);
}
