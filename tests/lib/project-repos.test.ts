import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig, ResolvedProject } from '../../src/lib/projects.js';

const projectsMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  resolveProjectFromIssue: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  findProjectByPath: vi.fn(),
}));

vi.mock('../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/projects.js')>('../../src/lib/projects.js');
  return {
    ...actual,
    getProject: projectsMocks.getProject,
    getProjectSync: projectsMocks.getProject,
    resolveProjectFromIssue: projectsMocks.resolveProjectFromIssue,
    resolveProjectFromIssueSync: projectsMocks.resolveProjectFromIssueSync,
    findProjectByPath: projectsMocks.findProjectByPath,
  };
});

import {
  computeWorkspaceRepoRoots,
  defaultBranchForRepo,
  inferProjectForge,
  normalizeForge,
  resolveConfiguredRepos,
  resolveDefaultBranchForRepo,
  resolvePrimaryWorkspaceRepoDir,
  resolveProjectReposForIssue,
  type ResolvedProjectRepo,
} from '../../src/lib/project-repos.js';

type ResolvedRepoT = ResolvedProjectRepo;

describe('project-repos', () => {
  it('normalizes forge values from config-friendly strings', () => {
    expect(normalizeForge('github')).toBe('github');
    expect(normalizeForge('git@gitlab.com:foo/bar.git')).toBe('gitlab');
    expect(normalizeForge('https://github.com/foo/bar')).toBe('github');
    expect(normalizeForge('unknown')).toBeNull();
  });

  it('infers a project-level forge when only one forge is configured', () => {
    expect(inferProjectForge({ github_repo: 'owner/repo', gitlab_repo: undefined })).toBe('github');
    expect(inferProjectForge({ github_repo: undefined, gitlab_repo: 'group/repo' })).toBe('gitlab');
    expect(inferProjectForge({ github_repo: 'owner/repo', gitlab_repo: 'group/repo' })).toBeNull();
  });

  it('resolves polyrepo repos from configured metadata', () => {
    const projectConfig: ProjectConfig = {
      name: 'Mind Your Now',
      path: '/tmp/myn',
      gitlab_repo: 'eltmon/mind-your-now',
      workspace: {
        type: 'polyrepo',
        default_branch: 'main',
        pr_target: 'develop',
        repos: [
          { name: 'fe', path: 'frontend', remote: 'gitlab' },
          { name: 'api', path: 'api', pr_target: 'qa' },
          { name: 'myn-skills', path: 'myn-skills', forge: 'github' },
        ],
      },
    };

    const repos = resolveConfiguredRepos('mind-your-now', '/tmp/myn', projectConfig, 'MIN-632');
    expect(repos).toHaveLength(3);
    expect(repos[0]).toMatchObject({
      repoKey: 'fe',
      repoPath: '/tmp/myn/frontend',
      forge: 'gitlab',
      sourceBranch: 'feature/min-632',
      targetBranch: 'develop',
    });
    expect(repos[1].targetBranch).toBe('qa');
    expect(repos[2].forge).toBe('github');
  });

  it('resolves a monorepo project as a single repo target', () => {
    const projectConfig: ProjectConfig = {
      name: 'Overdeck',
      path: '/tmp/overdeck',
      github_repo: 'eltmon/overdeck',
      workspace: {
        type: 'monorepo',
        pr_target: 'main',
      },
    };

    const repos = resolveConfiguredRepos('overdeck', '/tmp/overdeck', projectConfig, 'PAN-632');
    expect(repos).toEqual([
      expect.objectContaining({
        repoKey: 'overdeck',
        repoPath: '/tmp/overdeck',
        forge: 'github',
        sourceBranch: 'feature/pan-632',
        targetBranch: 'main',
      }),
    ]);
  });

  it('resolves repos for an issue via resolved project lookup', () => {
    const resolvedProject: ResolvedProject = {
      projectKey: 'mind-your-now',
      projectName: 'Mind Your Now',
      projectPath: '/tmp/myn',
      linearTeam: 'MIN',
    };
    const projectConfig: ProjectConfig = {
      name: 'Mind Your Now',
      path: '/tmp/myn',
      gitlab_repo: 'eltmon/myn',
      workspace: {
        type: 'polyrepo',
        repos: [{ name: 'api', path: 'api', remote: 'gitlab' }],
      },
    };
    projectsMocks.resolveProjectFromIssueSync.mockReturnValue(resolvedProject);
    projectsMocks.getProject.mockReturnValue(projectConfig);

    const repos = resolveProjectReposForIssue('MIN-632');
    expect(repos).toHaveLength(1);
    expect(repos?.[0]).toMatchObject({
      projectKey: 'mind-your-now',
      repoKey: 'api',
      repoPath: '/tmp/myn/api',
      forge: 'gitlab',
    });
  });
});

