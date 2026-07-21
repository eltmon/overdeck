import { describe, expect, it, vi } from 'vitest';
import { checkStateWorktrees } from '../doctor-state-worktree.js';

const project = { key: 'overdeck', config: { name: 'Overdeck', path: '/repo' } };

describe('checkStateWorktrees', () => {
  it('self-heals a missing completed-migration worktree', async () => {
    const ensure = vi.fn(async () => ({ status: 'created' as const, path: '/home/test/.overdeck/state/overdeck' }));

    await expect(checkStateWorktrees([project], ensure)).resolves.toEqual([{
      name: 'State Worktree: overdeck (Overdeck)',
      status: 'ok',
      message: 'Created overdeck-state worktree at /home/test/.overdeck/state/overdeck',
    }]);
    expect(ensure).toHaveBeenCalledWith(project.config, { projectKey: 'overdeck' });
  });

  it('surfaces dirty state without destructive repair', async () => {
    const ensure = vi.fn(async () => ({
      status: 'dirty' as const,
      path: '/home/test/.overdeck/state/overdeck',
      detail: 'state worktree has uncommitted changes; refusing destructive repair',
    }));

    const [check] = await checkStateWorktrees([project], ensure);

    expect(check).toMatchObject({ status: 'warn' });
    expect(check.message).toContain('refusing destructive repair');
  });
});
