import type { ProjectCiSuiteObservedEvent } from '@overdeck/contracts';
import { listProjectsSync } from '../projects.js';

export interface ProjectCiCheckSuitePayload {
  repository?: { full_name: string };
  check_suite?: {
    id?: number;
    status?: string;
    conclusion?: string | null;
    head_branch?: string;
    head_sha?: string;
    app?: { slug?: string };
  };
}

/** Resolve "owner/repo" to a registered project key + its default branch. */
export function resolveProjectForRepo(
  fullName: string | undefined,
  projects = listProjectsSync(),
): { projectKey: string; repo: string; branch: string } | null {
  if (!fullName) return null;
  const normalized = fullName.toLowerCase();
  const project = projects.find(({ config }) => config.github_repo?.toLowerCase() === normalized);
  if (!project?.config.github_repo) return null;
  return {
    projectKey: project.key,
    repo: project.config.github_repo,
    branch: project.config.workspace?.default_branch ?? 'main',
  };
}

/** Map a check_suite webhook payload to an observation, or null when it does
 *  not describe a default-branch GitHub Actions suite. */
export function observationFromCheckSuite(
  payload: ProjectCiCheckSuitePayload,
  now: string,
  projects?: ReturnType<typeof listProjectsSync>,
): ProjectCiSuiteObservedEvent['payload'] | null {
  const project = resolveProjectForRepo(payload.repository?.full_name, projects);
  const suite = payload.check_suite;
  if (!project || !suite) return null;
  if (suite.app?.slug !== 'github-actions') return null;
  if (suite.head_branch !== project.branch) return null;
  if (!suite.head_sha || suite.id == null) return null;

  return {
    projectKey: project.projectKey,
    repo: project.repo,
    branch: project.branch,
    headSha: suite.head_sha,
    suiteId: String(suite.id),
    status: suite.status ?? 'queued',
    conclusion: suite.conclusion ?? null,
    observedAt: now,
  };
}
