import { describe, it, expect, vi } from 'vitest';
import { checkBranchMergeability, type ExecRunner } from '../../../../src/lib/cloister/conflict-gate.js';

function makeRunner(results: Array<{ stdout?: string; stderr?: string } | Error>): ExecRunner {
  return vi.fn(async () => {
    const next = results.shift();
    if (!next) return { stdout: '', stderr: '' };
    if (next instanceof Error) throw next;
    return { stdout: next.stdout ?? '', stderr: next.stderr ?? '' };
  });
}

function commandError(message: string, fields: { code?: number; stdout?: string; stderr?: string } = {}): Error {
  return Object.assign(new Error(message), fields);
}

describe('checkBranchMergeability', () => {
  it('returns clean when merge-tree reports a writable tree', async () => {
    const exec = makeRunner([{ stdout: '' }, { stdout: 'tree-hash\n' }]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('clean');

    expect(exec).toHaveBeenNthCalledWith(
      1,
      'git fetch origin main',
      expect.objectContaining({ cwd: '/workspace', timeout: 30_000 }),
    );
    expect(exec).toHaveBeenNthCalledWith(
      2,
      'git merge-tree --write-tree --name-only HEAD origin/main',
      expect.objectContaining({ cwd: '/workspace', timeout: 30_000 }),
    );
  });

  it('returns conflicts when merge-tree reports conflicts', async () => {
    const exec = makeRunner([
      { stdout: '' },
      commandError('merge-tree failed', {
        code: 1,
        stdout: 'CONFLICT (content): Merge conflict in src/lib/example.ts\n',
      }),
    ]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('conflicts');
  });

  it('returns unknown when fetch fails', async () => {
    const exec = makeRunner([commandError('network failed', { code: 128, stderr: 'fatal: unable to access origin' })]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('unknown');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns unknown when merge-tree fails for a non-conflict reason', async () => {
    const exec = makeRunner([
      { stdout: '' },
      commandError('old git', { code: 129, stderr: 'usage: git merge-tree [--write-tree]' }),
    ]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('unknown');
  });

  it('uses only fetch and merge-tree commands', async () => {
    const exec = makeRunner([{ stdout: '' }, { stdout: 'tree-hash\n' }]);

    await checkBranchMergeability('/workspace', 'main', { exec });

    const commands = vi.mocked(exec).mock.calls.map(([command]) => command);
    expect(commands).toEqual([
      'git fetch origin main',
      'git merge-tree --write-tree --name-only HEAD origin/main',
    ]);
    expect(commands.join('\n')).not.toContain('git merge ');
  });
});
