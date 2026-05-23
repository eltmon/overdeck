import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execMock = vi.hoisted(() => vi.fn());
const setAgentPausedMock = vi.hoisted(() => vi.fn(() => true));
const setReviewStatusMock = vi.hoisted(() => vi.fn());
const resolveGitHubIssueMock = vi.hoisted(() => vi.fn(() => ({ isGitHub: false })));
const tmuxMocks = vi.hoisted(() => ({
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  killSession: vi.fn(async () => {}),
  listSessionNames: vi.fn(async () => [] as string[]),
  sessionExists: vi.fn(() => false),
  sessionExistsSync: vi.fn(() => false),
}));
const closeIssueMock = vi.hoisted(() => vi.fn(async () => []));
const transitionVBriefOnMainMock = vi.hoisted(() => vi.fn(async () => ({})));
const teardownWorkspaceMock = vi.hoisted(() => vi.fn(async () => []));
const movePrdMock = vi.hoisted(() => vi.fn(async () => ({ success: true, skipped: false, details: [] })));
const pruneCheckpointRefsForAgentsMock = vi.hoisted(() => vi.fn(async () => 0));

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
vi.mock('../review-agent.js', async () => {
  const { Effect } = await import('effect');
  return { killAllReviewerSessions: vi.fn(() => Effect.succeed({ killed: [] })) };
});
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn(), emitActivityEntrySync: vi.fn(), emitActivityTts: vi.fn(), emitActivityTtsSync: vi.fn(), emitDashboardLifecycle: vi.fn() }));
vi.mock('../../tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    capturePane: vi.fn(() => Effect.succeed('')),
    listSessionNames: () => Effect.promise(() => tmuxMocks.listSessionNames()),
    sendKeysProgram: vi.fn(() => Effect.void),
    sessionExists: tmuxMocks.sessionExists,
    sessionExistsSync: tmuxMocks.sessionExists,
    sessionExists: (name: string) => Effect.sync(() => tmuxMocks.sessionExists(name)),
    sessionExistsSync: (name: string) => Effect.sync(() => tmuxMocks.sessionExists(name)),
    killSession: tmuxMocks.killSession,
    killSessionSync: tmuxMocks.killSession,
    killSession: (name: string) => Effect.promise(() => tmuxMocks.killSession(name)),
    killSessionSync: (name: string) => Effect.promise(() => tmuxMocks.killSession(name)),
  };
});
vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/workspace' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/workspace' })),
  loadProjectsConfig: vi.fn(() => ({ projects: {} })),
  loadProjectsConfigSync: vi.fn(() => ({ projects: {} })),
}));
vi.mock('../../agents.js', async () => {
  const { Effect } = await import('effect');
  return {
    spawnRun: vi.fn(async () => ({ id: 'agent-pan-1-ship' })),
    getAgentState: vi.fn(() => Effect.succeed(null)),
    getAgentStateSync: vi.fn(() => Effect.succeed(null)),
    setAgentPaused: (...args: unknown[]) => Effect.sync(() => setAgentPausedMock(...args)),
    setAgentPausedProgram: (...args: unknown[]) => Effect.sync(() => setAgentPausedMock(...args)),
  };
});
vi.mock('../validation.js', () => ({
  runMergeValidation: vi.fn(async () => ({ valid: true, skipped: true })),
  autoRevertMerge: vi.fn(async () => true),
  runQualityGates: vi.fn(async () => []),
}));
vi.mock('../../git-utils.js', async () => {
  const { Effect } = await import('effect');
  return { cleanupStaleLocks: vi.fn(() => Effect.succeed({ found: [], removed: [], errors: [] })) };
});
vi.mock('../prompts.js', () => ({ renderPrompt: vi.fn(() => 'merge prompt') }));
vi.mock('../../git/operations.js', () => ({ gitPush: vi.fn(), gitForcePush: vi.fn(), MainDivergedError: class MainDivergedError extends Error {} }));
vi.mock('../../review-status.js', () => ({ markWorkspaceStuck: vi.fn(), setReviewStatus: setReviewStatusMock, setReviewStatusSync: setReviewStatusMock }));
vi.mock('../../git-activity.js', () => ({ appendGitOperation: vi.fn(), appendGitOperationSync: vi.fn() }));
vi.mock('../../stashes.js', async () => {
  const { Effect } = await import('effect');
  const effectMock = (initial?: unknown) => {
    const wrap = (value: unknown) => value && typeof value === 'object' && 'pipe' in value
      ? value
      : Effect.succeed(value);
    const fn: any = vi.fn(() => wrap(typeof initial === 'function' ? (initial as () => unknown)() : initial));
    fn.mockResolvedValue = (value: unknown) => fn.mockReturnValue(Effect.succeed(value));
    fn.mockResolvedValueOnce = (value: unknown) => fn.mockReturnValueOnce(Effect.succeed(value));
    fn.mockRejectedValue = (error: unknown) => fn.mockReturnValue(Effect.fail(error));
    fn.mockRejectedValueOnce = (error: unknown) => fn.mockReturnValueOnce(Effect.fail(error));
    return fn;
  };
  return {
    buildStashMessage: vi.fn(() => 'pre-merge:PAN-1:2026-04-27T14:15:16Z'),
    createNamedStash: effectMock('abc123def456abc123def456abc123def456abcd'),
    dropStash: effectMock(undefined),
    popStash: effectMock(undefined),
    listStashes: effectMock([]),
  };
});
vi.mock('../../tracker-utils.js', () => ({
  resolveGitHubIssue: resolveGitHubIssueMock,
  resolveGitHubIssueSync: resolveGitHubIssueMock,
  resolveTrackerType: vi.fn((issueId: string) => resolveGitHubIssueMock(issueId).isGitHub ? 'github' : 'linear'),
  resolveTrackerTypeSync: vi.fn((issueId: string) => resolveGitHubIssueMock(issueId).isGitHub ? 'github' : 'linear'),
}));
vi.mock('../../lifecycle/close-issue.js', () => ({ closeIssue: closeIssueMock }));
vi.mock('../../vbrief/lifecycle-io.js', () => ({ transitionVBriefOnMain: transitionVBriefOnMainMock }));
vi.mock('../../lifecycle/teardown-workspace.js', () => ({ teardownWorkspace: teardownWorkspaceMock }));
vi.mock('../../lifecycle/archive-planning.js', () => ({
  findWorkspacePath: vi.fn(() => undefined),
  movePrd: movePrdMock,
}));
vi.mock('../../checkpoint/checkpoint-manager.js', () => ({ pruneCheckpointRefsForAgents: pruneCheckpointRefsForAgentsMock }));
vi.mock('../../paths.js', () => ({ PANOPTICON_HOME: '/tmp/pan', AGENTS_DIR: '/tmp/agents', PROJECT_PRDS_ACTIVE_SUBDIR: 'active', PROJECT_PRDS_PLANNED_SUBDIR: 'planned', PROJECT_PRDS_COMPLETED_SUBDIR: 'completed', PROJECT_DOCS_SUBDIR: 'docs', PROJECT_PRDS_SUBDIR: 'prds', getPanopticonHome: vi.fn(() => '/tmp/pan') }));
vi.mock('../../tldr-daemon.js', () => ({ getTldrDaemonService: vi.fn(), getTldrDaemonServiceSync: vi.fn() }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, writeFile: vi.fn(async () => {}), rm: vi.fn(async () => {}) };
});

