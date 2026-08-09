import type {
  ProjectCiHeadObservedEvent,
  ProjectCiSuite,
} from '@overdeck/contracts';
import { appendDomainEventAsync } from '../activity-logger.js';
import {
  projectCiGhApi,
  resolveDefaultBranchHead,
  type ProjectCiGhApi,
} from '../ci/project-ci-github.js';
import { listProjectsSync, type ProjectConfig } from '../projects.js';

type Project = { key: string; config: ProjectConfig };
type HeadObservation = ProjectCiHeadObservedEvent['payload'];

interface WorkflowRun {
  head_sha?: string;
  check_suite_id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  updated_at?: string;
}

interface ProjectCiFillState {
  fingerprints: Map<string, string>;
}

export function createProjectCiFillState(): ProjectCiFillState {
  return { fingerprints: new Map() };
}

function projectionFingerprint(observation: HeadObservation): string {
  const suites = Object.entries(observation.suites)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([suiteId, suite]) => [
      suiteId,
      suite.status,
      suite.conclusion,
      suite.htmlUrl ?? null,
    ]);
  return JSON.stringify([
    observation.repo,
    observation.branch,
    observation.headSha,
    suites,
  ]);
}

/** Fetch a complete Actions projection for the independently-resolved default
 * branch head. The second branch lookup prevents publishing a projection when
 * the branch advances while workflow pages are being collected. */
export async function fillProjectCiObservation(
  project: Project,
  deps: { ghApi?: ProjectCiGhApi; now?: () => string } = {},
): Promise<HeadObservation | null> {
  const repo = project.config.github_repo;
  if (!repo) return null;
  const branch = project.config.workspace?.default_branch ?? 'main';
  const ghApi = deps.ghApi ?? projectCiGhApi;

  try {
    const headSha = await resolveDefaultBranchHead(repo, branch, ghApi);
    if (!headSha) return null;

    const runs: WorkflowRun[] = [];
    for (let page = 1; ; page += 1) {
      const response = await ghApi(
        `repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}`
        + `&head_sha=${encodeURIComponent(headSha)}&per_page=100&page=${page}`,
      ) as { workflow_runs?: WorkflowRun[] };
      const pageRuns = response.workflow_runs ?? [];
      runs.push(...pageRuns);
      if (pageRuns.length < 100) break;
    }

    const verifiedHeadSha = await resolveDefaultBranchHead(repo, branch, ghApi);
    if (verifiedHeadSha !== headSha) return null;

    const observedAt = deps.now?.() ?? new Date().toISOString();
    const suites: Record<string, ProjectCiSuite> = {};
    for (const run of runs) {
      if (run.head_sha !== headSha || run.check_suite_id == null) continue;
      const suiteId = String(run.check_suite_id);
      const suiteObservedAt = run.updated_at ?? observedAt;
      const existing = suites[suiteId];
      if (existing?.observedAt && existing.observedAt > suiteObservedAt) continue;
      suites[suiteId] = {
        status: run.status ?? 'queued',
        conclusion: run.conclusion ?? null,
        htmlUrl: run.html_url,
        observedAt: suiteObservedAt,
      };
    }

    return {
      projectKey: project.key,
      repo,
      branch,
      headSha,
      suites,
      observedAt,
    };
  } catch {
    return null;
  }
}

/** Fill every project through one complete, idempotent projection event. */
export async function fillAllProjectCi(
  deps: {
    ghApi?: ProjectCiGhApi;
    append?: typeof appendDomainEventAsync;
    projects?: Project[];
    state?: ProjectCiFillState;
    now?: () => string;
  } = {},
): Promise<number> {
  const append = deps.append ?? appendDomainEventAsync;
  const projects = deps.projects ?? listProjectsSync();
  const state = deps.state ?? createProjectCiFillState();
  let appended = 0;

  for (const project of projects) {
    if (!project.config.github_repo) continue;
    const observation = await fillProjectCiObservation(project, {
      ghApi: deps.ghApi,
      now: deps.now,
    });
    if (!observation) continue;

    const fingerprint = projectionFingerprint(observation);
    if (state.fingerprints.get(project.key) === fingerprint) continue;
    if (await append({
      type: 'project.ci_head_observed',
      timestamp: observation.observedAt,
      payload: observation,
    })) {
      state.fingerprints.set(project.key, fingerprint);
      appended += 1;
    }
  }

  return appended;
}

export function startProjectCiRefill(
  intervalMs: number,
  deps: {
    fill?: () => Promise<number>;
    warn?: (message: string) => void;
    setIntervalFn?: typeof setInterval;
  } = {},
): ReturnType<typeof setInterval> {
  const state = createProjectCiFillState();
  const fill = deps.fill ?? (() => fillAllProjectCi({ state }));
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  let running = false;

  const run = (): void => {
    if (running) return;
    running = true;
    void fill()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        warn(`[overdeck] Project CI fill failed: ${message}`);
      })
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = (deps.setIntervalFn ?? setInterval)(run, intervalMs);
  timer.unref();
  return timer;
}
