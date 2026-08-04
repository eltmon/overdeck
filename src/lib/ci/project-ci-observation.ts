import type { ProjectCiSuiteObservedEvent } from '@overdeck/contracts';
import { listProjectsSync, type ProjectConfig } from '../projects.js';
import { subscribeProjectsConfigInvalidation } from '../projects-cache-events.js';

export interface ProjectCiCheckSuitePayload {
  repository?: { full_name: string };
  check_suite?: {
    id?: number;
    status?: string;
    conclusion?: string | null;
    head_branch?: string;
    head_sha?: string;
    updated_at?: string;
    app?: { slug?: string };
  };
}

type ProjectEntry = { key: string; config: ProjectConfig };
type ResolvedProject = { projectKey: string; repo: string; branch: string };

let projectByRepo: Map<string, ResolvedProject> | null = null;
let projectLookupExpiresAt = 0;
const PROJECT_LOOKUP_TTL_MS = 5 * 60 * 1000;
subscribeProjectsConfigInvalidation(() => {
  projectByRepo = null;
  projectLookupExpiresAt = 0;
});

function buildProjectLookup(projects: ProjectEntry[]): Map<string, ResolvedProject> {
  const lookup = new Map<string, ResolvedProject>();
  for (const project of projects) {
    const repo = project.config.github_repo;
    if (!repo) continue;
    lookup.set(repo.toLowerCase(), {
      projectKey: project.key,
      repo,
      branch: project.config.workspace?.default_branch ?? 'main',
    });
  }
  return lookup;
}

/** Resolve "owner/repo" from the invalidation-aware project registry cache. */
export function resolveProjectForRepo(
  fullName: string | undefined,
  projects?: ProjectEntry[],
): ResolvedProject | null {
  if (!fullName) return null;
  let lookup: Map<string, ResolvedProject>;
  if (projects) {
    lookup = buildProjectLookup(projects);
  } else {
    const now = Date.now();
    if (!projectByRepo || now >= projectLookupExpiresAt) {
      projectByRepo = buildProjectLookup(listProjectsSync());
      projectLookupExpiresAt = now + PROJECT_LOOKUP_TTL_MS;
    }
    lookup = projectByRepo;
  }
  return lookup.get(fullName.toLowerCase()) ?? null;
}

/** Map a check_suite webhook payload only when its SHA was independently
 * verified as the current default-branch head. */
export function observationFromCheckSuite(
  payload: ProjectCiCheckSuitePayload,
  now: string,
  projects: ProjectEntry[] | undefined,
  authoritativeHeadSha: string | null,
): ProjectCiSuiteObservedEvent['payload'] | null {
  const project = resolveProjectForRepo(payload.repository?.full_name, projects);
  const suite = payload.check_suite;
  if (!project || !suite) return null;
  if (suite.app?.slug !== 'github-actions') return null;
  if (suite.head_branch !== project.branch) return null;
  if (!suite.head_sha || suite.id == null) return null;
  if (suite.head_sha !== authoritativeHeadSha) return null;

  return {
    projectKey: project.projectKey,
    repo: project.repo,
    branch: project.branch,
    headSha: suite.head_sha,
    suiteId: String(suite.id),
    status: suite.status ?? 'queued',
    conclusion: suite.conclusion ?? null,
    observedAt: suite.updated_at ?? now,
    authoritativeHead: true,
  };
}
