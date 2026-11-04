/**
 * PAN-4820 review finding 3: the merge train's sibling rebase and force-push
 * run inside withDeftInstallLifted, so a Deft sibling's skip-worktree files
 * do not abort the rebase and Deft's pre-push hook does not refuse the push.
 * Git and the lift are injected; the calls are recorded in order.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildRealReconcileDeps, type TrainIo } from '../merge-train-deps.js';

const HEAD = 'a'.repeat(40);
const REBASED = 'b'.repeat(40);

function world(options: { conflict?: boolean } = {}) {
  const calls: string[] = [];
  let rebased = false;
  const git: TrainIo['git'] = async (_cwd, args) => {
    const command = args.join(' ');
    if (command.startsWith('rebase')) calls.push(command);
    if (command.startsWith('push')) calls.push('push');
    switch (true) {
      case command === 'branch --show-current': return 'feature/pan-1\n';
      case command.startsWith('status'): return '';
      case command.startsWith('fetch'): return '';
      case command === 'rev-parse HEAD': return `${rebased ? REBASED : HEAD}\n`;
      case command === 'rev-parse refs/remotes/origin/feature/pan-1': return `${HEAD}\n`;
      case command === 'rev-list --count HEAD..origin/main': return '1\n';
      case command === 'rev-parse origin/main': return `${'c'.repeat(40)}\n`;
      case command.startsWith('merge-base'): return `${'d'.repeat(40)}\n`;
      case command === 'rebase origin/main':
        if (options.conflict) throw new Error('conflict');
        rebased = true;
        return '';
      default: return '';
    }
  };
  const lift = vi.fn(async <T>(_worktree: string, _ref: string, fn: () => Promise<T>): Promise<T> => {
    calls.push('lift:start');
    try {
      return await fn();
    } finally {
      calls.push('lift:end');
    }
  });
  const deps = buildRealReconcileDeps({
    git,
    workspacePathFor: () => '/ws/feature-pan-1',
    patchId: async () => 'patch',
    withDeftInstallLifted: lift as TrainIo['withDeftInstallLifted'],
  });
  return { calls, deps, lift };
}

describe('rebaseSibling with a Deft install (PAN-4820)', () => {
  it('rebases and force-pushes inside the lift', async () => {
    const { calls, deps, lift } = world();

    const result = await deps.rebaseSibling('PAN-1');

    expect(result.status).toBe('clean');
    expect(lift).toHaveBeenCalledWith('/ws/feature-pan-1', 'origin/main', expect.any(Function));
    expect(calls).toEqual(['lift:start', 'rebase origin/main', 'push', 'lift:end']);
  });

  it('aborts a conflicting rebase inside the lift and reports the conflict', async () => {
    const { calls, deps } = world({ conflict: true });

    expect(await deps.rebaseSibling('PAN-1')).toEqual({ status: 'conflict' });
    expect(calls).toEqual(['lift:start', 'rebase origin/main', 'rebase --abort', 'lift:end']);
  });
});
