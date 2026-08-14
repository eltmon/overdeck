import { describe, expect, it, vi } from 'vitest';
import { verifyAndMergeSlot } from '../../../../src/lib/agents/slot-merge.js';
import type { WorkspaceRepoRoot } from '../../../../src/lib/project-repos.js';
import type { XBriefItem } from '../../../../src/lib/xbrief/types.js';

function item(overrides: Partial<XBriefItem['metadata']> = {}): XBriefItem {
  return {
    id: 'workspace-abc',
    title: 'Item',
    status: 'pending',
    metadata: {
      verify_commands: ['npm test'],
      expected_outputs: ['tests pass'],
      ...overrides,
    },
  };
}

function monorepoRoot(slotWorkspace: string): WorkspaceRepoRoot[] {
  return [{
    repoKey: 'overdeck',
    dir: slotWorkspace,
    sourceBranch: 'feature/pan-1762',
    targetBranch: 'main',
    isPolyrepo: false,
  }];
}

function polyrepoRoot(repoKey: string, workspace: string): WorkspaceRepoRoot {
  return {
    repoKey,
    dir: `${workspace}/${repoKey}`,
    sourceBranch: 'feature/min-888',
    targetBranch: 'main',
    isPolyrepo: true,
  };
}

describe('verifyAndMergeSlot', () => {
  it('does not merge when verify_commands fail in the slot worktree', async () => {
    const run = vi.fn(async (command: string) => {
      if (command === 'npm test') {
        throw Object.assign(new Error('failed'), { stdout: '', stderr: 'red' });
      }
      return { stdout: '', stderr: '' };
    });

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1762', featureWorkspace: '/repo/workspaces/feature-pan-1762' },
      1,
      item(),
      { deps: { run, resolveRepoRoots: (_id, ws) => monorepoRoot(ws) } },
    );

    expect(result).toMatchObject({ verified: false, merged: false, conflicts: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('npm test', '/repo/workspaces/feature-pan-1762-slot-1');
  });

  it('merges the slot branch into the feature workspace after green verify_commands', async () => {
    const run = vi.fn(async (command: string) => ({
      stdout: command.startsWith('git rev-list --count') ? '1' : 'ok',
      stderr: '',
    }));

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1762', featureWorkspace: '/repo/workspaces/feature-pan-1762' },
      2,
      item(),
      { deps: { run, resolveRepoRoots: (_id, ws) => monorepoRoot(ws) } },
    );

    expect(result).toMatchObject({ verified: true, merged: true, conflicts: false });
    expect(run).toHaveBeenNthCalledWith(1, 'npm test', '/repo/workspaces/feature-pan-1762-slot-2');
    expect(run).toHaveBeenNthCalledWith(
      2,
      'git rev-list --count "feature/pan-1762".."feature/pan-1762-slot-2"',
      '/repo/workspaces/feature-pan-1762-slot-2',
    );
    expect(run).toHaveBeenNthCalledWith(
      3,
      'git merge --no-ff "feature/pan-1762-slot-2"',
      '/repo/workspaces/feature-pan-1762',
    );
    expect(result.evidence.commandOutputs).toEqual([{ command: 'npm test', stdout: 'ok', stderr: '' }]);
  });

  it('aborts the parent workspace merge before reporting slot branch conflicts', async () => {
    const run = vi.fn(async (command: string) => {
      if (command.startsWith('git merge --no-ff')) {
        throw Object.assign(new Error('conflict'), { stdout: 'CONFLICT', stderr: '' });
      }
      return { stdout: command.startsWith('git rev-list --count') ? '1' : 'ok', stderr: '' };
    });

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1762', featureWorkspace: '/repo/workspaces/feature-pan-1762' },
      3,
      item(),
      { deps: { run, resolveRepoRoots: (_id, ws) => monorepoRoot(ws) } },
    );

    expect(result).toMatchObject({ verified: true, merged: false, conflicts: true });
    expect(result.failure).toContain('did not merge cleanly');
    expect(run).toHaveBeenNthCalledWith(
      4,
      'git merge --abort',
      '/repo/workspaces/feature-pan-1762',
    );
  });

  it('refuses to verify when the item is missing expected_outputs', async () => {
    const run = vi.fn(async () => ({ stdout: 'ok', stderr: '' }));

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1762', featureWorkspace: '/repo/workspaces/feature-pan-1762' },
      1,
      item({ expected_outputs: [] }),
      { deps: { run, resolveRepoRoots: (_id, ws) => monorepoRoot(ws) } },
    );

    expect(result).toMatchObject({ verified: false, merged: false, conflicts: false });
    expect(result.failure).toContain('expected_outputs');
    expect(run).not.toHaveBeenCalled();
  });

  // PAN-3691: sequential reuse of one slot branch — the earlier item already
  // merged, so base..slot is zero. The merge must NOT be reported as merged.
  it('refuses to report merged when a reused slot branch has no unmerged changes', async () => {
    const run = vi.fn(async (command: string) => ({
      stdout: command.startsWith('git rev-list --count') ? '0' : 'ok',
      stderr: '',
    }));

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1762', featureWorkspace: '/repo/workspaces/feature-pan-1762' },
      2,
      item(),
      { deps: { run, resolveRepoRoots: (_id, ws) => monorepoRoot(ws) } },
    );

    expect(result).toMatchObject({ verified: true, merged: false, conflicts: false });
    expect(result.failure).toContain('no unmerged current-item changes');
    expect(run).not.toHaveBeenCalledWith(expect.stringContaining('git merge --no-ff'), expect.anything());
  });

  // PAN-3691 live repro (MIN-888 slot 2): the outer wrapper branch is ahead
  // from setup commits but every nested repo has zero current-item commits.
  // The wrapper is not among the resolved roots, so nothing can satisfy the
  // gate and the slot must not report merged.
  it('refuses to report merged for a fresh polyrepo slot whose nested repos have zero current-item commits', async () => {
    const slotWorkspace = '/repo/workspaces/feature-min-888-slot-2';
    const run = vi.fn(async (command: string) => ({
      stdout: command.startsWith('git rev-list --count') ? '0' : 'ok',
      stderr: '',
    }));

    const result = await verifyAndMergeSlot(
      { issueId: 'MIN-888', featureWorkspace: '/repo/workspaces/feature-min-888' },
      2,
      item(),
      { deps: { run, resolveRepoRoots: () => [polyrepoRoot('api', slotWorkspace), polyrepoRoot('fe', slotWorkspace)] } },
    );

    expect(result).toMatchObject({ verified: true, merged: false, conflicts: false });
    expect(result.failure).toContain('no unmerged current-item changes');
    expect(run).not.toHaveBeenCalledWith(expect.stringContaining('git merge --no-ff'), expect.anything());
  });

  it('merges each nested polyrepo slot branch with work into its base feature checkout', async () => {
    const featureWorkspace = '/repo/workspaces/feature-min-888';
    const slotWorkspace = `${featureWorkspace}-slot-4`;
    const run = vi.fn(async (command: string, cwd: string) => ({
      stdout: command.startsWith('git rev-list --count')
        ? (cwd.endsWith('/api') ? '2' : '0')
        : 'ok',
      stderr: '',
    }));
    const resolveRepoRoots = vi.fn((_issueId: string, workspace: string) =>
      [polyrepoRoot('api', workspace), polyrepoRoot('fe', workspace)]);

    const result = await verifyAndMergeSlot(
      { issueId: 'MIN-888', featureWorkspace },
      4,
      item(),
      { deps: { run, resolveRepoRoots } },
    );

    expect(result).toMatchObject({ verified: true, merged: true, conflicts: false });
    expect(run).toHaveBeenCalledWith(
      'git merge --no-ff "feature/min-888-slot-4"',
      `${featureWorkspace}/api`,
    );
    // The fe repo had no slot work — nothing to integrate there.
    expect(run).not.toHaveBeenCalledWith(
      'git merge --no-ff "feature/min-888-slot-4"',
      `${featureWorkspace}/fe`,
    );
    expect(result.evidence.repoMergeOutputs).toEqual([{ repoKey: 'api', stdout: 'ok', stderr: '' }]);
  });

  it('aborts a conflicting nested polyrepo merge inside the owning base checkout', async () => {
    const featureWorkspace = '/repo/workspaces/feature-min-888';
    const slotWorkspace = `${featureWorkspace}-slot-4`;
    const run = vi.fn(async (command: string, cwd: string) => {
      if (command.startsWith('git merge --no-ff')) {
        throw Object.assign(new Error('conflict'), { stdout: 'CONFLICT', stderr: '' });
      }
      return {
        stdout: command.startsWith('git rev-list --count')
          ? (cwd.endsWith('/api') ? '2' : '0')
          : 'ok',
        stderr: '',
      };
    });
    const resolveRepoRoots = vi.fn((_issueId: string, workspace: string) =>
      [polyrepoRoot('api', workspace), polyrepoRoot('fe', workspace)]);

    const result = await verifyAndMergeSlot(
      { issueId: 'MIN-888', featureWorkspace },
      4,
      item(),
      { deps: { run, resolveRepoRoots } },
    );

    expect(result).toMatchObject({ verified: true, merged: false, conflicts: true });
    expect(result.failure).toContain('did not merge cleanly into api');
    expect(run).toHaveBeenCalledWith('git merge --abort', `${featureWorkspace}/api`);
  });
});
