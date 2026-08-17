import { describe, expect, it } from 'vitest';
import { verifyAndMergeSlot } from '../slot-merge.js';
import type { XBriefItem } from '../../xbrief/types.js';

function makeItem(overrides: Partial<XBriefItem['metadata']> = {}): XBriefItem {
  return {
    id: 'item-1',
    title: 't',
    status: 'running',
    metadata: {
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes'],
      ...overrides,
    },
  };
}

/** Deterministic single-repo roots seam — one root at the slot workspace on the issue's feature branch. */
function monorepoRoots(_issueId: string, workspacePath: string) {
  return [{
    repoKey: 'pan-1',
    dir: workspacePath,
    sourceBranch: 'feature/pan-1',
    targetBranch: 'main',
    isPolyrepo: false,
  }];
}

describe('verifyAndMergeSlot', () => {
  it('runs verify commands in the slot workspace then merges the slot branch in the feature workspace', async () => {
    const calls: Array<{ command: string; cwd: string }> = [];
    const run = async (command: string, cwd: string) => {
      calls.push({ command, cwd });
      // PAN-3691: the slot branch must carry unmerged current-item work or the
      // merge is refused — model one ahead commit on the slot branch.
      if (command.startsWith('git rev-list --count')) return { stdout: '1', stderr: '' };
      return { stdout: 'ok', stderr: '' };
    };

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' },
      2,
      makeItem(),
      { deps: { run, resolveRepoRoots: monorepoRoots } },
    );

    expect(result.verified).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.conflicts).toBe(false);
    expect(calls).toEqual([
      { command: 'npm run typecheck', cwd: '/ws/feature-pan-1-slot-2' },
      { command: 'git rev-list --count "feature/pan-1".."feature/pan-1-slot-2"', cwd: '/ws/feature-pan-1-slot-2' },
      { command: 'git merge --no-ff "feature/pan-1-slot-2"', cwd: '/ws/feature-pan-1' },
    ]);
  });

  it('fails verification without merging when a verify command fails', async () => {
    const commands: string[] = [];
    const run = async (command: string) => {
      commands.push(command);
      throw Object.assign(new Error('boom'), { stdout: 'partial', stderr: 'boom' });
    };

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' },
      1,
      makeItem(),
      { deps: { run } },
    );

    expect(result.verified).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.failure).toContain('Verify command failed');
    expect(result.evidence.commandOutputs[0]).toEqual({ command: 'npm run typecheck', stdout: 'partial', stderr: 'boom' });
    expect(commands.some(c => c.startsWith('git merge'))).toBe(false);
  });

  it('reports conflicts and aborts when the merge does not apply cleanly', async () => {
    const commands: string[] = [];
    const run = async (command: string) => {
      commands.push(command);
      if (command.startsWith('git rev-list --count')) return { stdout: '1', stderr: '' };
      if (command.startsWith('git merge --no-ff')) {
        throw Object.assign(new Error('conflict'), { stdout: '', stderr: 'CONFLICT (content)' });
      }
      return { stdout: 'ok', stderr: '' };
    };

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' },
      1,
      makeItem(),
      { deps: { run, resolveRepoRoots: monorepoRoots } },
    );

    expect(result.verified).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.conflicts).toBe(true);
    expect(result.failure).toContain('did not merge cleanly');
    expect(commands).toContain('git merge --abort');
  });

  it('refuses to report merged when the slot branch has no unmerged current-item changes', async () => {
    const commands: string[] = [];
    const run = async (command: string) => {
      commands.push(command);
      // PAN-3691: a fresh slot whose agent died before committing (or a reused
      // slot branch whose earlier work already merged) counts zero ahead.
      if (command.startsWith('git rev-list --count')) return { stdout: '0', stderr: '' };
      return { stdout: 'ok', stderr: '' };
    };

    const result = await verifyAndMergeSlot(
      { issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' },
      1,
      makeItem(),
      { deps: { run, resolveRepoRoots: monorepoRoots } },
    );

    expect(result.verified).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.conflicts).toBe(false);
    expect(result.failure).toContain('no unmerged current-item changes');
    expect(commands.some(c => c.startsWith('git merge'))).toBe(false);
  });

  it('refuses items missing verify_commands or expected_outputs', async () => {
    const run = async () => ({ stdout: 'ok', stderr: '' });

    const noVerify = await verifyAndMergeSlot({ issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' }, 1, makeItem({ verify_commands: [] }), { deps: { run } });
    expect(noVerify.verified).toBe(false);
    expect(noVerify.failure).toContain('no verify_commands');

    const noOutputs = await verifyAndMergeSlot({ issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' }, 1, makeItem({ expected_outputs: [] }), { deps: { run } });
    expect(noOutputs.verified).toBe(false);
    expect(noOutputs.failure).toContain('no expected_outputs');
  });
});
