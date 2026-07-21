/**
 * Project-level release/publish pipeline status (PAN-2555).
 *
 * Answers, per project, without leaving the dashboard: what version is live
 * on npm, is a release workflow running right now, and did the last one
 * succeed — including PARTIAL failures (npm published but a desktop matrix
 * job failed → the GitHub Release was skipped), which is exactly the shape
 * that was invisible when v0.44.0 and v0.45.12 shipped npm-only.
 *
 * Per-project resolution (projects.yaml `publish` block, inference fallback):
 *   - npm packages: `publish.npm_packages`, else the project root
 *     package.json's `name` when it is not `private`.
 *   - release workflow: `publish.release_workflow`, else `release.yml` when
 *     `<projectPath>/.github/workflows/release.yml` exists.
 *
 * Read-only surface: GitHub data via `gh api` (same mechanism as
 * fetchIssueCheckRuns), npm via the public registry dist-tags endpoint.
 * Projects with neither an npm package nor a release workflow return
 * `available: false` with a reason — never an error.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { listProjectsSync, type ProjectConfig } from '../projects.js';

const execFileAsync = promisify(execFile);

export interface ReleaseWorkflowJob {
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string | null;
}

export interface ReleaseWorkflowRun {
  id: number;
  displayTitle: string;
  /** For tag-triggered release runs, head_branch is the tag (e.g. v0.45.13). */
  tag: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface NpmPackageStatus {
  name: string;
  latestVersion: string | null;
  url: string;
  error?: string;
}

export interface ProjectReleaseStatus {
  projectKey: string;
  available: boolean;
  /** Why the panel is unavailable (no repo / no publish pipeline). */
  reason?: string;
  repo: string | null;
  releaseWorkflow: string | null;
  runs: ReleaseWorkflowRun[];
  /** Job-level detail for the most recent run — surfaces partial failures. */
  latestRunJobs: ReleaseWorkflowJob[];
  npmPackages: NpmPackageStatus[];
  githubRelease: { tagName: string; htmlUrl: string } | null;
  error?: string;
}

/** Same tolerance as GET /api/session-trees: the deck sends display names. */
function resolveProject(projectKey: string): { key: string; config: ProjectConfig } | null {
  const projects = listProjectsSync();
  return projects.find((p) => p.key === projectKey || p.config.name === projectKey) ?? null;
}

function inferNpmPackages(config: ProjectConfig): string[] {
  if (config.publish?.npm_packages?.length) return config.publish.npm_packages;
  try {
    const manifest = JSON.parse(readFileSync(join(config.path, 'package.json'), 'utf-8')) as {
      name?: string;
      private?: boolean;
    };
    if (manifest.name && !manifest.private) return [manifest.name];
  } catch {
    /* no package.json — not an npm project */
  }
  return [];
}

function inferReleaseWorkflow(config: ProjectConfig): string | null {
  if (config.publish?.release_workflow) return config.publish.release_workflow;
  return existsSync(join(config.path, '.github', 'workflows', 'release.yml')) ? 'release.yml' : null;
}

type GhApi = (path: string) => Promise<unknown>;

const defaultGhApi: GhApi = async (path) => {
  const { stdout } = await execFileAsync(
    'gh',
    ['api', path, '-H', 'Accept: application/vnd.github+json'],
    { encoding: 'utf-8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
};

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

function normalizeRun(raw: Record<string, unknown>): ReleaseWorkflowRun {
  return {
    id: Number(raw.id ?? 0),
    displayTitle: String(raw.display_title ?? raw.name ?? ''),
    tag: String(raw.head_branch ?? ''),
    status: String(raw.status ?? 'pending'),
    conclusion: (raw.conclusion ?? null) as string | null,
    htmlUrl: String(raw.html_url ?? ''),
    createdAt: String(raw.created_at ?? ''),
    updatedAt: String(raw.updated_at ?? ''),
  };
}

function normalizeJob(raw: Record<string, unknown>): ReleaseWorkflowJob {
  return {
    name: String(raw.name ?? ''),
    status: String(raw.status ?? 'pending'),
    conclusion: (raw.conclusion ?? null) as string | null,
    htmlUrl: (raw.html_url ?? null) as string | null,
  };
}

export async function fetchProjectReleaseStatus(
  projectKey: string,
  deps: { ghApi?: GhApi; fetchJson?: FetchJson } = {},
): Promise<ProjectReleaseStatus> {
  const ghApi = deps.ghApi ?? defaultGhApi;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;

  const empty: Omit<ProjectReleaseStatus, 'projectKey' | 'available' | 'reason'> = {
    repo: null,
    releaseWorkflow: null,
    runs: [],
    latestRunJobs: [],
    npmPackages: [],
    githubRelease: null,
  };

  const project = resolveProject(projectKey);
  if (!project) {
    return { projectKey, available: false, reason: `Unknown project: ${projectKey}`, ...empty };
  }

  const repo = project.config.github_repo ?? null;
  const npmNames = inferNpmPackages(project.config);
  const releaseWorkflow = repo ? inferReleaseWorkflow(project.config) : null;

  if (!releaseWorkflow && npmNames.length === 0) {
    return {
      projectKey: project.key,
      available: false,
      reason: 'No publish pipeline: no release workflow and no public npm package',
      ...empty,
      repo,
    };
  }

  const npmPackages: NpmPackageStatus[] = await Promise.all(
    npmNames.map(async (name): Promise<NpmPackageStatus> => {
      const url = `https://www.npmjs.com/package/${name}`;
      try {
        const tags = (await fetchJson(
          `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`,
        )) as { latest?: string };
        return { name, latestVersion: tags.latest ?? null, url };
      } catch (err) {
        return { name, latestVersion: null, url, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  let runs: ReleaseWorkflowRun[] = [];
  let latestRunJobs: ReleaseWorkflowJob[] = [];
  let githubRelease: ProjectReleaseStatus['githubRelease'] = null;
  let error: string | undefined;

  if (repo && releaseWorkflow) {
    try {
      const payload = (await ghApi(
        `repos/${repo}/actions/workflows/${encodeURIComponent(releaseWorkflow)}/runs?per_page=5`,
      )) as { workflow_runs?: Record<string, unknown>[] };
      runs = (payload.workflow_runs ?? []).map(normalizeRun);

      if (runs.length > 0) {
        try {
          const jobsPayload = (await ghApi(`repos/${repo}/actions/runs/${runs[0]!.id}/jobs?per_page=100`)) as {
            jobs?: Record<string, unknown>[];
          };
          latestRunJobs = (jobsPayload.jobs ?? []).map(normalizeJob);
        } catch {
          /* job detail is best-effort — the run row still renders */
        }
      }

      try {
        const release = (await ghApi(`repos/${repo}/releases/latest`)) as { tag_name?: string; html_url?: string };
        if (release.tag_name && release.html_url) {
          githubRelease = { tagName: release.tag_name, htmlUrl: release.html_url };
        }
      } catch {
        /* no releases yet — legitimate */
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    projectKey: project.key,
    available: true,
    repo,
    releaseWorkflow,
    runs,
    latestRunJobs,
    npmPackages,
    githubRelease,
    error,
  };
}
