import { describe, expect, it, vi } from 'vitest';

import {
  decideDeaconBootGate,
  ensureAutomaticStateMigration,
  formatAutomaticStateMigrationBlock,
  type AutomaticStateMigrationDependencies,
  type AutomaticStateMigrationResult,
} from '../state-auto-migrate.js';

const ready = (projectKey: string): AutomaticStateMigrationResult =>
  ({ status: 'ready', projectKey, worktree: 'healthy' });
const blocked = (projectKey: string, reason: string): AutomaticStateMigrationResult =>
  ({ status: 'blocked', projectKey, reason });

const project = { name: 'Fixture', path: '/tmp/fixture' };

function dependencies(overrides: Partial<AutomaticStateMigrationDependencies> = {}): AutomaticStateMigrationDependencies {
  return {
    inspect: vi.fn(async () => ({ migrated: true, migrationInProgress: false, remoteTip: 'a'.repeat(40) })),
    ensureWorktree: vi.fn(async () => ({ status: 'healthy', path: '/tmp/state' })),
    migrate: vi.fn(async () => undefined),
    clearCache: vi.fn(),
    isGitWorkTree: vi.fn(async () => true),
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

  it('blocks a polyrepo container root that is not a git repository with a clear reason (PAN-2676)', async () => {
    const polyrepoProject = { name: 'Auricle', path: '/tmp/auricle', workspace: { type: 'polyrepo' as const } };
    const deps = dependencies({
      inspect: vi.fn(async () => ({ migrated: false, migrationInProgress: false, remoteTip: null })),
      isGitWorkTree: vi.fn(async () => false),
    });
    const result = await ensureAutomaticStateMigration('auricle', polyrepoProject, deps);
    expect(result).toMatchObject({ status: 'blocked', projectKey: 'auricle' });
    if (result.status === 'blocked') {
      expect(result.reason).toContain('polyrepo');
      expect(result.reason).not.toContain('Command failed');
    }
    expect(deps.migrate).not.toHaveBeenCalled();
  });

  it('blocks a non-git project path with a clear reason instead of a raw git error (PAN-2676)', async () => {
    const deps = dependencies({
      inspect: vi.fn(async () => ({ migrated: false, migrationInProgress: false, remoteTip: null })),
      isGitWorkTree: vi.fn(async () => false),
    });
    const result = await ensureAutomaticStateMigration('not-a-repo', project, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toContain('not a git repository');
      expect(result.reason).not.toContain('Command failed');
    }
    expect(deps.migrate).not.toHaveBeenCalled();
  });
});

describe('decideDeaconBootGate (PAN-2676)', () => {
  it('starts the Deacon when at least one project is usable, excluding blocked ones', () => {
    const gate = decideDeaconBootGate([
      ready('overdeck'),
      blocked('puzzdom', 'The canonical overdeck-state worktree is dirty: 1 uncommitted file'),
      ready('myn'),
    ]);
    expect(gate.startDeacon).toBe(true);
    expect(gate.usableProjects).toEqual(['overdeck', 'myn']);
    expect(gate.blockedProjects).toHaveLength(1);
    expect(gate.blockedProjects[0].projectKey).toBe('puzzdom');
    // Each blocked project carries its human-readable prerequisite text.
    expect(gate.blockedProjects[0].notice).toContain('State migration for puzzdom is blocked');
    expect(gate.blockedProjects[0].notice).toContain('will not start pipeline work');
  });

  it('refuses to start when every project is blocked', () => {
    const gate = decideDeaconBootGate([
      blocked('alpha', 'dirty state worktree'),
      blocked('beta', 'git status failed'),
    ]);
    expect(gate.startDeacon).toBe(false);
    expect(gate.usableProjects).toEqual([]);
    expect(gate.blockedProjects.map((b) => b.projectKey)).toEqual(['alpha', 'beta']);
  });

  it('starts on a fresh install with no registered projects', () => {
    const gate = decideDeaconBootGate([]);
    expect(gate.startDeacon).toBe(true);
    expect(gate.blockedProjects).toEqual([]);
    expect(gate.usableProjects).toEqual([]);
  });

  it('starts cleanly when all projects are usable', () => {
    const gate = decideDeaconBootGate([ready('overdeck'), ready('myn')]);
    expect(gate.startDeacon).toBe(true);
    expect(gate.blockedProjects).toEqual([]);
    expect(gate.usableProjects).toEqual(['overdeck', 'myn']);
  });
});
