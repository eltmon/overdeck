import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LivenessVerdict } from '../../agents/liveness.js';

const execMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMock };
});

const DEAD: LivenessVerdict = { alive: false, reason: 'no-session' };
const isAliveMock = vi.hoisted(() => vi.fn());
vi.mock('../../agents/liveness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents/liveness.js')>();
  return { ...actual, isAlive: isAliveMock };
});
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

import { reapMergedStrikeWorkspaces } from '../strike-workspace-reaper.js';

// Two strike worktrees + one feature worktree + the primary main worktree.
const PORCELAIN = [
  'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
  'worktree /repo/workspaces/feature-pan-100-strike', 'HEAD bbb', 'branch refs/heads/strike/pan-100', '',
  'worktree /repo/workspaces/feature-pan-200-strike', 'HEAD ccc', 'branch refs/heads/strike/pan-200', '',
  'worktree /repo/workspaces/feature-pan-300', 'HEAD ddd', 'branch refs/heads/feature/pan-300', '',
].join('\n');

/**
 * How a branch relates to origin/main: `ancestor` (merge commit / fast-forward),
 * `squash` (not an ancestor, but merging it changes nothing), or `unmerged`.
 */
type Landing = 'ancestor' | 'squash' | 'unmerged';

const BASE_TREE = 'basetree0000';

function branchIn(cmd: string): string {
  return /(strike|feature)\/pan-\d+/.exec(cmd)?.[0] ?? '';
}

function wireExec(
  landingByBranch: Record<string, Landing>,
  reflogByBranch: Record<string, string> = {},
): string[] {
  const calls: string[] = [];
  execMock.mockImplementation((cmd: string, a2: unknown, a3?: unknown) => {
    const cb = (typeof a2 === 'function' ? a2 : a3) as (e: Error | null, r?: { stdout: string; stderr: string }) => void;
    calls.push(cmd);
    const landing = landingByBranch[branchIn(cmd)] ?? 'ancestor';
    let stdout = '';
    if (cmd.includes('worktree list --porcelain')) {
      stdout = PORCELAIN;
    } else if (cmd.includes('--walk-reflogs --count')) {
      stdout = reflogByBranch[branchIn(cmd)] ?? '2';
    } else if (cmd.includes('merge-base --is-ancestor')) {
      if (landing !== 'ancestor') return cb(new Error('not an ancestor'));
    } else if (cmd.includes('merge-tree --write-tree')) {
      stdout = landing === 'squash' ? `${BASE_TREE}\n` : 'othertree1111\n';
    } else if (cmd.includes('rev-parse')) {
      stdout = `${BASE_TREE}\n`;
    }
    cb(null, { stdout, stderr: '' });
  });
  return calls;
}

beforeEach(() => {
  execMock.mockReset();
  isAliveMock.mockReset().mockResolvedValue(DEAD);
});

describe('reapMergedStrikeWorkspaces (PAN-1882, PAN-3981)', () => {
  it('reaps merged strike worktrees (ancestor of main, no live agent) and deletes their branches', async () => {
    const calls = wireExec({ 'strike/pan-100': 'ancestor', 'strike/pan-200': 'ancestor' });
    const actions = await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(true);
    expect(calls.some(c => c.includes('branch -D') && c.includes('strike/pan-100'))).toBe(true);
    expect(actions).toHaveLength(2); // both pan-100 + pan-200 are merged
  });

  it('never reaps a strike with unmerged content', async () => {
    const calls = wireExec({ 'strike/pan-100': 'unmerged', 'strike/pan-200': 'ancestor' });
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(false);
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-200-strike'))).toBe(true);
  });

  it('never reaps a strike with a live agent (and skips before checking merge state)', async () => {
    isAliveMock.mockImplementation(async (id: string) => (id === 'strike-pan-100' ? { alive: true, paneAlive: true } : DEAD));
    const calls = wireExec({ 'strike/pan-100': 'ancestor', 'strike/pan-200': 'ancestor' });
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(false);
    expect(calls.some(c => c.includes('merge-base') && c.includes('strike/pan-100'))).toBe(false);
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-200-strike'))).toBe(true);
  });

  it('asks the terminal-backend liveness oracle, not tmux, and never reaps on an indeterminate answer (PAN-3981)', async () => {
    isAliveMock.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
    const calls = wireExec({ 'strike/pan-100': 'ancestor', 'strike/pan-200': 'ancestor' });
    await reapMergedStrikeWorkspaces('/repo');
    expect(isAliveMock).toHaveBeenCalledWith('strike-pan-100');
    expect(calls.some(c => c.includes('worktree remove'))).toBe(false);
  });

  it('reaps a squash-merged strike that stays commits-ahead of main (PAN-3981)', async () => {
    const calls = wireExec({ 'strike/pan-100': 'squash', 'strike/pan-200': 'unmerged' });
    const actions = await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(true);
    expect(calls.some(c => c.includes('branch -D') && c.includes('strike/pan-100'))).toBe(true);
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-200-strike'))).toBe(false);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('finishStrike');
  });

  it('never reaps a fresh strike branch that has not authored any commits (walk-reflogs <= 1)', async () => {
    const calls = wireExec({ 'strike/pan-100': 'ancestor' }, { 'strike/pan-100': '1' });
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(false);
    expect(calls.some(c => c.includes('branch -D') && c.includes('strike/pan-100'))).toBe(false);
  });

  it('still reaps a strike branch that authored commits and is now fully merged (walk-reflogs > 1)', async () => {
    const calls = wireExec({ 'strike/pan-100': 'ancestor' }, { 'strike/pan-100': '2' });
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('worktree remove') && c.includes('feature-pan-100-strike'))).toBe(true);
    expect(calls.some(c => c.includes('branch -D') && c.includes('strike/pan-100'))).toBe(true);
  });

  it('skips a worktree when the walk-reflogs command fails', async () => {
    execMock.mockImplementation((cmd: string, a2: unknown, a3?: unknown) => {
      const cb = (typeof a2 === 'function' ? a2 : a3) as (e: Error | null, r?: { stdout: string; stderr: string }) => void;
      if (cmd.includes('worktree list --porcelain')) {
        cb(null, { stdout: PORCELAIN, stderr: '' });
      } else if (cmd.includes('--walk-reflogs --count')) {
        cb(new Error('reflog unavailable'), undefined);
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    await reapMergedStrikeWorkspaces('/repo');
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('--walk-reflogs --count'),
      expect.anything(),
      expect.any(Function),
    );
    expect(execMock).not.toHaveBeenCalledWith(
      expect.stringContaining('worktree remove'),
      expect.anything(),
      expect.any(Function),
    );
  });

  it('never touches feature/* worktrees (only the active pipeline lives there)', async () => {
    const calls = wireExec({});
    await reapMergedStrikeWorkspaces('/repo');
    expect(calls.some(c => c.includes('feature-pan-300') && c.includes('worktree remove'))).toBe(false);
    expect(calls.some(c => c.includes('merge-base') && c.includes('feature/pan-300'))).toBe(false);
  });
});
