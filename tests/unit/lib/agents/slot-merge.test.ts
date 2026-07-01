import { describe, expect, it, vi } from 'vitest';
import { verifyAndMergeSlot } from '../../../../src/lib/agents/slot-merge.js';
import type { VBriefItem } from '../../../../src/lib/vbrief/types.js';

function item(overrides: Partial<VBriefItem['metadata']> = {}): VBriefItem {
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
      { deps: { run } },
    );

    expect(result).toMatchObject({ verified: false, merged: false, conflicts: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('npm test', '/repo/workspaces/feature-pan-1762-slot-1');
  });

  it('merges the slot branch into the feature workspace after green verify_commands', async () => {
    const run = vi.fn(async () => ({ stdout: 'ok', stderr: '' }));

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1762', featureWorkspace: '/repo/workspaces/feature-pan-1762' },
      2,
      item(),
      { deps: { run } },
    );

    expect(result).toMatchObject({ verified: true, merged: true, conflicts: false });
    expect(run).toHaveBeenNthCalledWith(1, 'npm test', '/repo/workspaces/feature-pan-1762-slot-2');
    expect(run).toHaveBeenNthCalledWith(
      2,
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
      return { stdout: 'ok', stderr: '' };
    });

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1762', featureWorkspace: '/repo/workspaces/feature-pan-1762' },
      3,
      item(),
      { deps: { run } },
    );

    expect(result).toMatchObject({ verified: true, merged: false, conflicts: true });
    expect(result.failure).toContain('did not merge cleanly');
    expect(run).toHaveBeenNthCalledWith(
      3,
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
      { deps: { run } },
    );

    expect(result).toMatchObject({ verified: false, merged: false, conflicts: false });
    expect(result.failure).toContain('expected_outputs');
    expect(run).not.toHaveBeenCalled();
  });
});
