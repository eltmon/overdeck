/**
 * Where an issue's review artifacts live (PAN-5614).
 *
 * A specialist verdict is recorded on the issue's pull/merge request, so the
 * verdict command first needs the forge and a directory whose git remote names
 * the repository. The project configuration answers both: `forge`/`remote` on a
 * repo entry, else the project's `github_repo`/`gitlab_repo`.
 *
 * A polyrepo workspace root is a wrapper repository with no remote, so the old
 * `git remote get-url origin` probe there failed and silently answered GitHub.
 * A polyrepo issue instead has one target per writable member repo, each read
 * from the project's own checkout of that repo. The workspace's remote is read
 * only for a project that configures no forge, and a failed read is an error,
 * never GitHub.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseArtifactRef, type ForgeType } from '../forge.js';
import { inferProjectForge, normalizeForge, resolveConfiguredRepos } from '../project-repos.js';
import { findProjectByPath, getProjectSync, resolveProjectFromIssueSync, type ProjectConfig } from '../projects.js';
import { readGitLabMrFacts, type PrFacts } from './pr-facts.js';

const execFileAsync = promisify(execFile);

/** One repository that may hold the issue's review artifact. */
export interface ReviewArtifactTarget {
  repoKey: string;
  forge: ForgeType;
  /** A checkout whose `origin` is this repository; forge CLIs run here. */
  cwd: string;
  sourceBranch: string;
}

export interface ReviewArtifactTargets {
  targets: ReviewArtifactTarget[];
  /** True when the project has more than one configured repo. */
  polyrepo: boolean;
}

/** Neither the project configuration nor the workspace's remote names a forge. */
export class ForgeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForgeResolutionError';
  }
}

export interface ReviewArtifactTargetDeps {
  /** The issue's project, by issue prefix and then by workspace path. */
  projectFor?: (issueId: string, workspacePath: string) => { key: string; config: ProjectConfig } | null;
  /** `git remote get-url origin` in `cwd`; throws when there is none. */
  remoteUrl?: (cwd: string) => Promise<string>;
}

function defaultProjectFor(issueId: string, workspacePath: string): { key: string; config: ProjectConfig } | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  const byIssue = resolved ? getProjectSync(resolved.projectKey) : null;
  if (resolved && byIssue) return { key: resolved.projectKey, config: byIssue };
  const byPath = findProjectByPath(workspacePath);
  return byPath ? { key: byPath.name, config: byPath } : null;
}

async function defaultRemoteUrl(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

/** The configured forge of a single-repo project, or null when nothing names one. */
function configuredForge(config: ProjectConfig): ForgeType | null {
  const repo = config.workspace?.repos?.[0];
  return normalizeForge(repo?.forge) ?? normalizeForge(repo?.remote) ?? inferProjectForge(config);
}

/**
 * The repositories to look for the issue's review artifact in. A single-repo
 * issue has one target at the workspace; a polyrepo issue has one per writable
 * member, in configured order. Throws {@link ForgeResolutionError} when no
 * forge can be determined.
 */
export async function resolveReviewArtifactTargets(
  issueId: string,
  workspacePath: string,
  deps: ReviewArtifactTargetDeps = {},
): Promise<ReviewArtifactTargets> {
  const project = (deps.projectFor ?? defaultProjectFor)(issueId, workspacePath);
  if (project && (project.config.workspace?.repos?.length ?? 0) > 1) {
    const targets = resolveConfiguredRepos(project.key, project.config.path, project.config, issueId)
      .filter((repo) => repo.required)
      .map((repo) => ({ repoKey: repo.repoKey, forge: repo.forge, cwd: repo.repoPath, sourceBranch: repo.sourceBranch }));
    return { targets, polyrepo: true };
  }

  const sourceBranch = `feature/${issueId.toLowerCase()}`;
  const repoKey = project?.key ?? issueId.toLowerCase();
  const configured = project ? configuredForge(project.config) : null;
  if (configured) return { targets: [{ repoKey, forge: configured, cwd: workspacePath, sourceBranch }], polyrepo: false };

  let url: string;
  try {
    url = await (deps.remoteUrl ?? defaultRemoteUrl)(workspacePath);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ForgeResolutionError(
      `${project ? `project ${project.key} configures no forge` : `no project is configured for ${issueId}`}, `
      + `and reading the git remote in ${workspacePath} failed: ${reason.trim()}`,
    );
  }
  const forge: ForgeType = /gitlab/i.test(url) ? 'gitlab' : 'github';
  return { targets: [{ repoKey, forge, cwd: workspacePath, sourceBranch }], polyrepo: false };
}

/**
 * The facts of one member repo's GitLab merge request, read from the URL its
 * discovery returned. `getPrFacts` answers for one MR per issue; a polyrepo
 * verdict reads each member's own MR so it can approve every one of them.
 */
export async function readMemberMrFacts(
  issueId: string,
  sourceBranch: string,
  url: string,
  readFacts: typeof readGitLabMrFacts = readGitLabMrFacts,
): Promise<PrFacts> {
  const iid = parseArtifactRef(url)?.number;
  return readFacts(issueId, { iid, web_url: url, source_branch: sourceBranch, state: 'opened' });
}
