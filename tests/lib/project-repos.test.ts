import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig, ResolvedProject } from '../../src/lib/projects.js';

const projectsMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  resolveProjectFromIssue: vi.fn(),
}));

vi.mock('../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/projects.js')>('../../src/lib/projects.js');
  return {
    ...actual,
    getProject: projectsMocks.getProject,
    resolveProjectFromIssue: projectsMocks.resolveProjectFromIssue,
  };
});

import {
  inferProjectForgeSync,
  normalizeForgeSync,
  resolveConfiguredReposSync,
  resolveProjectReposForIssueSync,
} from '../../src/lib/project-repos.js';

describe('project-repos', () => {
  it('normalizes forge values from config-friendly strings', () => {
    expect(normalizeForgeSync('github')).toBe('github');
    expect(normalizeForgeSync('git@gitlab.com:foo/bar.git')).toBe('gitlab');
    expect(normalizeForgeSync('https://github.com/foo/bar')).toBe('github');
    expect(normalizeForgeSync('unknown')).toBeNull();
  });

  it('infers a project-level forge when only one forge is configured', () => {
    expect(inferProjectForgeSync({ github_repo: 'owner/repo', gitlab_repo: undefined })).toBe('github');
    expect(inferProjectForgeSync({ github_repo: undefined, gitlab_repo: 'group/repo' })).toBe('gitlab');
    expect(inferProjectForgeSync({ github_repo: 'owner/repo', gitlab_repo: 'group/repo' })).toBeNull();
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

    const repos = resolveConfiguredReposSync('mind-your-now', '/tmp/myn', projectConfig, 'MIN-632');
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
      name: 'Panopticon',
      path: '/tmp/panopticon',
      github_repo: 'eltmon/panopticon-cli',
      workspace: {
        type: 'monorepo',
        pr_target: 'main',
      },
    };

    const repos = resolveConfiguredReposSync('panopticon', '/tmp/panopticon', projectConfig, 'PAN-632');
    expect(repos).toEqual([
      expect.objectContaining({
        repoKey: 'panopticon',
        repoPath: '/tmp/panopticon',
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
    projectsMocks.resolveProjectFromIssue.mockReturnValue(resolvedProject);
    projectsMocks.getProject.mockReturnValue(projectConfig);

    const repos = resolveProjectReposForIssueSync('MIN-632');
    expect(repos).toHaveLength(1);
    expect(repos?.[0]).toMatchObject({
      projectKey: 'mind-your-now',
      repoKey: 'api',
      repoPath: '/tmp/myn/api',
      forge: 'gitlab',
    });
  });
});