import { postMergeLifecycle, resetPostMergeState, spawnMergeAgentForBranches } from '../merge-agent.js';
import { dropStash, listStashes } from '../../stashes.js';
import { spawnRun } from '../../agents.js';
import { AGENTS_DIR } from '../../paths.js';
import { findSpecByIssue as findSpecByIssueProgram, writeSpecForIssue as writeSpecForIssueProgram } from '../../pan-dir/specs.js';
import { Effect } from 'effect';

// PAN-1249: pan-dir/specs functions return Effect; bridge to Promise for tests.
const findSpecByIssue = (projectRoot: string, issueId: string) =>
  Effect.runPromise(findSpecByIssueProgram(projectRoot, issueId) as Effect.Effect<any, any, never>);
const writeSpecForIssue = (projectRoot: string, doc: any, status: any, filename?: string) =>
  Effect.runPromise(writeSpecForIssueProgram(projectRoot, doc, status, filename) as Effect.Effect<any, any, never>);

describe('merge-agent ship role and stash lifecycle', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPostMergeState('PAN-1');
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: false });
    tmuxMocks.sessionExists.mockReturnValue(false);
    tmuxMocks.listSessionNames.mockResolvedValue([]);
    setAgentPausedMock.mockReturnValue(true);
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
    expect(prompt).toContain('curl -s -X POST');
    expect(prompt).toContain('/api/review/PAN-1/status');
    expect(prompt).toContain('"readyForMerge":true');
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
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli', number: 1 });
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

  it('blocks post-merge completion when verifying_on_main transition fails', async () => {
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli', number: 1 });
    tmuxMocks.sessionExists.mockReturnValue(true);
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd.includes('git rev-parse --verify')) return callback(null, { stdout: 'branch-sha\n', stderr: '' });
      if (cmd.includes('git merge-base --is-ancestor')) return callback(null, { stdout: '', stderr: '' });
      if (cmd.includes('gh issue edit') && cmd.includes('--add-label') && cmd.includes('verifying-on-main')) {
        return callback(new Error('label update failed'), { stdout: '', stderr: 'label update failed' });
      }
      callback(null, { stdout: '', stderr: '' });
    });

    await expect(postMergeLifecycle('PAN-1', '/tmp/workspace', 'feature/pan-1', { skipDeploy: true })).rejects.toThrow('label update failed');

    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-1', {
      mergeStatus: 'failed',
      readyForMerge: false,
      mergeNotes: expect.stringContaining('Post-merge verifying_on_main transition failed'),
    });
    expect(setAgentPausedMock).not.toHaveBeenCalled();
    expect(tmuxMocks.killSession).not.toHaveBeenCalled();
    expect(tmuxMocks.killSession).not.toHaveBeenCalled();
  });

  it('performs a non-destructive verify-on-main handoff after merge', async () => {
    const fixtureRoot = join(tmpdir(), `pan-post-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const projectPath = join(fixtureRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-1');
    const agentStateDir = join(AGENTS_DIR, 'agent-pan-1');
    const planningStateDir = join(AGENTS_DIR, 'planning-pan-1');

    try {
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(agentStateDir, { recursive: true });
      mkdirSync(planningStateDir, { recursive: true });
      await writeSpecForIssue(projectPath, {
        vBRIEFInfo: { version: '0.5', created: '2026-05-18T00:00:00Z' },
        plan: {
          id: 'PAN-1',
          title: 'Verify on main fixture',
          status: 'running',
          sequence: 1,
          created: '2026-05-18T00:00:00Z',
          items: [],
          edges: [],
        },
      } as any, 'active');

      resolveGitHubIssueMock.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli', number: 1 });
      tmuxMocks.sessionExists.mockReturnValue(true);
      tmuxMocks.listSessionNames.mockResolvedValue([
        'agent-pan-1-test',
        'agent-pan-1-ship',
        'agent-pan-1-review-synthesis',
        'specialist-panopticon-pan-1-review-security',
        'unrelated-session',
      ]);
      execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
        const callback = (typeof _opts === 'function' ? _opts : cb)!;
        if (cmd.includes('git rev-parse --verify')) return callback(null, { stdout: 'branch-sha\n', stderr: '' });
        if (cmd.includes('git merge-base --is-ancestor')) return callback(null, { stdout: '', stderr: '' });
        if (cmd.includes('gh issue view')) return callback(null, { stdout: 'OPEN\n', stderr: '' });
        callback(null, { stdout: '', stderr: '' });
      });

      await postMergeLifecycle('PAN-1', projectPath, 'feature/pan-1', { skipDeploy: true });

      expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-1', { mergeStatus: 'merged', readyForMerge: false });
      expect(setAgentPausedMock).toHaveBeenCalledWith('agent-pan-1', 'awaiting close-out (verify on main)', true);
      expect(setAgentPausedMock).toHaveBeenCalledWith('planning-pan-1', 'awaiting close-out (verify on main)', true);
      expect(tmuxMocks.sessionExists).toHaveBeenCalledWith('agent-pan-1');
      expect(tmuxMocks.sessionExists).toHaveBeenCalledWith('planning-pan-1');
      expect(tmuxMocks.killSession).toHaveBeenCalledWith('agent-pan-1');
      expect(tmuxMocks.killSession).toHaveBeenCalledWith('planning-pan-1');
      expect(tmuxMocks.killSession).toHaveBeenCalledWith('agent-pan-1-test');
      expect(tmuxMocks.killSession).toHaveBeenCalledWith('agent-pan-1-ship');
      expect(tmuxMocks.killSession).toHaveBeenCalledWith('agent-pan-1-review-synthesis');
      expect(tmuxMocks.killSession).toHaveBeenCalledWith('specialist-panopticon-pan-1-review-security');
      expect(tmuxMocks.killSession).not.toHaveBeenCalledWith('unrelated-session');

      const commands = execMock.mock.calls.map(([cmd]) => String(cmd));
      expect(commands.some(command => command.includes('--add-label') && command.includes('verifying-on-main'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label') && command.includes('in-review'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label') && command.includes('in-progress'))).toBe(true);
      expect(commands.some(command => command.includes('gh issue close'))).toBe(false);
      expect(commands.some(command => command.includes('--add-label') && command.includes('needs-close-out'))).toBe(false);
      expect(existsSync(workspacePath)).toBe(true);
      expect(existsSync(agentStateDir)).toBe(true);
      expect((await findSpecByIssue(projectPath, 'PAN-1'))?.status).toBe('active');
      expect((await findSpecByIssue(projectPath, 'PAN-1'))?.document.plan.status).toBe('active');
      expect(closeIssueMock).not.toHaveBeenCalled();
      expect(transitionVBriefOnMainMock).not.toHaveBeenCalled();
      expect(teardownWorkspaceMock).not.toHaveBeenCalled();
      expect(movePrdMock).not.toHaveBeenCalled();
      expect(pruneCheckpointRefsForAgentsMock).not.toHaveBeenCalled();
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(agentStateDir, { recursive: true, force: true });
      rmSync(planningStateDir, { recursive: true, force: true });
    }
  });
});
