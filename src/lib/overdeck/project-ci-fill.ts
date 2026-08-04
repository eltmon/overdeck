import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProjectCiSuiteObservedEvent } from '@overdeck/contracts';
import { appendDomainEventAsync } from '../activity-logger.js';
import { listProjectsSync, type ProjectConfig } from '../projects.js';

const execFileAsync = promisify(execFile);

type GhApi = (path: string) => Promise<unknown>;
type Project = { key: string; config: ProjectConfig };
type Observation = ProjectCiSuiteObservedEvent['payload'];

interface WorkflowRun {
  head_sha?: string;
  check_suite_id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  updated_at?: string;
}

const defaultGhApi: GhApi = async (path) => {
  const { stdout } = await execFileAsync(
    'gh',
    ['api', path, '-H', 'Accept: application/vnd.github+json'],
    { encoding: 'utf-8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
};

/** Fetch the newest default-branch commit's GitHub Actions runs for one
 *  project and return one observation per run. Returns [] on any failure —
 *  no repo, no gh auth, no Actions — so the chip simply does not render. */
export async function fillProjectCiObservations(
  project: Project,
  deps: { ghApi?: GhApi; now?: () => string } = {},
): Promise<Observation[]> {
  const repo = project.config.github_repo;
  if (!repo) return [];
  const branch = project.config.workspace?.default_branch ?? 'main';
  const ghApi = deps.ghApi ?? defaultGhApi;

  try {
    const response = await ghApi(`repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`) as {
      workflow_runs?: WorkflowRun[];
    };
    const runs = response.workflow_runs ?? [];
    const headSha = runs[0]?.head_sha;
    if (!headSha) return [];

    return runs
      .filter((run) => run.head_sha === headSha && run.check_suite_id != null)
      .map((run) => ({
        projectKey: project.key,
        repo,
        branch,
        headSha,
        suiteId: String(run.check_suite_id),
        status: run.status ?? 'queued',
        conclusion: run.conclusion ?? null,
        htmlUrl: run.html_url,
        observedAt: run.updated_at ?? deps.now?.() ?? new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

/** Fill every project with a github_repo and append the observations. */
export async function fillAllProjectCi(
  deps: {
    ghApi?: GhApi;
    append?: typeof appendDomainEventAsync;
    projects?: Project[];
  } = {},
): Promise<number> {
  const append = deps.append ?? appendDomainEventAsync;
  const projects = deps.projects ?? listProjectsSync();
  let appended = 0;

  for (const project of projects) {
    if (!project.config.github_repo) continue;
    const observations = await fillProjectCiObservations(project, { ghApi: deps.ghApi });
    for (const observation of observations) {
      if (await append({
        type: 'project.ci_suite_observed',
        timestamp: observation.observedAt,
        payload: observation,
      })) {
        appended += 1;
      }
    }
  }

  return appended;
}
