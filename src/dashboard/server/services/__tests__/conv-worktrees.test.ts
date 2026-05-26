import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks are hoisted so vi.mock can reach them at module-resolution time.
// See conversation-service.test.ts for the same pattern.
const { mockExecFile, mockMkdir, mockAccess } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockAccess: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  access: mockAccess,
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('node:util', () => ({
  promisify: () => async (
    _cmd: string,
    args: string[],
    _opts: unknown,
  ): Promise<{ stdout: string }> => {
    return mockExecFile(args);
  },
}));

import {
  listProjectWorktrees,
  createConvWorktree,
  WorktreeValidationError,
} from '../conv-worktrees.js';

beforeEach(() => {
  mockExecFile.mockReset();
  mockMkdir.mockReset();
  mockAccess.mockReset();
});

describe('listProjectWorktrees', () => {
  it('parses git worktree list --porcelain into classified entries', async () => {
    // Three entries: primary checkout, agent workspace, conv worktree.
    mockExecFile.mockResolvedValueOnce({
      stdout: [
        'worktree /home/me/proj',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /home/me/proj/workspaces/feature-pan-1450',
        'HEAD def456',
        'branch refs/heads/feature/pan-1450',
        '',
        'worktree /home/me/proj/worktrees/conv-20260526-7188',
        'HEAD ghi789',
        'branch refs/heads/feature/draft-experiment',
        '',
      ].join('\n'),
    });

    const result = await listProjectWorktrees('/home/me/proj');

    expect(result).toEqual([
      {
        path: '/home/me/proj',
        branch: 'main',
        isPrimary: true,
        isAgentWorkspace: false,
        isConvWorktree: false,
      },
      {
        path: '/home/me/proj/workspaces/feature-pan-1450',
        branch: 'feature/pan-1450',
        isPrimary: false,
        isAgentWorkspace: true,
        isConvWorktree: false,
      },
      {
        path: '/home/me/proj/worktrees/conv-20260526-7188',
        branch: 'feature/draft-experiment',
        isPrimary: false,
        isAgentWorkspace: false,
        isConvWorktree: true,
      },
    ]);
  });

  it('emits branch=null for detached HEAD worktrees', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: [
        'worktree /home/me/proj',
        'HEAD abc123',
        'detached',
        '',
      ].join('\n'),
    });

    const result = await listProjectWorktrees('/home/me/proj');
    expect(result).toHaveLength(1);
    expect(result[0].branch).toBeNull();
    expect(result[0].isPrimary).toBe(true);
  });

  it('skips bare repositories entirely', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: [
        'worktree /home/me/bare-proj',
        'HEAD abc123',
        'bare',
        '',
        'worktree /home/me/bare-proj/wt',
        'HEAD def456',
        'branch refs/heads/main',
        '',
      ].join('\n'),
    });

    const result = await listProjectWorktrees('/home/me/bare-proj');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/home/me/bare-proj/wt');
  });
});

describe('createConvWorktree', () => {
  function statSuccess(): Promise<void> {
    return Promise.resolve();
  }
  function statMissing(): Promise<void> {
    return Promise.reject(new Error('ENOENT'));
  }

  it('rejects relative projectRoot paths', async () => {
    await expect(
      createConvWorktree({ projectRoot: 'relative/path', slug: 'abc', branch: 'feature/x' }),
    ).rejects.toThrow(WorktreeValidationError);
  });

  it.each([
    ['../escape', 'slug with .. escape'],
    ['has spaces', 'slug with space'],
    ['has/slash', 'slug with slash'],
    ['has;semi', 'slug with shell metachar'],
  ])('rejects slug %s (%s)', async (slug) => {
    await expect(
      createConvWorktree({ projectRoot: '/home/me/proj', slug, branch: 'feature/x' }),
    ).rejects.toThrow(WorktreeValidationError);
  });

  it.each([
    ['has spaces', 'space'],
    ['has..dotdot', 'double-dot'],
    ['has;semi', 'shell metachar'],
    ['$(rm)', 'subshell metachar'],
  ])('rejects branch %s (%s)', async (branch) => {
    await expect(
      createConvWorktree({ projectRoot: '/home/me/proj', slug: 'abc', branch }),
    ).rejects.toThrow(WorktreeValidationError);
  });

  it('refuses to clobber an existing target path', async () => {
    mockAccess.mockImplementation(statSuccess); // path exists

    await expect(
      createConvWorktree({ projectRoot: '/home/me/proj', slug: 'mine', branch: 'feature/x' }),
    ).rejects.toThrow(/already exists/);
  });

  it('creates worktree against an existing branch (no -b flag)', async () => {
    mockAccess.mockImplementation(statMissing); // path does not exist
    mockMkdir.mockResolvedValue(undefined);
    mockExecFile
      .mockResolvedValueOnce({ stdout: '' }) // worktree prune
      .mockResolvedValueOnce({ stdout: 'feature/x\n' }) // for-each-ref → branch exists
      .mockResolvedValueOnce({ stdout: '' }); // worktree add

    const result = await createConvWorktree({
      projectRoot: '/home/me/proj',
      slug: 'abc',
      branch: 'feature/x',
    });

    expect(result).toEqual({
      path: '/home/me/proj/worktrees/conv-abc',
      branch: 'feature/x',
      createdBranch: false,
    });
    // Worktree add should have used the existing branch, not -b.
    const addCall = mockExecFile.mock.calls[2][0];
    expect(addCall).toContain('add');
    expect(addCall).toContain('/home/me/proj/worktrees/conv-abc');
    expect(addCall).toContain('feature/x');
    expect(addCall).not.toContain('-b');
  });

  it('creates a new branch from the resolved default when branch does not exist', async () => {
    mockAccess.mockImplementation(statMissing);
    mockMkdir.mockResolvedValue(undefined);
    mockExecFile
      .mockResolvedValueOnce({ stdout: '' }) // prune
      .mockResolvedValueOnce({ stdout: '' }) // for-each-ref → no match (branch does not exist)
      .mockResolvedValueOnce({ stdout: 'origin/main\n' }) // symbolic-ref → origin/main
      .mockResolvedValueOnce({ stdout: '' }); // worktree add -b ... main

    const result = await createConvWorktree({
      projectRoot: '/home/me/proj',
      slug: 'fresh',
      branch: 'feature/new-thing',
    });

    expect(result.createdBranch).toBe(true);
    const addCall = mockExecFile.mock.calls[3][0];
    expect(addCall).toContain('-b');
    expect(addCall).toContain('feature/new-thing');
    expect(addCall).toContain('main');
  });

  it('honors an explicit base branch when provided', async () => {
    mockAccess.mockImplementation(statMissing);
    mockMkdir.mockResolvedValue(undefined);
    mockExecFile
      .mockResolvedValueOnce({ stdout: '' }) // prune
      .mockResolvedValueOnce({ stdout: '' }) // for-each-ref → no match
      .mockResolvedValueOnce({ stdout: '' }); // worktree add -b ... develop (no symbolic-ref because base was given)

    await createConvWorktree({
      projectRoot: '/home/me/proj',
      slug: 'fresh',
      branch: 'feature/new',
      base: 'develop',
    });

    // We should not have called symbolic-ref — base was explicit.
    const calls = mockExecFile.mock.calls.map((c) => (c[0] as string[]).join(' '));
    expect(calls.some((c) => c.includes('symbolic-ref'))).toBe(false);
    expect(calls[calls.length - 1]).toContain('develop');
  });
});
