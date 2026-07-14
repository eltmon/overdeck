import { describe, expect, it, vi } from 'vitest';

import {
  ensureAutomaticStateMigration,
  formatAutomaticStateMigrationBlock,
  type AutomaticStateMigrationDependencies,
} from '../state-auto-migrate.js';

const project = { name: 'Fixture', path: '/tmp/fixture' };

function dependencies(overrides: Partial<AutomaticStateMigrationDependencies> = {}): AutomaticStateMigrationDependencies {
  return {
    inspect: vi.fn(async () => ({ migrated: true, migrationInProgress: false, remoteTip: 'a'.repeat(40) })),
    ensureWorktree: vi.fn(async () => ({ status: 'healthy', path: '/tmp/state' })),
    migrate: vi.fn(async () => undefined),
    clearCache: vi.fn(),
    ...overrides,
  };
}

describe('automatic state migration coordinator', () => {
  it('materializes an already-migrated remote without running migration', async () => {
    const deps = dependencies();
    await expect(ensureAutomaticStateMigration('fixture-ready', project, deps)).resolves.toEqual({
      status: 'ready', projectKey: 'fixture-ready', worktree: 'healthy',
    });
    expect(deps.migrate).not.toHaveBeenCalled();
    expect(deps.ensureWorktree).toHaveBeenCalledWith(project, { projectKey: 'fixture-ready' });
  });

  it('migrates an unmarked project and verifies the remote marker before returning ready', async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ migrated: false, migrationInProgress: false, remoteTip: null })
      .mockResolvedValueOnce({ migrated: true, migrationInProgress: false, remoteTip: 'b'.repeat(40) });
    const deps = dependencies({ inspect });
    await expect(ensureAutomaticStateMigration('fixture-new', project, deps)).resolves.toMatchObject({ status: 'ready' });
    expect(deps.migrate).toHaveBeenCalledWith('fixture-new', project);
    expect(deps.clearCache).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent migration attempts', async () => {
    let release!: () => void;
    const migrate = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const inspect = vi.fn()
      .mockResolvedValueOnce({ migrated: false, migrationInProgress: false, remoteTip: null })
      .mockResolvedValue({ migrated: true, migrationInProgress: false, remoteTip: 'c'.repeat(40) });
    const deps = dependencies({ inspect, migrate });
    const first = ensureAutomaticStateMigration('fixture-concurrent', project, deps);
    const second = ensureAutomaticStateMigration('fixture-concurrent', project, deps);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(migrate).toHaveBeenCalledOnce());
    release();
    await expect(first).resolves.toMatchObject({ status: 'ready' });
  });

  it('returns a standalone blocked result instead of permitting legacy writes', async () => {
    const deps = dependencies({
      inspect: vi.fn(async () => ({ migrated: false, migrationInProgress: false, remoteTip: null })),
      migrate: vi.fn(async () => { throw new Error('remote origin is not configured'); }),
    });
    const result = await ensureAutomaticStateMigration('fixture-blocked', project, deps);
    expect(result).toEqual({ status: 'blocked', projectKey: 'fixture-blocked', reason: 'remote origin is not configured' });
    if (result.status === 'blocked') {
      expect(formatAutomaticStateMigrationBlock(result)).toContain('will not start pipeline work');
    }
    expect(deps.ensureWorktree).not.toHaveBeenCalled();
  });
});
