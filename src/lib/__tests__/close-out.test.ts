import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  clearReviewStatus: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  markRecordPipelineClosedOutSync: vi.fn(),
  stopWorkspaceDocker: vi.fn(() => Effect.void),
  teardownWorkspaceDockerByNamePromise: vi.fn(() =>
    Promise.resolve({ networkRemoved: true, steps: ['Stopped Docker stack'] }),
  ),
  findWorkspacePath: vi.fn(),
  listMailboxItems: vi.fn(async () => []),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: mocks.exec,
    execFile: mocks.execFile,
  };
});

vi.mock('../tmux.js', () => ({
  killSession: vi.fn(() => Effect.void),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  sessionExistsSync: vi.fn(() => false),
}));

vi.mock('../checkpoint/checkpoint-manager.js', () => ({
  pruneCheckpointRefsForAgents: vi.fn(() => Effect.void),
  pruneStaleCheckpointRefs: vi.fn(() => Effect.succeed(0)),
}));

vi.mock('../review-status.js', () => ({
  clearReviewStatus: mocks.clearReviewStatus,
  loadReviewStatuses: mocks.loadReviewStatuses,
}));

vi.mock('../pan-dir/records.js', () => ({
  markRecordPipelineClosedOutSync: mocks.markRecordPipelineClosedOutSync,
}));

vi.mock('../workspace-manager/docker.js', () => ({
  teardownWorkspaceDockerByNamePromise: mocks.teardownWorkspaceDockerByNamePromise,
}));

vi.mock('../workspace-manager.js', () => ({
  stopWorkspaceDocker: mocks.stopWorkspaceDocker,
}));

vi.mock('../lifecycle/archive-planning.js', () => ({
  findWorkspacePath: mocks.findWorkspacePath,
}));

vi.mock('../cloister/agent-mailbox.js', () => ({
  listMailboxItems: mocks.listMailboxItems,
}));

import { executeCloseOut } from '../close-out.js';

describe('executeCloseOut terminal journal marker (PAN-2054)', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'pan-close-out-'));
    vi.clearAllMocks();
    mocks.loadReviewStatuses.mockReturnValue({});
    mocks.exec.mockImplementation((command: string, _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (command.includes('git branch --list')) cb?.(null, { stdout: '', stderr: '' });
      else if (command.includes('git ls-remote')) cb?.(null, { stdout: '', stderr: '' });
      else cb?.(null, { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });
    mocks.execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback?.(null, '', '');
      return { on: vi.fn() };
    });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('marks the pipeline journal terminal before clearing review status', async () => {
    const result = await Effect.runPromise(executeCloseOut({
      issueId: 'PAN-2054',
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2054,
    }));

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.name === 'Mark pipeline terminal')?.status).toBe('passed');
    expect(mocks.markRecordPipelineClosedOutSync).toHaveBeenCalledWith(
      { name: 'inferred', path: projectPath },
      'PAN-2054',
    );
    expect(mocks.clearReviewStatus).toHaveBeenCalledWith('PAN-2054');
    expect(mocks.markRecordPipelineClosedOutSync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearReviewStatus.mock.invocationCallOrder[0],
    );
    const commands = mocks.exec.mock.calls.map((call) => String(call[0]));
    expect(commands).toContain(
      'gh issue edit 2054 --repo eltmon/overdeck --remove-label "merged" 2>/dev/null || true',
    );
    expect(commands).toContain(
      'gh issue edit 2054 --repo eltmon/overdeck --remove-label "ready" 2>/dev/null || true',
    );
  });

  it('records a skipped marker step without aborting close-out when the marker throws', async () => {
    mocks.markRecordPipelineClosedOutSync.mockImplementationOnce(() => {
      throw new Error('record write failed');
    });

    const result = await Effect.runPromise(executeCloseOut({
      issueId: 'PAN-2054',
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2054,
    }));

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.name === 'Mark pipeline terminal')).toMatchObject({
      status: 'skipped',
      message: 'Warning: record write failed',
    });
    expect(mocks.clearReviewStatus).toHaveBeenCalledWith('PAN-2054');
  });
});

