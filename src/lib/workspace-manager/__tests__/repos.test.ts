import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../projects.js';
import {
  addNewRepoToWorkspacePromise,
  addReposToWorkspacePromise,
  inferRepoNameFromGitUrl,
} from '../repos.js';

const scratch: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'overdeck-add-repo-'));
  scratch.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function createRemote(root: string): string {
  const remote = join(root, 'new-service.git');
  const seed = join(root, 'seed');
  mkdirSync(seed);
  execFileSync('git', ['init', '--bare', '--quiet', remote]);
  execFileSync('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(seed, ['init', '--initial-branch=main']);
  git(seed, ['config', 'user.email', 'test@example.com']);
  git(seed, ['config', 'user.name', 'Test User']);
  writeFileSync(join(seed, 'README.md'), '# new service\n');
  git(seed, ['add', 'README.md']);
  git(seed, ['commit', '--quiet', '-m', 'initial']);
  git(seed, ['remote', 'add', 'origin', remote]);
  git(seed, ['push', '--quiet', '-u', 'origin', 'main']);
  return remote;
}

function projectConfig(projectRoot: string): ProjectConfig {
  return {
    name: 'Test Polyrepo',
    path: projectRoot,
    issue_prefix: 'MIN',
    workspace: {
      type: 'polyrepo',
      workspaces_dir: 'workspaces',
      default_branch: 'main',
      repos: [{ name: 'api', path: 'api', branch_prefix: 'feature/' }],
    },
  };
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('workspace repo registration', () => {
  it('rejects unknown configured repos during dry-run', async () => {
    const root = tempDir();
    const projectRoot = join(root, 'project');
    mkdirSync(join(projectRoot, 'workspaces', 'feature-min-850'), { recursive: true });

    const result = await addReposToWorkspacePromise({
      projectConfig: projectConfig(projectRoot),
      featureName: 'min-850',
      repoNames: ['hermes-plugin'],
      dryRun: true,
    });

    expect(result).toEqual({
      success: false,
      errors: ['Unknown repos: hermes-plugin'],
      steps: [],
    });
  });

  it('clones, creates the feature worktree, and persists a new repo', async () => {
    const root = tempDir();
    const projectRoot = join(root, 'project');
    const workspaceRoot = join(projectRoot, 'workspaces', 'feature-min-850');
    mkdirSync(workspaceRoot, { recursive: true });
    const remote = createRemote(root);
    const persistProject = vi.fn();

    const result = await addNewRepoToWorkspacePromise({
      projectKey: 'mind-your-now',
      projectConfig: projectConfig(projectRoot),
      featureName: 'min-850',
      gitUrl: remote,
      repoName: 'hermes-plugin',
    }, { persistProject });

    expect(result.success).toBe(true);
    expect(git(join(workspaceRoot, 'hermes-plugin'), ['branch', '--show-current'])).toBe('feature/min-850');
    expect(persistProject).toHaveBeenCalledOnce();
    expect(persistProject.mock.calls[0]?.[0]).toBe('mind-your-now');
    expect(persistProject.mock.calls[0]?.[1].workspace.repos).toContainEqual({
      name: 'hermes-plugin',
      path: 'hermes-plugin',
      branch_prefix: 'feature/',
    });
  });

  it('infers a repository name from SSH and HTTPS URLs', () => {
    expect(inferRepoNameFromGitUrl('git@github.com:acme/hermes-plugin.git')).toBe('hermes-plugin');
    expect(inferRepoNameFromGitUrl('https://github.com/acme/hermes-plugin/')).toBe('hermes-plugin');
  });
});
