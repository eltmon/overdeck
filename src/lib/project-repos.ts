import { existsSync } from 'fs';
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

export function normalizeForge(value?: string | null): ForgeType | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'github' || normalized.includes('github.com')) return 'github';
  if (normalized === 'gitlab' || normalized.includes('gitlab.com')) return 'gitlab';
  return null;
}

/**
 * The forge behind a git remote URL, read from its host: `gitlab` for any
 * host naming GitLab (gitlab.com or a self-hosted `gitlab.example.com`),
 * `github` for one naming GitHub. Null when the host says neither.
 */
export function forgeFromRemoteUrl(url?: string | null): ForgeType | null {
  if (!url) return null;
  const trimmed = url.trim().toLowerCase();
  // https://host/…, ssh://user@host:port/…, or scp-style user@host:path
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/.exec(trimmed)?.[1]
    ?? /^(?:[^@/]+@)?([^/:]+):/.exec(trimmed)?.[1]
    ?? null;
  if (!host) return null;
  if (host.includes('gitlab')) return 'gitlab';
  if (host.includes('github')) return 'github';
  return null;
}

export function inferProjectForge(projectConfig: Pick<ProjectConfig, 'github_repo' | 'gitlab_repo'>): ForgeType | null {
  if (projectConfig.github_repo && !projectConfig.gitlab_repo) return 'github';
  if (projectConfig.gitlab_repo && !projectConfig.github_repo) return 'gitlab';
  return null;
}

function getRepoSourceBranch(repo: Pick<RepoConfig, 'branch_prefix'> | undefined, issueId: string): string {
  const prefix = repo?.branch_prefix || 'feature/';
  return `${prefix}${issueId.toLowerCase()}`;
}