describe('executeCloseOut workspace resolution (PAN-2510)', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'pan-close-out-'));
    vi.clearAllMocks();
    mocks.loadReviewStatuses.mockReturnValue({});
    mocks.stopWorkspaceDocker.mockReturnValue(Effect.void);
    mocks.teardownWorkspaceDockerByNamePromise.mockResolvedValue({
      networkRemoved: true,
      steps: ['Stopped Docker stack'],
    });
    mocks.exec.mockImplementation((command: string, _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      cb?.(null, { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });
    mocks.execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback?.(null, '', '');
      return { on: vi.fn() };
    });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('resolves the workspace path to workspaces/feature-<issue> and invokes Docker stop', async () => {
    const issueId = 'PAN-2510';
    const issueLower = issueId.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    mkdirSync(workspacePath, { recursive: true });

    const result = await Effect.runPromise(executeCloseOut({
      issueId,
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2510,
    }));

    expect(result.success).toBe(true);
    const cleanupStep = result.steps.find((step) => step.name === 'Clean up workspace');
    expect(cleanupStep?.status).toBe('passed');
    expect(mocks.teardownWorkspaceDockerByNamePromise).toHaveBeenCalledWith(issueLower);
  });

  it('still invokes name-based Docker teardown when no workspace exists on disk', async () => {
    const issueId = 'PAN-2510';
    mocks.exec.mockImplementation((command: string, _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (command.includes('git branch -D') || command.includes('git push origin --delete')) {
        cb?.(new Error('branch not found'), { stdout: '', stderr: '' });
      } else {
        cb?.(null, { stdout: '', stderr: '' });
      }
      return { on: vi.fn() };
    });

    const result = await Effect.runPromise(executeCloseOut({
      issueId,
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2510,
    }));

    expect(result.success).toBe(true);
    expect(mocks.teardownWorkspaceDockerByNamePromise).toHaveBeenCalledWith(issueId.toLowerCase());
    const dockerStep = result.steps.find((step) => step.name === 'Docker stack removed');
    expect(dockerStep?.status).toBe('passed');
  });

  it('comments pending mailbox items before removing the workspace', async () => {
    const issueId = 'PAN-2510';
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-2510');
    mkdirSync(workspacePath, { recursive: true });
    mocks.findWorkspacePath.mockReturnValue(workspacePath);
    mocks.listMailboxItems.mockResolvedValue([
      { issueId, role: 'work', source: 'review-agent', summary: 'Fix $(touch /tmp/pwned) and `whoami`', actionRequired: true, state: 'pending', createdAt: '2026-07-16T12:00:00Z', filePath: `${workspacePath}/.pan/feedback/001-review.md`, legacy: false, markdownBody: '' },
      { issueId, role: 'work', source: 'test-agent', summary: 'Fix tests', actionRequired: true, state: 'pending', createdAt: '2026-07-16T12:01:00Z', filePath: `${workspacePath}/.pan/feedback/002-test.md`, legacy: false, markdownBody: '' },
    ]);

    await Effect.runPromise(executeCloseOut({ issueId, projectPath, isGitHub: true, owner: 'eltmon', repo: 'overdeck', number: 2510 }));
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    const [file, args] = mocks.execFile.mock.calls[0] as [string, string[]];
    expect(file).toBe('gh');
    expect(args.slice(0, 6)).toEqual(['issue', 'comment', '2510', '--repo', 'eltmon/overdeck', '--body']);
    const body = args[6];
    expect(body).toContain('During close-out the system identified 2 undelivered message(s)');
    expect(body).toContain('Fix $(touch /tmp/pwned) and `whoami`');
    expect(body).toContain('treat them as likely stale');
    const removalCall = mocks.exec.mock.calls.findIndex(call => String(call[0]).startsWith('git worktree remove'));
    expect(removalCall).toBeGreaterThanOrEqual(0);
    expect(mocks.execFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exec.mock.invocationCallOrder[removalCall],
    );
  });

  it('records a warning but does not abort when network removal cannot be verified', async () => {
    const issueId = 'PAN-2510';
    mocks.teardownWorkspaceDockerByNamePromise.mockResolvedValue({
      networkRemoved: false,
      steps: ['compose down attempted', 'network still present'],
    });

    const result = await Effect.runPromise(executeCloseOut({
      issueId,
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2510,
    }));

    expect(result.success).toBe(true);
    const dockerStep = result.steps.find((step) => step.name === 'Docker stack removed');
    expect(dockerStep?.status).toBe('skipped');
    expect(dockerStep?.message).toContain('overdeck-feature-pan-2510_devnet');
  });

  it('runs Docker teardown before git worktree removal', async () => {
    const issueId = 'PAN-2510';
    const issueLower = issueId.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    mkdirSync(workspacePath, { recursive: true });
    mocks.findWorkspacePath.mockReturnValue(workspacePath);

    let teardownCallIndex = -1;
    let worktreeCallIndex = -1;
    mocks.teardownWorkspaceDockerByNamePromise.mockImplementation(async () => {
      teardownCallIndex = mocks.exec.mock.calls.length;
      return { networkRemoved: true, steps: [] };
    });
    mocks.exec.mockImplementation((command: string, _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (command.includes('git worktree remove')) {
        worktreeCallIndex = mocks.exec.mock.calls.length;
      }
      cb?.(null, { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });

    await Effect.runPromise(executeCloseOut({
      issueId,
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2510,
    }));

    expect(teardownCallIndex).toBeGreaterThanOrEqual(0);
    expect(worktreeCallIndex).toBeGreaterThan(teardownCallIndex);
  });

  it('resolves the workspace path through archive-planning findWorkspacePath', async () => {
    const issueId = 'PAN-2510';
    const issueLower = issueId.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    mkdirSync(workspacePath, { recursive: true });
    mocks.findWorkspacePath.mockReturnValue(workspacePath);

    const result = await Effect.runPromise(executeCloseOut({
      issueId,
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2510,
    }));

    expect(result.success).toBe(true);
    expect(mocks.findWorkspacePath).toHaveBeenCalledWith(projectPath, issueLower);
    expect(mocks.teardownWorkspaceDockerByNamePromise).toHaveBeenCalledWith(issueLower);
  });
});
