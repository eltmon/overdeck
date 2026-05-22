import { Effect } from 'effect';
import { join } from 'path';
import { getProjectSync, resolveProjectFromIssueSync, type ProjectConfig, type ResolvedProject } from './projects.js';
import type { ForgeType } from './forge.js';
import type { RepoConfig } from './workspace-config.js';

export interface ResolvedProjectRepo {
  projectKey: string;
  projectPath: string;
  repoKey: string;
  repoPath: string;
  forge: ForgeType;
  sourceBranch: string;
  targetBranch: string;
  mergeOrder: number;
  required: boolean;
}

export function normalizeForgeSync(value?: string | null): ForgeType | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'github' || normalized.includes('github.com')) return 'github';
  if (normalized === 'gitlab' || normalized.includes('gitlab.com')) return 'gitlab';
  return null;
}

export function inferProjectForgeSync(projectConfig: Pick<ProjectConfig, 'github_repo' | 'gitlab_repo'>): ForgeType | null {
  if (projectConfig.github_repo && !projectConfig.gitlab_repo) return 'github';
  if (projectConfig.gitlab_repo && !projectConfig.github_repo) return 'gitlab';
  return null;
}

function getRepoSourceBranch(repo: Pick<RepoConfig, 'branch_prefix'> | undefined, issueId: string): string {
  const prefix = repo?.branch_prefix || 'feature/';
  return `${prefix}${issueId.toLowerCase()}`;
}

function getRepoTargetBranch(
  repo: Pick<RepoConfig, 'pr_target' | 'default_branch'> | undefined,
  projectConfig: Pick<ProjectConfig, 'workspace'>
): string {
  return (
    repo?.pr_target ||
    projectConfig.workspace?.pr_target ||
    repo?.default_branch ||
    projectConfig.workspace?.default_branch ||
    'main'
  );
}

function getRepoForge(repo: Partial<RepoConfig> | undefined, projectConfig: ProjectConfig): ForgeType {
  return (
    normalizeForgeSync(repo?.forge) ||
    normalizeForgeSync(repo?.remote) ||
    inferProjectForgeSync(projectConfig) ||
    'github'
  );
}

export function resolveConfiguredReposSync(
  projectKey: string,
  projectPath: string,
  projectConfig: ProjectConfig,
  issueId: string
): ResolvedProjectRepo[] {
  const repos = projectConfig.workspace?.repos;
  if (!repos || repos.length === 0) {
    return [{
      projectKey,
      projectPath,
      repoKey: projectKey,
      repoPath: projectPath,
      forge: inferProjectForgeSync(projectConfig) || 'github',
      sourceBranch: `feature/${issueId.toLowerCase()}`,
      targetBranch: projectConfig.workspace?.pr_target || projectConfig.workspace?.default_branch || 'main',
      mergeOrder: 0,
      required: true,
    }];
  }

  return repos.map((repo, index) => ({
    projectKey,
    projectPath,
    repoKey: repo.name,
    repoPath: join(projectPath, repo.path),
    forge: getRepoForge(repo, projectConfig),
    sourceBranch: getRepoSourceBranch(repo, issueId),
    targetBranch: getRepoTargetBranch(repo, projectConfig),
    mergeOrder: index,
    required: repo.readonly !== true,
  }));
}

export function resolveProjectReposForIssueSync(
  issueId: string,
  labels: string[] = []
): ResolvedProjectRepo[] | null {
  const resolvedProject = resolveProjectFromIssueSync(issueId, labels);
  if (!resolvedProject) return null;

  return resolveProjectReposFromResolvedIssueSync(issueId, resolvedProject);
}

export function resolveProjectReposFromResolvedIssueSync(
  issueId: string,
  resolvedProject: ResolvedProject
): ResolvedProjectRepo[] | null {
  const projectConfig = getProjectSync(resolvedProject.projectKey);
  if (!projectConfig) return null;

  return resolveConfiguredReposSync(
    resolvedProject.projectKey,
    resolvedProject.projectPath,
    projectConfig,
    issueId
  );
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Pure-sync project/repo resolution — additive Effect.sync wrappers.

/** Normalize a free-form forge string ("github.com", "Gitlab", etc.). Pure. */
export const normalizeForge = (
  value?: string | null,
): Effect.Effect<ForgeType | null> => Effect.sync(() => normalizeForgeSync(value));

/** Infer the forge for a project from configured repo URLs. Pure. */
export const inferProjectForge = (
  projectConfig: Pick<ProjectConfig, 'github_repo' | 'gitlab_repo'>,
): Effect.Effect<ForgeType | null> => Effect.sync(() => inferProjectForgeSync(projectConfig));

/** Expand configured repos for an issue into a flat list. Pure. */
export const resolveConfiguredRepos = (
  projectKey: string,
  projectPath: string,
  projectConfig: ProjectConfig,
  issueId: string,
): Effect.Effect<ResolvedProjectRepo[]> =>
  Effect.sync(() =>
    resolveConfiguredReposSync(projectKey, projectPath, projectConfig, issueId),
  );

/** Resolve repos for an issue by id + labels. Pure. */
export const resolveProjectReposForIssue = (
  issueId: string,
  labels: string[] = [],
): Effect.Effect<ResolvedProjectRepo[] | null> =>
  Effect.sync(() => resolveProjectReposForIssueSync(issueId, labels));

/** Resolve repos from an already-resolved project. Pure. */
export const resolveProjectReposFromResolvedIssue = (
  issueId: string,
  resolvedProject: ResolvedProject,
): Effect.Effect<ResolvedProjectRepo[] | null> =>
  Effect.sync(() => resolveProjectReposFromResolvedIssueSync(issueId, resolvedProject));
