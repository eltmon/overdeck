/**
 * Match a git origin to a registered project (PAN-4437 D-3, FR-6).
 *
 * Session Vault "Continue here" needs a checkout for a conversation saved on
 * another machine. When the saved cwd does not exist here, the project whose
 * `github_repo`/`gitlab_repo` names the same repository is the next choice.
 * Pure over the `listProjectsAsync()` result, so it is testable without a
 * registry. The first match in list order wins.
 */
import type { ProjectConfig } from '../projects.js';
import { parseRepoUrl } from './repo-url.js';

export function findProjectForGitOrigin(
  gitOrigin: string | null,
  projects: ReadonlyArray<{ key: string; config: ProjectConfig }>,
): { key: string; config: ProjectConfig } | null {
  const parsed = gitOrigin ? parseRepoUrl(gitOrigin) : null;
  if (!parsed || parsed.slug === null) return null;
  const slug = parsed.slug.toLowerCase();
  for (const project of projects) {
    const repo = parsed.provider === 'github' ? project.config.github_repo : project.config.gitlab_repo;
    if (repo?.toLowerCase() === slug) return project;
  }
  return null;
}
