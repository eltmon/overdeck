import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots = vi.hoisted(() => ({ value: [] as Array<{ repoKey: string; dir: string; sourceBranch: string; targetBranch: string; isPolyrepo: boolean }> }));
vi.mock('../../project-repos.js', () => ({ resolveWorkspaceRepoRootsSync: () => roots.value }));

import { ensureRegisteredSlotWorktree } from '../registered-slot-spawn.js';

const run = promisify(execFile);
const tempPaths: string[] = [];

afterEach(async () => {
  roots.value = [];
  await Promise.all(tempPaths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('ensureRegisteredSlotWorktree', () => {
  it('creates isolated nested worktrees for a polyrepo slot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-slot-polyrepo-'));
    tempPaths.push(root);
    const baseWorkspace = join(root, 'workspaces', 'feature-min-888');
    const repo = join(baseWorkspace, 'api');
    await mkdir(repo, { recursive: true });
    await run('git', ['init', '-q'], { cwd: repo });
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await run('git', ['config', 'user.name', 'Test'], { cwd: repo });
    await run('git', ['commit', '--allow-empty', '-qm', 'base'], { cwd: repo });
    await run('git', ['checkout', '-qb', 'feature/min-888'], { cwd: repo });
    roots.value = [{ repoKey: 'api', dir: repo, sourceBranch: 'feature/min-888', targetBranch: 'main', isPolyrepo: true }];
    const slot = {
      agentId: 'agent-min-888-slot-4', branch: 'feature/min-888-slot-4',
      workspace: `${baseWorkspace}-slot-4`, slotIndex: 4, slotItemId: 'api-work',
    };

    await ensureRegisteredSlotWorktree('MIN-888', baseWorkspace, slot);

    expect(existsSync(join(slot.workspace, 'api', '.git'))).toBe(true);
    expect((await run('git', ['branch', '--show-current'], { cwd: join(slot.workspace, 'api') })).stdout.trim())
      .toBe('feature/min-888-slot-4');
  });

  it('rejects an incomplete stale polyrepo slot directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-slot-stale-'));
    tempPaths.push(root);
    const baseWorkspace = join(root, 'workspaces', 'feature-min-888');
    const repo = join(baseWorkspace, 'api');
    await mkdir(repo, { recursive: true });
    roots.value = [{ repoKey: 'api', dir: repo, sourceBranch: 'feature/min-888', targetBranch: 'main', isPolyrepo: true }];
    const slot = {
      agentId: 'agent-min-888-slot-4', branch: 'feature/min-888-slot-4',
      workspace: `${baseWorkspace}-slot-4`, slotIndex: 4, slotItemId: 'api-work',
    };
    await mkdir(slot.workspace, { recursive: true });

    await expect(ensureRegisteredSlotWorktree('MIN-888', baseWorkspace, slot)).rejects.toThrow('incomplete');
  });

  it('rejects nested checkouts on the shared feature branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-slot-shared-'));
    tempPaths.push(root);
    const baseWorkspace = join(root, 'workspaces', 'feature-min-888');
    const slotWorkspace = `${baseWorkspace}-slot-4`;
    const repo = join(slotWorkspace, 'api');
    await mkdir(repo, { recursive: true });
    await run('git', ['init', '-q'], { cwd: repo });
    await run('git', ['checkout', '-qb', 'feature/min-888'], { cwd: repo });
    roots.value = [{ repoKey: 'api', dir: join(baseWorkspace, 'api'), sourceBranch: 'feature/min-888', targetBranch: 'main', isPolyrepo: true }];
    const slot = {
      agentId: 'agent-min-888-slot-4', branch: 'feature/min-888-slot-4',
      workspace: slotWorkspace, slotIndex: 4, slotItemId: 'api-work',
    };

    await expect(ensureRegisteredSlotWorktree('MIN-888', baseWorkspace, slot)).rejects.toThrow('incomplete');
  });
});
