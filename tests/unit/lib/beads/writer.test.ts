import { describe, expect, it, vi } from 'vitest';

import { runMutationBatch } from '../../../../src/lib/beads/writer.js';

function harness(failOn?: string) {
  const calls: string[] = [];
  const execute = vi.fn(async (args: readonly string[]) => {
    const command = args.join(' ');
    calls.push(command);
    if (command === failOn) throw new Error(command.includes('push') ? 'non-fast-forward rejected' : 'operation failed');
    if (command === 'vc status') return 'Branch: main\nCommit: abcdef1234567890abcdef1234567890abcdef12\n';
    if (command.includes('remote show')) return JSON.stringify({ head: '1234567890123456789012345678901234567890' });
    return '';
  });
  const exportSnapshot = vi.fn(async () => { calls.push('export-snapshot'); });
  const withLock = vi.fn(async (_caller, fn) => { calls.push('lock'); return fn(); });
  return { calls, execute, exportSnapshot, withLock };
}

describe('runMutationBatch', () => {
  it('locks, pulls, performs multiple operations, commits, exports, and pushes once', async () => {
    const h = harness();
    const result = await runMutationBatch(
      { project: { workspacePath: '/tmp/project' }, reason: 'close planned beads' },
      async (bd) => {
        await bd.mutate(['close', 'one']);
        await bd.mutate(['close', 'two']);
        return 2;
      },
      h,
    );
    expect(result).toMatchObject({ ok: true, value: 2 });
    expect(h.withLock).toHaveBeenCalledOnce();
    expect(h.calls).toEqual([
      'lock',
      'bootstrap --yes --json',
      'dolt pull',
      'close one --dolt-auto-commit batch',
      'close two --dolt-auto-commit batch',
      'dolt commit -m close planned beads',
      'export-snapshot',
      'dolt push',
      'vc status',
    ]);
  });

  it('preserves a failed working set for recovery and never commits or pushes it', async () => {
    const h = harness('update two --dolt-auto-commit batch');
    const result = await runMutationBatch(
      { project: { workspacePath: '/tmp/project' }, reason: 'update planned beads' },
      async (bd) => {
        await bd.mutate(['update', 'one']);
        await bd.mutate(['update', 'two']);
      },
      h,
    );
    expect(result).toMatchObject({ ok: false, needsOperatorRecovery: true });
    expect(h.calls).not.toContain('dolt push');
    expect(h.calls.some((call) => call.startsWith('dolt commit'))).toBe(false);
  });

  it('returns a typed conflict when push is rejected and never force-pushes', async () => {
    const h = harness('dolt push');
    const result = await runMutationBatch(
      { project: { workspacePath: '/tmp/project' }, reason: 'close one' },
      (bd) => bd.mutate(['close', 'one']),
      h,
    );
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(h.calls.join('\n')).not.toContain('--force');
  });
});
