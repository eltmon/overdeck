import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// resolveConversationGitInfo / resolveAgentGitInfo call:
//   - stat(<path>/.git/HEAD)          → presence + mtimeMs (cache invalidation key)
//   - execFile('git', [...], ...)      → branch + worktree info
//
// We mock both at the module-resolution layer so the enricher's caching,
// drift detection, and missing-workspace logic can be exercised without
// hitting the real filesystem.

const { mockStat, mockExecFile, mockReadFile } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockExecFile: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: mockStat,
  readFile: mockReadFile,
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
  resolveConversationGitInfo,
  resolveAgentGitInfo,
  _resetGitInfoCacheForTests,
} from '../git-info.js';

// Build the stat result a directory `.git` would produce. The enricher only
// checks isDirectory() / isFile() and mtimeMs, so a minimal stub suffices.
const dirGit = (mtimeMs: number) => ({
  mtimeMs,
  isDirectory: () => true,
  isFile: () => false,
});

const fileGit = (mtimeMs: number) => ({
  mtimeMs,
  isDirectory: () => false,
  isFile: () => true,
});

const headStat = (mtimeMs: number) => ({
  mtimeMs,
  isDirectory: () => false,
  isFile: () => true,
});

beforeEach(() => {
  _resetGitInfoCacheForTests();
  mockStat.mockReset();
  mockExecFile.mockReset();
  mockReadFile.mockReset();
});

describe('resolveConversationGitInfo', () => {
  it('returns null branch when path has no .git', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));
    const info = await resolveConversationGitInfo('/tmp/not-a-repo');
    expect(info).toEqual({ branch: null, isWorktree: false });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns branch + isWorktree=false for a primary checkout', async () => {
    // Two stats: one for .git (directory), one for .git/HEAD (file).
    mockStat
      .mockResolvedValueOnce(dirGit(0))
      .mockResolvedValueOnce(headStat(1_000));
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'main\n' })
      .mockResolvedValueOnce({ stdout: '/repo/.git\n/repo/.git\n' });

    const info = await resolveConversationGitInfo('/repo');
    expect(info).toEqual({ branch: 'main', isWorktree: false });
  });

  it('returns isWorktree=true when git-dir differs from git-common-dir', async () => {
    // Worktree: .git is a FILE containing `gitdir: ...`, HEAD lives under
    // the linked gitdir. So stat-file, readFile-pointer, stat-HEAD.
    mockStat
      .mockResolvedValueOnce(fileGit(0))
      .mockResolvedValueOnce(headStat(2_000));
    mockReadFile.mockResolvedValueOnce('gitdir: /repo/.git/worktrees/feature-pan-1234\n');
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'feature/pan-1234\n' })
      .mockResolvedValueOnce({ stdout: '/repo/.git\n/repo/.git/worktrees/feature-pan-1234\n' });

    const info = await resolveConversationGitInfo('/repo/workspaces/feature-pan-1234');
    expect(info).toEqual({ branch: 'feature/pan-1234', isWorktree: true });
  });

  it('serves cached value when HEAD mtime is unchanged', async () => {
    mockStat
      .mockResolvedValueOnce(dirGit(0))
      .mockResolvedValueOnce(headStat(3_000))
      .mockResolvedValueOnce(dirGit(0))
      .mockResolvedValueOnce(headStat(3_000));
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'main\n' })
      .mockResolvedValueOnce({ stdout: '/repo/.git\n/repo/.git\n' });

    await resolveConversationGitInfo('/repo');
    // Second call hits the cache — execFile must not be invoked again.
    await resolveConversationGitInfo('/repo');
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('refreshes when HEAD mtime changes (user ran git checkout under us)', async () => {
    // First call: HEAD mtime=4000, branch=main.
    mockStat
      .mockResolvedValueOnce(dirGit(0))
      .mockResolvedValueOnce(headStat(4_000));
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'main\n' })
      .mockResolvedValueOnce({ stdout: '/repo/.git\n/repo/.git\n' });
    const first = await resolveConversationGitInfo('/repo');
    expect(first.branch).toBe('main');

    // Second call: HEAD mtime advances to 5000 → cache must invalidate.
    mockStat
      .mockResolvedValueOnce(dirGit(0))
      .mockResolvedValueOnce(headStat(5_000));
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'feature/abc\n' })
      .mockResolvedValueOnce({ stdout: '/repo/.git\n/repo/.git\n' });
    const second = await resolveConversationGitInfo('/repo');
    expect(second.branch).toBe('feature/abc');
  });
});

describe('resolveAgentGitInfo', () => {
  it('flags workspaceMissing when the workspace has no .git', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));
    const info = await resolveAgentGitInfo('/tmp/gone', 'feature/pan-99');
    expect(info).toEqual({
      actualBranch: null,
      branchDrifted: false,
      workspaceMissing: true,
    });
  });

  it('reports no drift when actual matches expected (worktree case)', async () => {
    // The agent path stats once for its own check, then delegates to
    // resolveConversationGitInfo which stats again. The worktree pointer
    // file is read once.
    mockStat
      .mockResolvedValueOnce(fileGit(0))
      .mockResolvedValueOnce(headStat(10_000))
      .mockResolvedValueOnce(fileGit(0))
      .mockResolvedValueOnce(headStat(10_000));
    mockReadFile.mockResolvedValue('gitdir: /repo/.git/worktrees/feature-pan-99\n');
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'feature/pan-99\n' })
      .mockResolvedValueOnce({ stdout: '/repo/.git\n/repo/.git/worktrees/feature-pan-99\n' });
    const info = await resolveAgentGitInfo('/repo/workspaces/feature-pan-99', 'feature/pan-99');
    expect(info).toEqual({
      actualBranch: 'feature/pan-99',
      branchDrifted: false,
      workspaceMissing: false,
    });
  });

  it('reports drift when actual differs from expected', async () => {
    mockStat
      .mockResolvedValueOnce(fileGit(0))
      .mockResolvedValueOnce(headStat(11_000))
      .mockResolvedValueOnce(fileGit(0))
      .mockResolvedValueOnce(headStat(11_000));
    mockReadFile.mockResolvedValue('gitdir: /repo/.git/worktrees/feature-pan-99\n');
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'feature/pan-99-rebase\n' })
      .mockResolvedValueOnce({ stdout: '/repo/.git\n/repo/.git/worktrees/feature-pan-99\n' });
    const info = await resolveAgentGitInfo('/repo/workspaces/feature-pan-99', 'feature/pan-99');
    expect(info).toEqual({
      actualBranch: 'feature/pan-99-rebase',
      branchDrifted: true,
      workspaceMissing: false,
    });
  });

  it('flags workspaceMissing when stat succeeds but rev-parse fails (corrupt worktree)', async () => {
    mockStat
      .mockResolvedValueOnce(fileGit(0))
      .mockResolvedValueOnce(headStat(12_000))
      .mockResolvedValueOnce(fileGit(0))
      .mockResolvedValueOnce(headStat(12_000));
    mockReadFile.mockResolvedValue('gitdir: /repo/.git/worktrees/corrupt\n');
    mockExecFile
      .mockRejectedValueOnce(new Error('fatal: not a git repository'))
      .mockRejectedValueOnce(new Error('fatal: not a git repository'));
    const info = await resolveAgentGitInfo('/repo/workspaces/corrupt', 'feature/pan-99');
    expect(info.workspaceMissing).toBe(true);
    expect(info.actualBranch).toBeNull();
  });
});
