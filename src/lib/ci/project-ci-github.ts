import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ProjectCiGhApi = (path: string) => Promise<unknown>;

export const projectCiGhApi: ProjectCiGhApi = async (path) => {
  const { stdout } = await execFileAsync(
    'gh',
    ['api', path, '-H', 'Accept: application/vnd.github+json'],
    { encoding: 'utf-8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
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