export function getRepoTargetBranch(
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

export function getRepoForge(repo: Partial<RepoConfig> | undefined, projectConfig: ProjectConfig): ForgeType {
  return (
    normalizeForge(repo?.forge) ||
    normalizeForge(repo?.remote) ||
    inferProjectForge(projectConfig) ||
    'github'
  );
}

export function resolveConfiguredRepos(
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
      forge: inferProjectForge(projectConfig) || 'github',
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

export function resolveProjectReposForIssue(
  issueId: string,
  labels: string[] = []
): ResolvedProjectRepo[] | null {
  const resolvedProject = resolveProjectFromIssueSync(issueId, labels);
  if (!resolvedProject) return null;

  return resolveProjectReposFromResolvedIssue(issueId, resolvedProject);
}

export function resolveProjectReposFromResolvedIssue(
  issueId: string,
  resolvedProject: ResolvedProject
): ResolvedProjectRepo[] | null {
  const projectConfig = getProjectSync(resolvedProject.projectKey);
  if (!projectConfig) return null;

  return resolveConfiguredRepos(
    resolvedProject.projectKey,
    resolvedProject.projectPath,
    projectConfig,
    issueId
  );
}

// ─── Workspace repo roots (PAN-2948) ─────────────────────────────────────────
// A polyrepo workspace is a wrapper directory whose code lives in nested
// sub-repo worktrees named by repo key (<workspace>/fe, <workspace>/api, …).
// The wrapper itself is a one-commit artifacts repo (planning scaffold +
// .gitignore excluding the sub-repos), so any git operation that matters —
// diffing, pushing, head resolution — must run inside the sub-repos, never
// the workspace root. Monorepo workspaces resolve to a single root at the
// workspace path, so callers can loop unconditionally.

export interface WorkspaceRepoRoot {
  repoKey: string;
  /** Absolute path of the repo checkout inside the workspace. */
  dir: string;
  sourceBranch: string;
  targetBranch: string;
  isPolyrepo: boolean;
  /**
   * PAN-3254: set when a >1-repo project resolved zero sub-repo roots and the
   * fallback points at the polyrepo wrapper. Head snapshots treat this root as
   * unreadable rather than fabricating an anchor from the wrapper HEAD.
   */
  degradedPolyrepo?: boolean;
}

/** Pure mapping from resolved repos + workspace path to on-disk repo roots. */
export function computeWorkspaceRepoRoots(
  repos: ResolvedProjectRepo[] | null,
  issueId: string,
  workspacePath: string
): WorkspaceRepoRoot[] {
  if (repos && repos.length > 1) {
    const roots = repos
      .filter(repo => repo.required)
      .flatMap(repo => {
        // PAN-3254: workspaces may be laid out by repo key OR by the repo's
        // path name (MYN declares `name: fe` / `path: frontend`); resolving by
        // key alone left zero polyrepo roots, degrading every head snapshot to
        // the never-moving wrapper HEAD.
        const candidates = [...new Set([repo.repoKey, repo.repoPath].filter(Boolean))];
        const dir = candidates
          .map(candidate => join(workspacePath, candidate))
          .find(candidateDir => existsSync(join(candidateDir, '.git')));
        if (!dir) return [];
        return [{
          repoKey: repo.repoKey,
          dir,
          sourceBranch: repo.sourceBranch,
          targetBranch: repo.targetBranch,
          isPolyrepo: true,
        }];
      });
    if (roots.length > 0) return roots;
  }

  const single = repos?.[0];
  return [{
    repoKey: single?.repoKey ?? issueId.toLowerCase(),
    dir: workspacePath,
    sourceBranch: single?.sourceBranch ?? `feature/${issueId.toLowerCase()}`,
    targetBranch: single?.targetBranch ?? 'main',
    isPolyrepo: false,
    // PAN-3254: a >1-repo config that resolved zero sub-repo roots means this
    // fallback points at the polyrepo WRAPPER, whose HEAD never moves — head
    // snapshots must refuse to fabricate an anchor from it.
    ...(repos && repos.length > 1 ? { degradedPolyrepo: true } : {}),
  }];
}

/** Resolve the git roots inside a workspace for an issue (polyrepo-aware). */
export function resolveWorkspaceRepoRoots(
  issueId: string,
  workspacePath: string
): WorkspaceRepoRoot[] {
  return computeWorkspaceRepoRoots(
    resolveProjectReposForIssue(issueId),
    issueId,
    workspacePath
  );
}

/** Resolve the primary git checkout used by single-repo workspace probes. */
export function resolvePrimaryWorkspaceRepoDir(
  issueId: string,
  workspacePath: string
): string {
  return resolveWorkspaceRepoRoots(issueId, workspacePath)[0].dir;
}

// ─── Slot workspace worktrees (PAN-3686) ─────────────────────────────────────
// A polyrepo swarm slot workspace (<workspace>-slot-N) is an aggregate
// directory whose registered git worktrees are the nested sub-repo checkouts
// (<slot>/fe, <slot>/api, …), each owned by a DIFFERENT parent repository.
// Git cannot remove the aggregate root while nested worktrees live inside it
// ("Directory not empty"), so GC must enumerate and detach the nested
// worktrees first — and each removal must run in the owning parent repo, not
// the base workspace.

export interface NestedSlotWorktree {
  repoKey: string;
  /** Absolute path of the nested sub-repo worktree inside the slot workspace. */
  dir: string;
  /** Absolute path of the owning repository's main checkout (worktree-remove cwd). */
  parentRepo: string;
  /** Per-repo feature branch the slot branch merges into (e.g. feature/min-888). */
  featureBranch: string;
}

export interface SlotWorkspaceWorktrees {
  /** True when the project is configured with more than one repo. */
  isPolyrepo: boolean;
  /** Nested sub-repo worktrees present on disk inside the slot workspace. */
  nested: NestedSlotWorktree[];
}

/**
 * Resolve the registered nested worktrees of a swarm slot workspace through
 * the polyrepo workspace abstraction. Monorepo slots resolve to zero nested
 * worktrees; callers then remove the slot workspace root directly.
 */
export function resolveSlotWorkspaceWorktrees(
  issueId: string,
  slotWorkspace: string
): SlotWorkspaceWorktrees {
  const repos = resolveProjectReposForIssue(issueId);
  const isPolyrepo = (repos?.length ?? 0) > 1;
  if (!repos || !isPolyrepo) return { isPolyrepo, nested: [] };
  const repoByKey = new Map(repos.map(repo => [repo.repoKey, repo]));
  const nested = computeWorkspaceRepoRoots(repos, issueId, slotWorkspace)
    .filter(root => root.isPolyrepo)
    .flatMap(root => {
      const repo = repoByKey.get(root.repoKey);
      return repo
        ? [{ repoKey: root.repoKey, dir: root.dir, parentRepo: repo.repoPath, featureBranch: root.sourceBranch }]
        : [];
    });
  return { isPolyrepo, nested };
}
