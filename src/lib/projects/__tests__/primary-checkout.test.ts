/**
 * findPrimaryCheckout distinguishes a project's primary checkout (root, any
 * subdirectory of it, a polyrepo member root, a symlink to the root) from a
 * worktree or unrelated directory. Real temp dirs and real git — the
 * worktree-vs-subdirectory distinction depends on actual `git
 * rev-parse --show-toplevel` behavior, which a mock can't stand in for.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPrimaryCheckout, primaryCheckoutLabel } from '../primary-checkout.js';

function initGitRepo(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@e.t', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });
}

describe('findPrimaryCheckout', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'primary-checkout-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('matches a registered root directly (ac1)', async () => {
    const projectRoot = join(root, 'proj');
    mkdirSync(projectRoot);
    initGitRepo(projectRoot);

    const match = await findPrimaryCheckout(projectRoot, {
      listProjects: async () => [{ key: 'proj', config: { path: projectRoot } }],
    });

    expect(match).toEqual({ projectKey: 'proj', repoName: null, root: projectRoot });
  });

  it('matches a subdirectory through its git top level (ac1)', async () => {
    const projectRoot = join(root, 'proj');
    const subdir = join(projectRoot, 'src', 'lib');
    mkdirSync(subdir, { recursive: true });
    initGitRepo(projectRoot);

    const match = await findPrimaryCheckout(subdir, {
      listProjects: async () => [{ key: 'proj', config: { path: projectRoot } }],
    });

    expect(match).toEqual({ projectKey: 'proj', repoName: null, root: projectRoot });
  });

  it('rejects a git worktree added under <root>/workspaces/feature-x (ac2)', async () => {
    const projectRoot = join(root, 'proj');
    mkdirSync(projectRoot);
    initGitRepo(projectRoot);
    execSync('git branch feature-x', { cwd: projectRoot });
    const worktreeDir = join(projectRoot, 'workspaces', 'feature-x');
    mkdirSync(join(projectRoot, 'workspaces'));
    execSync(`git worktree add "${worktreeDir}" feature-x`, { cwd: projectRoot });

    const match = await findPrimaryCheckout(worktreeDir, {
      listProjects: async () => [{ key: 'proj', config: { path: projectRoot } }],
    });

    expect(match).toBeNull();
  });

  it('rejects an unrelated directory (ac2)', async () => {
    const projectRoot = join(root, 'proj');
    mkdirSync(projectRoot);
    initGitRepo(projectRoot);
    const unrelated = join(root, 'somewhere-else');
    mkdirSync(unrelated);

    const match = await findPrimaryCheckout(unrelated, {
      listProjects: async () => [{ key: 'proj', config: { path: projectRoot } }],
    });

    expect(match).toBeNull();
  });

  it('matches a polyrepo member root and labels it project/repo (ac3)', async () => {
    const projectRoot = join(root, 'proj');
    const apiRoot = join(projectRoot, 'api');
    mkdirSync(apiRoot, { recursive: true });
    initGitRepo(apiRoot);

    const match = await findPrimaryCheckout(apiRoot, {
      listProjects: async () => [
        { key: 'poly', config: { path: projectRoot, workspace: { repos: [{ name: 'api', path: 'api' }] } } },
      ],
    });

    expect(match).toEqual({ projectKey: 'poly', repoName: 'api', root: apiRoot });
    expect(primaryCheckoutLabel(match!)).toBe('poly/api');
  });

  it('produces a bare key label when there is no repo name', async () => {
    const projectRoot = join(root, 'proj');
    mkdirSync(projectRoot);
    initGitRepo(projectRoot);

    const match = await findPrimaryCheckout(projectRoot, {
      listProjects: async () => [{ key: 'proj', config: { path: projectRoot } }],
    });

    expect(primaryCheckoutLabel(match!)).toBe('proj');
  });

  it('resolves a symlink to the registered root (ac4)', async () => {
    const projectRoot = join(root, 'proj');
    mkdirSync(projectRoot);
    initGitRepo(projectRoot);
    const link = join(root, 'linked-proj');
    symlinkSync(projectRoot, link);

    const match = await findPrimaryCheckout(link, {
      listProjects: async () => [{ key: 'proj', config: { path: projectRoot } }],
    });

    expect(match).toEqual({ projectKey: 'proj', repoName: null, root: projectRoot });
  });

  it('matches a non-git root when gitToplevel is injected to return null (ac4)', async () => {
    const projectRoot = join(root, 'proj');
    mkdirSync(projectRoot);
    // Deliberately not a git repo.

    const match = await findPrimaryCheckout(projectRoot, {
      listProjects: async () => [{ key: 'proj', config: { path: projectRoot } }],
      gitToplevel: async () => null,
    });

    expect(match).toEqual({ projectKey: 'proj', repoName: null, root: projectRoot });
  });
});
