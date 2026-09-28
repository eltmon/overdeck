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
