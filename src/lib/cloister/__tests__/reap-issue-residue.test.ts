import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  isBranchMerged: vi.fn(),
  killSession: vi.fn(() => Effect.void),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  agentsDir: '',
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: mocks.exec,
  };
});

vi.mock('../../close-out.js', () => ({
  isBranchMerged: mocks.isBranchMerged,
}));

vi.mock('../../tmux.js', () => ({
  killSession: mocks.killSession,
  listSessionNames: mocks.listSessionNames,
}));

vi.mock('../../paths.js', () => ({
  get AGENTS_DIR() {
    return mocks.agentsDir;
  },
}));

import { reapIssueResidue } from '../reap-issue-residue.js';

describe('reapIssueResidue', () => {
  let root: string;
  let projectPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-reap-residue-'));
    projectPath = join(root, 'project');
    mocks.agentsDir = join(root, 'agents');
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(mocks.agentsDir, { recursive: true });
    vi.clearAllMocks();
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.isBranchMerged.mockResolvedValue({ status: 'merged', message: 'merged' });
    mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      if (command.startsWith('git worktree remove')) {
        rmSync(join(projectPath, 'workspaces', 'feature-pan-2054'), { recursive: true, force: true });
      }
      cb?.(null, { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('removes merged workspace, branches, sessions, and agent state', async () => {
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-2054');
    const agentDir = join(mocks.agentsDir, 'agent-pan-2054');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mocks.listSessionNames.mockReturnValue(Effect.succeed([
      'agent-pan-2054',
      'test-pan-2054',
      'merge-pan-2054',
      'review-pan-2054-123-correctness',
      'agent-pan-9999',
    ]));

    const actions = await reapIssueResidue(projectPath, 'PAN-2054');

    expect(actions.length).toBeGreaterThan(0);
    expect(existsSync(workspacePath)).toBe(false);
    expect(existsSync(agentDir)).toBe(false);
    expect(mocks.exec.mock.calls.some((call) => String(call[0]) === 'git branch -D "feature/pan-2054"')).toBe(true);
    expect(mocks.exec.mock.calls.some((call) => String(call[0]) === 'git push origin --delete "feature/pan-2054"')).toBe(true);
    expect(mocks.killSession).toHaveBeenCalledTimes(4);
  });

  it('skips disk cleanup when the feature branch is unmerged', async () => {
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-2054');
    const agentDir = join(mocks.agentsDir, 'agent-pan-2054');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mocks.isBranchMerged.mockResolvedValue({ status: 'unmerged', message: 'not merged' });

    const actions = await reapIssueResidue(projectPath, 'PAN-2054');

    expect(actions.some((action) => action.includes('skipped') && action.includes('unmerged'))).toBe(true);
    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(agentDir)).toBe(true);
    expect(mocks.exec).not.toHaveBeenCalledWith(
      'git branch -D "feature/pan-2054"',
      expect.anything(),
      expect.anything(),
    );
  });

  it('is idempotent when residue is already gone', async () => {
    mocks.isBranchMerged.mockResolvedValue({ status: 'no-branch', message: 'gone' });
    mocks.exec.mockImplementation((_command: string, opts: unknown, callback?: (error: Error | null) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      cb?.(new Error('missing'));
      return { on: vi.fn() };
    });

    const first = await reapIssueResidue(projectPath, 'PAN-2054');
    const second = await reapIssueResidue(projectPath, 'PAN-2054');

    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  it('does not use execSync', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/cloister/reap-issue-residue.ts'), 'utf-8');
    expect(source).not.toContain('execSync');
  });
});
