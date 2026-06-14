import { describe, it, expect, vi, beforeEach } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMock };
});

const sessionExistsSyncMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../tmux.js', () => ({ sessionExistsSync: sessionExistsSyncMock }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntrySync: vi.fn() }));

import { reapMergedStrikeWorkspaces } from '../strike-workspace-reaper.js';

// Two strike worktrees + one feature worktree + the primary main worktree.
const PORCELAIN = [
  'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
  'worktree /repo/workspaces/feature-pan-100-strike', 'HEAD bbb', 'branch refs/heads/strike/pan-100', '',
  'worktree /repo/workspaces/feature-pan-200-strike', 'HEAD ccc', 'branch refs/heads/strike/pan-200', '',
  'worktree /repo/workspaces/feature-pan-300', 'HEAD ddd', 'branch refs/heads/feature/pan-300', '',
].join('\n');

function wireExec(aheadByBranch: Record<string, string>): string[] {
  const calls: string[] = [];
  execMock.mockImplementation((cmd: string, a2: unknown, a3?: unknown) => {
    const cb = (typeof a2 === 'function' ? a2 : a3) as (e: Error | null, r?: { stdout: string; stderr: string }) => void;
    calls.push(cmd);
    let stdout = '';
    if (cmd.includes('worktree list --porcelain')) {
      stdout = PORCELAIN;
    } else if (cmd.includes('rev-list --count')) {
      const branch = cmd.split('origin/main..')[1].trim();
      stdout = aheadByBranch[branch] ?? '0';
    }
    cb(null, { stdout, stderr: '' });
  });
  return calls;
}

beforeEach(() => {
  execMock.mockReset();
  sessionExistsSyncMock.mockReset().mockReturnValue(false);
});

describe('reapMergedStrikeWorkspaces (PAN-1882)', () => {
  it('reaps merged strike worktrees (0 ahead, no live session) and deletes their branches', async () => {
    const calls = wireExec({ 'strike/pan-100': '0', 'strike/pan-200': '0' });
    const actions = await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(true);
    expect(calls.some(c => c.includes('branch -D') && c.includes('strike/pan-100'))).toBe(true);
    expect(actions).toHaveLength(2); // both pan-100 + pan-200 are merged
  });

  it('never reaps a strike with unmerged commits (>0 ahead)', async () => {
    const calls = wireExec({ 'strike/pan-100': '3', 'strike/pan-200': '0' });
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(false);
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-200-strike'))).toBe(true);
  });

  it('never reaps a strike with a live session (and skips before checking merge state)', async () => {
    sessionExistsSyncMock.mockImplementation((s: string) => s === 'strike-pan-100');
    const calls = wireExec({ 'strike/pan-100': '0', 'strike/pan-200': '0' });
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(false);
    expect(calls.some(c => c.includes('rev-list') && c.includes('strike/pan-100'))).toBe(false);
  });

  it('never touches feature/* worktrees (only the active pipeline lives there)', async () => {
    const calls = wireExec({});
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('feature-pan-300') && c.includes('worktree remove'))).toBe(false);
    expect(calls.some(c => c.includes('rev-list') && c.includes('feature/pan-300'))).toBe(false);
  });
});