describe('computeWorkspaceRepoRoots', () => {
  const makeRepo = (repoKey: string, overrides: Partial<ResolvedRepoT> = {}): ResolvedRepoT => ({
    projectKey: 'mind-your-now',
    projectPath: '/tmp/myn',
    repoKey,
    repoPath: `/tmp/myn/${repoKey}`,
    forge: 'gitlab',
    sourceBranch: 'feature/min-999',
    targetBranch: 'main',
    mergeOrder: 0,
    required: true,
    ...overrides,
  });

  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-repo-roots-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('maps polyrepo sub-repos with .git present to workspace-nested roots', () => {
    mkdirSync(join(workspace, 'fe', '.git'), { recursive: true });
    mkdirSync(join(workspace, 'api', '.git'), { recursive: true });
    mkdirSync(join(workspace, 'infra'), { recursive: true }); // no .git — skipped

    const roots = computeWorkspaceRepoRoots(
      [makeRepo('fe'), makeRepo('api'), makeRepo('infra'), makeRepo('docs', { required: false })],
      'MIN-999',
      workspace
    );

    expect(roots).toEqual([
      expect.objectContaining({ repoKey: 'fe', dir: join(workspace, 'fe'), sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: true }),
      expect.objectContaining({ repoKey: 'api', dir: join(workspace, 'api'), isPolyrepo: true }),
    ]);
  });

  it('treats a worktree .git file as a valid sub-repo marker', () => {
    mkdirSync(join(workspace, 'fe'), { recursive: true });
    writeFileSync(join(workspace, 'fe', '.git'), 'gitdir: /tmp/myn/frontend/.git/worktrees/fe\n');

    const roots = computeWorkspaceRepoRoots([makeRepo('fe'), makeRepo('api')], 'MIN-999', workspace);
    expect(roots).toEqual([
      expect.objectContaining({ repoKey: 'fe', dir: join(workspace, 'fe'), isPolyrepo: true }),
    ]);
  });

  it('falls back to the workspace root when no polyrepo sub-repo is on disk', () => {
    const roots = computeWorkspaceRepoRoots([makeRepo('fe'), makeRepo('api')], 'MIN-999', workspace);
    expect(roots).toEqual([
      expect.objectContaining({ repoKey: 'fe', dir: workspace, isPolyrepo: false }),
    ]);
  });

  it('resolves a monorepo (single configured repo) to the workspace root', () => {
    const roots = computeWorkspaceRepoRoots([makeRepo('overdeck', { targetBranch: 'develop' })], 'PAN-1', workspace);
    expect(roots).toEqual([
      expect.objectContaining({ repoKey: 'overdeck', dir: workspace, sourceBranch: 'feature/min-999', targetBranch: 'develop', isPolyrepo: false }),
    ]);
  });

  it('defaults sensibly when repo resolution returned null', () => {
    const roots = computeWorkspaceRepoRoots(null, 'MIN-999', workspace);
    expect(roots).toEqual([
      expect.objectContaining({ repoKey: 'min-999', dir: workspace, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: false }),
    ]);
  });
});

describe('resolvePrimaryWorkspaceRepoDir', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-primary-repo-'));
    projectsMocks.resolveProjectFromIssueSync.mockReset();
    projectsMocks.getProject.mockReset();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns the workspace path for a monorepo project', () => {
    projectsMocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: '/tmp/overdeck',
    });
    projectsMocks.getProject.mockReturnValue({
      name: 'Overdeck',
      path: '/tmp/overdeck',
      github_repo: 'eltmon/overdeck',
      workspace: { type: 'monorepo' },
    });

    expect(resolvePrimaryWorkspaceRepoDir('PAN-3037', workspace)).toBe(workspace);
  });

  it('returns the first required repo directory for a polyrepo workspace', () => {
    mkdirSync(join(workspace, 'api', '.git'), { recursive: true });
    mkdirSync(join(workspace, 'fe', '.git'), { recursive: true });
    projectsMocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'mind-your-now',
      projectName: 'Mind Your Now',
      projectPath: '/tmp/myn',
      linearTeam: 'MIN',
    });
    projectsMocks.getProject.mockReturnValue({
      name: 'Mind Your Now',
      path: '/tmp/myn',
      gitlab_repo: 'eltmon/myn',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'api', path: 'api', remote: 'gitlab' },
          { name: 'fe', path: 'fe', remote: 'gitlab' },
        ],
      },
    });

    expect(resolvePrimaryWorkspaceRepoDir('MIN-850', workspace)).toBe(join(workspace, 'api'));
  });
});

describe('defaultBranchForRepo / resolveDefaultBranchForRepo (PAN-4501)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns main when there is no project', () => {
    expect(defaultBranchForRepo(null, '/x')).toBe('main');
  });

  it('returns the workspace default branch', () => {
    const project = { workspace: { default_branch: 'trunk' } } as ProjectConfig;
    expect(defaultBranchForRepo(project, '/x')).toBe('trunk');
  });

  it('ignores pr_target in favor of the workspace default branch', () => {
    const project = { workspace: { default_branch: 'trunk', pr_target: 'release' } } as ProjectConfig;
    expect(defaultBranchForRepo(project, '/x')).toBe('trunk');
  });

  it('matches a workspace.repos[] entry by trailing path segment, else falls back to the workspace default', () => {
    const project = {
      workspace: {
        default_branch: 'main',
        repos: [{ name: 'fe', path: 'frontend', default_branch: 'develop' }],
      },
    } as ProjectConfig;

    expect(defaultBranchForRepo(project, '/p/workspaces/feature-x/frontend')).toBe('develop');
    expect(defaultBranchForRepo(project, '/p/backend')).toBe('main');
  });

  it('resolves the project by explicit key first, then falls back to findProjectByPath', () => {
    projectsMocks.getProject.mockReturnValue(null);
    projectsMocks.findProjectByPath.mockReturnValue({ workspace: { default_branch: 'develop' } });

    expect(resolveDefaultBranchForRepo('/r', 'k')).toBe('develop');
    expect(projectsMocks.getProject).toHaveBeenCalledWith('k');
    expect(projectsMocks.findProjectByPath).toHaveBeenCalledWith('/r');
  });
});
