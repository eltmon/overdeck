import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { repairWorkspaceBindMounts } from '../../../../src/lib/workspace/rebuild-bind-mounts.js';
import type { ProjectConfig } from '../../../../src/lib/workspace-config.js';

let tmpRoot: string | null = null;

function fixture(): RepairFixture {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pan-rebuild-bind-mounts-'));
  const projectPath = join(tmpRoot, 'project');
  const workspacePath = join(projectPath, 'workspaces', 'feature-min-889');
  const composeFile = join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml');
  mkdirSync(join(projectPath, 'frontend', '.git'), { recursive: true });
  mkdirSync(join(projectPath, 'splash', '.git'), { recursive: true });
  mkdirSync(join(workspacePath, '.devcontainer'), { recursive: true });
  writeFileSync(composeFile, [
    'services:',
    '  init-fe:',
    '    volumes:',
    '      - ../fe:/workspaces/feature/fe:cached',
  ].join('\n'));
  return {
    workspacePath,
    composeFile,
    issueId: 'MIN-889',
    projectConfig: {
      name: 'myn',
      path: projectPath,
      workspace: {
        type: 'polyrepo',
        workspaces_dir: 'workspaces',
        default_branch: 'main',
        repos: [
          { name: 'fe', path: 'frontend', branch_prefix: 'feature/' },
          { name: 'splash', path: 'splash', branch_prefix: 'feature/' },
        ],
      },
    },
  };
}

interface RepairFixture {
  workspacePath: string;
  composeFile: string;
  issueId: string;
  projectConfig: ProjectConfig;
}

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe('repairWorkspaceBindMounts (PAN-3570)', () => {
  it('restores an empty ownership-residue directory when Compose still bind-mounts that repo', async () => {
    const options = fixture();
    const targetPath = join(options.workspacePath, 'fe');
    mkdirSync(targetPath, { recursive: true });
    const removeDirectory = vi.fn(async (path: string) => rmSync(path, { recursive: true, force: true }));
    const createRepoWorktree = vi.fn(async (_source: string, target: string) => {
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, '.git'), 'gitdir: fixture');
      return { success: true, message: 'created' };
    });

    await repairWorkspaceBindMounts(options, { removeDirectory, createRepoWorktree });

    expect(removeDirectory).toHaveBeenCalledWith(targetPath);
    expect(createRepoWorktree).toHaveBeenCalledWith(
      join(options.projectConfig.path, 'frontend'),
      targetPath,
      'feature/min-889',
      'main',
    );
    expect(createRepoWorktree).toHaveBeenCalledTimes(1);
  });

  it('does not recreate a configured repo that the rendered Compose stack does not use', async () => {
    const options = fixture();
    mkdirSync(join(options.workspacePath, 'fe'), { recursive: true });
    writeFileSync(join(options.workspacePath, 'fe', '.git'), 'gitdir: fixture');
    const createRepoWorktree = vi.fn();

    await repairWorkspaceBindMounts(options, { createRepoWorktree });

    expect(createRepoWorktree).not.toHaveBeenCalled();
    expect(existsSync(join(options.workspacePath, 'splash'))).toBe(false);
  });

  it('repairs a cache when any nested entry has different ownership from the repo checkout', async () => {
    const options = fixture();
    const targetPath = join(options.workspacePath, 'fe');
    const cachePath = join(targetPath, '.pnpm-store');
    mkdirSync(join(cachePath, 'v10'), { recursive: true });
    writeFileSync(join(targetPath, '.git'), 'gitdir: fixture');
    const repairOwnership = vi.fn(async () => undefined);
    const findOwnershipMismatch = vi.fn(async () => ({
      path: join(cachePath, 'v10'),
      uid: 0,
      gid: 0,
    }));

    await repairWorkspaceBindMounts(options, { repairOwnership, findOwnershipMismatch });

    const owner = await import('node:fs/promises').then(fs => fs.lstat(targetPath));
    expect(repairOwnership).toHaveBeenCalledWith(cachePath, owner.uid, owner.gid);
  });

  it('names the offending path and expected ownership when cache repair fails', async () => {
    const options = fixture();
    const targetPath = join(options.workspacePath, 'fe');
    const cachePath = join(targetPath, 'node_modules');
    const offendingPath = join(cachePath, 'root-owned-package');
    mkdirSync(offendingPath, { recursive: true });
    writeFileSync(join(targetPath, '.git'), 'gitdir: fixture');
    const repairOwnership = vi.fn(async () => { throw new Error('Docker unavailable'); });

    await expect(repairWorkspaceBindMounts(options, {
      repairOwnership,
      findOwnershipMismatch: async () => ({ path: offendingPath, uid: 0, gid: 0 }),
    })).rejects.toThrow(new RegExp(`Could not repair ownership at ${offendingPath}.*expects .*chown.*Docker unavailable`));
  });

  it('fails closed instead of deleting unregistered non-cache files', async () => {
    const options = fixture();
    const targetPath = join(options.workspacePath, 'fe');
    mkdirSync(targetPath, { recursive: true });
    writeFileSync(join(targetPath, 'keep.txt'), 'untracked work');
    const removeDirectory = vi.fn();
    const createRepoWorktree = vi.fn();

    await expect(repairWorkspaceBindMounts(options, { removeDirectory, createRepoWorktree }))
      .rejects.toThrow(/contains keep\.txt/);

    expect(removeDirectory).not.toHaveBeenCalled();
    expect(createRepoWorktree).not.toHaveBeenCalled();
  });
});
