import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMock, spawn: vi.fn(() => ({ unref: vi.fn(), pid: 1234 })) };
});

vi.mock('../specialists.js', () => ({
  // PAN-1048 R1: spawnEphemeralSpecialist is gone; merge-agent now spawns
  // the ship role via spawnRun. The mock keeps only the still-used helpers.
  getTmuxSessionName: vi.fn(() => 'merge-session'),
  isRunning: vi.fn(async () => true),
  REVIEWER_ROLES: ['security', 'correctness', 'performance', 'requirements'],
}));
vi.mock('../review-agent.js', () => ({ killAllReviewerSessions: vi.fn(async () => ({ killed: [] })) }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn(), emitActivityTts: vi.fn(), emitDashboardLifecycle: vi.fn() }));
vi.mock('../../tmux.js', () => ({ capturePaneAsync: vi.fn(async () => ''), listSessionNamesAsync: vi.fn(async () => []), sendKeysAsync: vi.fn(async () => {}), sessionExists: vi.fn(() => false), sessionExistsAsync: vi.fn(async () => false), killSession: vi.fn() }));
vi.mock('../../projects.js', () => ({ resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/workspace' })), loadProjectsConfig: vi.fn(() => ({ projects: {} })) }));
vi.mock('../../agents.js', () => ({
  spawnRun: vi.fn(async () => ({ id: 'agent-pan-1-ship' })),
  getAgentState: vi.fn(() => null),
}));
vi.mock('../validation.js', () => ({
  runMergeValidation: vi.fn(async () => ({ valid: true, skipped: true })),
  autoRevertMerge: vi.fn(async () => true),
  runQualityGates: vi.fn(async () => []),
}));
vi.mock('../../git-utils.js', () => ({ cleanupStaleLocks: vi.fn(async () => ({ found: [], removed: [], errors: [] })) }));
vi.mock('../prompts.js', () => ({ renderPrompt: vi.fn(() => 'merge prompt') }));
vi.mock('../../git/operations.js', () => ({ gitPush: vi.fn(), gitForcePush: vi.fn(), MainDivergedError: class MainDivergedError extends Error {} }));
vi.mock('../../review-status.js', () => ({ markWorkspaceStuck: vi.fn(), setReviewStatus: vi.fn() }));
vi.mock('../../git-activity.js', () => ({ appendGitOperation: vi.fn() }));
vi.mock('../../stashes.js', () => ({
  buildStashMessage: vi.fn(() => 'pre-merge:PAN-1:2026-04-27T14:15:16Z'),
  createNamedStash: vi.fn(async () => 'abc123def456abc123def456abc123def456abcd'),
  dropStash: vi.fn(async () => {}),
  popStash: vi.fn(async () => {}),
  listStashes: vi.fn(async () => []),
}));
vi.mock('../../tracker-utils.js', () => ({ resolveGitHubIssue: vi.fn(() => ({ isGitHub: false })) }));
vi.mock('../../paths.js', () => ({ PANOPTICON_HOME: '/tmp/pan', AGENTS_DIR: '/tmp/agents', PROJECT_PRDS_ACTIVE_SUBDIR: 'active', PROJECT_PRDS_PLANNED_SUBDIR: 'planned', PROJECT_PRDS_COMPLETED_SUBDIR: 'completed', PROJECT_DOCS_SUBDIR: 'docs', PROJECT_PRDS_SUBDIR: 'prds' }));
vi.mock('../../tldr-daemon.js', () => ({ getTldrDaemonService: vi.fn() }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, writeFile: vi.fn(async () => {}), rm: vi.fn(async () => {}) };
});

import { postMergeLifecycle, spawnMergeAgentForBranches } from '../merge-agent.js';
import { dropStash, listStashes } from '../../stashes.js';
import { spawnRun } from '../../agents.js';

describe('merge-agent ship role and stash lifecycle', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    }) as typeof setTimeout);
    let headReads = 0;
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd.startsWith('git ls-remote --heads origin feature/pan-1')) return callback(null, { stdout: 'abc123\trefs/heads/feature/pan-1\n', stderr: '' });
      if (cmd.startsWith('git fetch origin feature/pan-1 main')) return callback(null, { stdout: '', stderr: '' });
      if (cmd.includes('git merge-base --is-ancestor')) return callback(Object.assign(new Error('not ancestor'), { code: 1 }));
      if (cmd === 'git rev-parse HEAD') {
        headReads += 1;
        return callback(null, { stdout: headReads === 1 ? 'head-before\n' : 'head-after\n', stderr: '' });
      }
      if (cmd === 'git status --porcelain') return callback(null, { stdout: ' M file.ts\n', stderr: '' });
      if (cmd === 'git branch --show-current') return callback(null, { stdout: 'main\n', stderr: '' });
      if (cmd === 'git fetch origin main') return callback(null, { stdout: '', stderr: '' });
      if (cmd === 'git rev-parse origin/main') return callback(null, { stdout: 'head-after\n', stderr: '' });
      callback(null, { stdout: 'head-after\n', stderr: '' });
    });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  it('starts the ship role for branch preparation without merging or stashing', async () => {
    const result = await spawnMergeAgentForBranches('/tmp/workspace', 'feature/pan-1', 'main', 'PAN-1', { skipDoneReport: true });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('ship role started as agent-pan-1-ship');
    expect(spawnRun).toHaveBeenCalledWith('PAN-1', 'ship', expect.objectContaining({
      workspace: '/tmp/workspace/workspaces/feature-pan-1',
      prompt: expect.stringContaining('Prepare this already-reviewed branch for the dashboard\'s human Merge button'),
    }));
    const prompt = vi.mocked(spawnRun).mock.calls[0]?.[2]?.prompt as string;
    expect(prompt).toContain('pan admin specialists done ship PAN-1 --status passed');
    expect(prompt).toContain('Do NOT run gh pr merge');
    expect(dropStash).not.toHaveBeenCalled();
  });

  it('does not start the ship role when the source branch is missing on the remote', async () => {
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd.startsWith('git ls-remote --heads origin feature/pan-1')) return callback(null, { stdout: '', stderr: '' });
      callback(null, { stdout: '', stderr: '' });
    });

    const result = await spawnMergeAgentForBranches('/tmp/workspace', 'feature/pan-1', 'main', 'PAN-1', { skipDoneReport: true });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Branch feature/pan-1 is not pushed to remote');
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('drops lingering pre-merge stashes during post-merge lifecycle', async () => {
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd.includes('git rev-parse --verify')) return callback(null, { stdout: 'branch-sha\n', stderr: '' });
      if (cmd.includes('git merge-base --is-ancestor')) return callback(null, { stdout: '', stderr: '' });
      callback(null, { stdout: '', stderr: '' });
    });
    vi.mocked(listStashes).mockResolvedValueOnce([
      {
        ref: 'def456abc123def456abc123def456abc123def4',
        stackRef: 'stash@{1}',
        message: 'pre-merge:PAN-1:2026-04-27T14:15:16Z',
        kind: 'pre-merge',
        issueId: 'PAN-1',
        createdAt: new Date('2026-04-27T14:15:16Z'),
      },
      {
        ref: 'abc123def456abc123def456abc123def456abcd',
        stackRef: 'stash@{0}',
        message: 'salvageable:PAN-1:2026-04-27T14:15:16Z:user work',
        kind: 'salvageable',
        issueId: 'PAN-1',
        shortDescription: 'user work',
        createdAt: new Date('2026-04-27T14:15:16Z'),
      },
    ] as any);

    await postMergeLifecycle('PAN-1', '/tmp/workspace', 'feature/pan-1', { skipDeploy: true });

    expect(dropStash).toHaveBeenCalledWith('/tmp/workspace', 'def456abc123def456abc123def456abc123def4');
    expect(dropStash).not.toHaveBeenCalledWith('/tmp/workspace', 'abc123def456abc123def456abc123def456abcd');
  });
});
