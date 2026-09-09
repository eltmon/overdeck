/**
 * Repair host paths that a rendered workspace Compose stack bind-mounts.
 *
 * Docker creates a missing bind source as root before the service user starts.
 * In a polyrepo workspace that turns an already-merged/removed repo checkout
 * into an unwritable empty directory. Containers can also leave root-owned
 * dependency caches inside an otherwise valid checkout. Rebuild repairs both
 * forms before `docker compose up` gets a chance to preserve or recreate them.
 */

import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';

import type { ProjectConfig, RepoConfig } from '../workspace-config.js';
import { removeWorkspaceDirectory } from '../workspace-manager/remove-directory.js';

const DISPOSABLE_CACHE_DIRS = new Set(['node_modules', '.pnpm-store']);
const execFileAsync = promisify(execFile);

interface OwnershipMismatch {
  path: string;
  uid: number;
  gid: number;
}

export interface RepairWorkspaceBindMountsOptions {
  workspacePath: string;
  issueId: string;
  projectConfig: ProjectConfig;
  composeFile: string;
  onProgress?: (message: string) => void;
}

export interface RepairWorkspaceBindMountsDeps {
  removeDirectory?: (path: string) => Promise<void>;
  createRepoWorktree?: (
    repoPath: string,
    targetPath: string,
    branchName: string,
    defaultBranch: string,
  ) => Promise<{ success: boolean; message: string }>;
  findOwnershipMismatch?: typeof findOwnershipMismatch;
  repairOwnership?: (path: string, uid: number, gid: number) => Promise<void>;
}

function composeReferencesRepo(composeContent: string, workspacePath: string, repo: RepoConfig): boolean {
  return [
    `../${repo.name}`,
    join(workspacePath, repo.name),
  ].some(candidate => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}(?=[:/\\s'"]|$)`).test(composeContent);
  });
}

async function findOwnershipMismatch(
  path: string,
  expectedUid: number,
  expectedGid: number,
): Promise<OwnershipMismatch | null> {
  const stat = await lstat(path);
  if (stat.uid !== expectedUid || stat.gid !== expectedGid) {
    return { path, uid: stat.uid, gid: stat.gid };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;

  for (const entry of await readdir(path)) {
    const mismatch = await findOwnershipMismatch(join(path, entry), expectedUid, expectedGid);
    if (mismatch) return mismatch;
  }
  return null;
}

function repoBranch(repo: RepoConfig, issueId: string): string {
  return `${repo.branch_prefix || 'feature/'}${issueId.toLowerCase()}`;
}

function repoSourcePath(projectConfig: ProjectConfig, repo: RepoConfig): string {
  const rawPath = join(projectConfig.path, repo.path);
  return existsSync(rawPath) ? realpathSync(rawPath) : rawPath;
}

function assertOnlyDisposableResidue(targetPath: string): void {
  const entries = readdirSync(targetPath);
  const unsafe = entries.filter(entry => !DISPOSABLE_CACHE_DIRS.has(entry));
  if (unsafe.length > 0) {
    throw new Error(
      `Cannot restore missing workspace repo at ${targetPath}: the unregistered directory contains `
      + `${unsafe.join(', ')}. Preserve or remove those files, then retry the rebuild.`,
    );
  }
}

async function repairRepoCaches(
  targetPath: string,
  repairOwnership: (path: string, uid: number, gid: number) => Promise<void>,
  progress: (message: string) => void,
  findMismatch: typeof findOwnershipMismatch,
): Promise<void> {
  const owner = lstatSync(targetPath);
  for (const cacheName of DISPOSABLE_CACHE_DIRS) {
    const cachePath = join(targetPath, cacheName);
    if (!existsSync(cachePath) || lstatSync(cachePath).isSymbolicLink()) continue;
    const mismatch = await findMismatch(cachePath, owner.uid, owner.gid);
    if (!mismatch) continue;
    progress(
      `Repairing ownership for ${relative(targetPath, cachePath)} cache `
      + `(found uid:gid ${mismatch.uid}:${mismatch.gid} at ${mismatch.path})...`,
    );
    try {
      await repairOwnership(cachePath, owner.uid, owner.gid);
    } catch (error) {
      throw new Error(
        `Could not repair ownership at ${mismatch.path} (uid:gid ${mismatch.uid}:${mismatch.gid}); `
        + `the workspace checkout expects ${owner.uid}:${owner.gid}. Restore that cache's ownership with chown `
        + `or remove the disposable ${cacheName} directory, then retry. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function repairCacheOwnership(path: string, uid: number, gid: number): Promise<void> {
  const real = realpathSync(path);
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || !real.includes('/workspaces/')
    || !DISPOSABLE_CACHE_DIRS.has(basename(real))
  ) {
    throw new Error(`Refusing ownership repair outside a real workspace dependency-cache directory: ${path}`);
  }
  await execFileAsync(
    'docker',
    ['run', '--rm', '-v', `${real}:/repair`, 'alpine', 'chown', '-R', `${uid}:${gid}`, '/repair'],
    { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
  );
}

/** Restore referenced polyrepo checkouts and heal their disposable caches. */
export async function repairWorkspaceBindMounts(
  options: RepairWorkspaceBindMountsOptions,
  deps: RepairWorkspaceBindMountsDeps = {},
): Promise<void> {
  const repos = options.projectConfig.workspace?.repos;
  if (options.projectConfig.workspace?.type !== 'polyrepo' || !repos?.length) return;

  const composeContent = readFileSync(options.composeFile, 'utf-8');
  const progress = options.onProgress ?? (() => {});
  const removeDirectory = deps.removeDirectory ?? removeWorkspaceDirectory;
  const createRepoWorktree = deps.createRepoWorktree ?? (async (...args) => {
    const { createWorktree } = await import('../workspace-manager/worktree-ops.js');
    return createWorktree(...args);
  });
  const findMismatch = deps.findOwnershipMismatch ?? findOwnershipMismatch;
  const repairOwnership = deps.repairOwnership ?? repairCacheOwnership;

  for (const repo of repos.filter(repo => composeReferencesRepo(composeContent, options.workspacePath, repo))) {
    const targetPath = join(options.workspacePath, repo.name);
    if (repo.link_type === 'symlink') continue;

    if (!existsSync(join(targetPath, '.git'))) {
      if (existsSync(targetPath)) {
        if (lstatSync(targetPath).isSymbolicLink()) {
          throw new Error(`Cannot restore missing workspace repo at ${targetPath}: the path is a symlink.`);
        }
        assertOnlyDisposableResidue(targetPath);
        await removeDirectory(targetPath);
      }

      progress(`Restoring missing ${repo.name} workspace checkout before Docker bind-mounts it...`);
      const result = await createRepoWorktree(
        repoSourcePath(options.projectConfig, repo),
        targetPath,
        repoBranch(repo, options.issueId),
        repo.default_branch || options.projectConfig.workspace?.default_branch || 'main',
      );
      if (!result.success) {
        throw new Error(`Could not restore ${repo.name} workspace checkout: ${result.message}`);
      }
    }

    await repairRepoCaches(targetPath, repairOwnership, progress, findMismatch);
  }
}
