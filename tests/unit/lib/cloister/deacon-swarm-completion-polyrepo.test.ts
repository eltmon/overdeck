import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceRepoRoot } from '../../../../src/lib/project-repos.js';

const roots = vi.hoisted(() => ({ value: [] as WorkspaceRepoRoot[] }));
vi.mock('../../../../src/lib/project-repos.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/project-repos.js')>()),
  resolveWorkspaceRepoRootsSync: () => roots.value,
}));

import {
  defaultGetSlotBranchAheadCount,
  defaultIsSlotWorktreeClean,
} from '../../../../src/lib/cloister/deacon-swarm-completion.js';

const run = promisify(execFile);
const tempPaths: string[] = [];

afterEach(async () => {
  roots.value = [];
  await Promise.all(tempPaths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

/** Create a repo whose slot branch is `aheadCount` commits past feature/min-888. */
async function makeNestedRepo(parent: string, repoKey: string, aheadCount: number): Promise<string> {
  const dir = join(parent, repoKey);
  await run('git', ['init', '-q', '-b', 'feature/min-888', dir]);
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await run('git', ['commit', '--allow-empty', '-qm', 'base'], { cwd: dir });
  await run('git', ['checkout', '-qb', 'feature/min-888-slot-2'], { cwd: dir });
  for (let index = 0; index < aheadCount; index += 1) {
    await run('git', ['commit', '--allow-empty', '-qm', `slot work ${index}`], { cwd: dir });
  }
  return dir;
}

function polyRoot(repoKey: string, dir: string): WorkspaceRepoRoot {
  return { repoKey, dir, sourceBranch: 'feature/min-888', targetBranch: 'main', isPolyrepo: true };
}

describe('PAN-3691 polyrepo slot completion probes', () => {
  it('ignores outer-wrapper bookkeeping commits: zero nested current-item commits means zero ahead', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-3691-polyrepo-'));
    tempPaths.push(root);
    const workspacePath = join(root, 'workspaces', 'feature-min-888');
    const slotWorkspace = `${workspacePath}-slot-2`;

    // The wrapper repo IS ahead (workspace/infrastructure setup commit) —
    // the MIN-888 false-completion condition. It must not be consulted.
    const wrapper = join(slotWorkspace);
    await run('git', ['init', '-q', '-b', 'feature/min-888-slot-2', wrapper]);
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: wrapper });
    await run('git', ['config', 'user.name', 'Test'], { cwd: wrapper });
    await run('git', ['commit', '--allow-empty', '-qm', 'workspace setup'], { cwd: wrapper });

    const api = await makeNestedRepo(slotWorkspace, 'api', 0);
    const fe = await makeNestedRepo(slotWorkspace, 'fe', 0);
    roots.value = [polyRoot('api', api), polyRoot('fe', fe)];

    await expect(defaultGetSlotBranchAheadCount(workspacePath, 'MIN-888', 'feature/min-888-slot-2'))
      .resolves.toBe(0);
  });

  it('sums unmerged slot work across nested repos', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-3691-ahead-'));
    tempPaths.push(root);
    const workspacePath = join(root, 'workspaces', 'feature-min-888');
    const slotWorkspace = `${workspacePath}-slot-2`;

    const api = await makeNestedRepo(slotWorkspace, 'api', 2);
    const fe = await makeNestedRepo(slotWorkspace, 'fe', 0);
    roots.value = [polyRoot('api', api), polyRoot('fe', fe)];

    await expect(defaultGetSlotBranchAheadCount(workspacePath, 'MIN-888', 'feature/min-888-slot-2'))
      .resolves.toBe(2);
  });

  it('fails closed when the polyrepo roots are degraded', async () => {
    roots.value = [{
      repoKey: 'min-888',
      dir: '/nonexistent',
      sourceBranch: 'feature/min-888',
      targetBranch: 'main',
      isPolyrepo: false,
      degradedPolyrepo: true,
    }];

    await expect(defaultGetSlotBranchAheadCount('/nonexistent', 'MIN-888', 'feature/min-888-slot-2'))
      .resolves.toBe(0);
  });

  it('treats a dirty nested polyrepo checkout as not clean', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-3691-clean-'));
    tempPaths.push(root);
    const slotWorkspace = join(root, 'workspaces', 'feature-min-888-slot-2');

    const api = await makeNestedRepo(slotWorkspace, 'api', 0);
    const fe = await makeNestedRepo(slotWorkspace, 'fe', 0);
    roots.value = [polyRoot('api', api), polyRoot('fe', fe)];

    await expect(defaultIsSlotWorktreeClean(slotWorkspace)).resolves.toBe(true);

    // Real dirt (untracked code file) in any nested repo blocks inference.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(api, 'work.ts'), 'export {}\n');
    await expect(defaultIsSlotWorktreeClean(slotWorkspace)).resolves.toBe(false);
  });
});
