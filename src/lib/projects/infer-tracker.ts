/**
 * Infer a project's tracker from its git origin remote.
 *
 * A project registered without `tracker`, `github_repo`, `issue_prefix`,
 * `rally_project` or `gitlab_repo` resolves no tracker, so pipeline membership
 * skips it and the Issues panel lists nothing. When the project's origin is a
 * GitHub repository, Overdeck writes `github_repo: owner/repo` itself rather
 * than asking the operator to edit projects.yaml. Callers: dashboard boot,
 * `pan sync`, `finishProjectSetup`, and context-layer project discovery.
 *
 * `tryResolveProjectTrackerType` stays pure and sync; this module is the async
 * side that reads git and writes the config.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

import { tryResolveProjectTrackerType } from '../project-tracker-type.js';
import {
  listProjectsAsync,
  updateProjectsConfigAsync,
  type ProjectConfig,
} from '../projects.js';
import { parseRepoUrl } from './repo-url.js';

const execFileAsync = promisify(execFile);

const ORIGIN_READ_TIMEOUT_MS = 5_000;

/** A `github.com` host followed by the SSH (`:`) or URL (`/`) separator. */
const GITHUB_HOST = /(^|[@/])(www\.)?github\.com[:/]/i;

/**
 * The `owner/repo` slug of a GitHub remote URL, or null for any other remote.
 *
 * Accepts SSH (`git@github.com:o/r.git`, `ssh://git@github.com/o/r`) and HTTPS
 * (`https://github.com/o/r.git`). The explicit host check matters: the shared
 * parser reads a bare `a/b` as GitHub shorthand, and a remote like `../repo` is
 * a filesystem path, not a GitHub repository.
 */
export function githubRepoFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!GITHUB_HOST.test(trimmed)) return null;
  const parsed = parseRepoUrl(trimmed);
  if (!parsed || parsed.provider !== 'github' || !parsed.slug) return null;
  return parsed.slug;
}

export interface InferProjectTrackerDeps {
  /** `git remote get-url origin` for a directory; null when it has no origin. */
  readOriginUrl(path: string): Promise<string | null>;
  /**
   * Write `github_repo` into the named project's entry. Resolves true when it
   * wrote, false when the entry is gone or already resolves a tracker.
   */
  writeGithubRepo(key: string, githubRepo: string): Promise<boolean>;
}

async function readOriginUrl(path: string): Promise<string | null> {
  try {
    // `get-url` reads local config only, so no credential prompt can appear.
    const { stdout } = await execFileAsync('git', ['-C', path, 'remote', 'get-url', 'origin'], {
      timeout: ORIGIN_READ_TIMEOUT_MS,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function writeGithubRepo(key: string, githubRepo: string): Promise<boolean> {
  return updateProjectsConfigAsync((config) => {
    const project = config.projects[key];
    // Re-check under the write lock: another writer may have configured it.
    if (!project || tryResolveProjectTrackerType(project) !== null) {
      return { config, result: false, changed: false };
    }
    config.projects[key] = { ...project, github_repo: githubRepo };
    return { config, result: true, changed: true };
  });
}

export const defaultInferProjectTrackerDeps: InferProjectTrackerDeps = {
  readOriginUrl,
  writeGithubRepo,
};

/**
 * For a project that resolves no tracker, detect a GitHub origin and record it
 * as `github_repo`. Returns the slug it wrote, or null when it changed nothing
 * (tracker already resolvable, multi-repo root, no origin, non-GitHub origin).
 */
export async function inferProjectGithubRepo(
  key: string,
  project: ProjectConfig,
  deps: InferProjectTrackerDeps = defaultInferProjectTrackerDeps,
): Promise<string | null> {
  if (tryResolveProjectTrackerType(project) !== null) return null;
  // A multi-repo root is a plain folder; one tracker cannot be read from N remotes.
  if (project.workspace?.type === 'polyrepo') return null;
  const originUrl = await deps.readOriginUrl(project.path);
  if (!originUrl) return null;
  const githubRepo = githubRepoFromRemoteUrl(originUrl);
  if (!githubRepo) return null;
  return (await deps.writeGithubRepo(key, githubRepo)) ? githubRepo : null;
}

export interface InferredProjectTracker {
  key: string;
  name: string;
  path: string;
  githubRepo: string;
}

/**
 * Run `inferProjectGithubRepo` over every registered project that resolves no
 * tracker. Sequential: each write takes the projects.yaml lock anyway.
 */
export async function inferMissingProjectTrackers(
  deps: InferProjectTrackerDeps = defaultInferProjectTrackerDeps,
  listProjects: () => Promise<Array<{ key: string; config: ProjectConfig }>> = listProjectsAsync,
): Promise<InferredProjectTracker[]> {
  const configured: InferredProjectTracker[] = [];
  for (const { key, config } of await listProjects()) {
    if (tryResolveProjectTrackerType(config) !== null) continue;
    const githubRepo = await inferProjectGithubRepo(key, config, deps);
    if (githubRepo) configured.push({ key, name: config.name ?? key, path: config.path, githubRepo });
  }
  return configured;
}
