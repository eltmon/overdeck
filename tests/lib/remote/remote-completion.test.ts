import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { rmSync } from 'fs';

const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');
  return {
    home: mkdtempSync(join(tmpdir(), 'remote-completion-test-')),
    fly: {
      getStatus: vi.fn(),
      ssh: vi.fn(),
      stopVm: vi.fn(),
      deleteVm: vi.fn(),
      copyFromVm: vi.fn(),
      syncClaudeCredentials: vi.fn(),
    },
    states: new Map<string, any>(),
    saveRemoteAgentState: vi.fn(),
    getRemoteAgentOutput: vi.fn(),
    sendToRemoteAgent: vi.fn(),
    killRemoteAgent: vi.fn(),
    exec: vi.fn(),
    requestReviewThroughRoute: vi.fn(),
    copiesRun: [] as string[],
    deleteWorkspaceMetadata: vi.fn(),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => mocks.home, default: { ...actual, homedir: () => mocks.home } };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mocks.exec };
});

vi.mock('../../../src/lib/config.js', () => ({
  loadConfigSync: () => ({ remote: { provider: 'fly' } }),
}));

vi.mock('../../../src/lib/remote/index.js', () => ({
  createFlyProviderFromConfig: () => mocks.fly,
}));

vi.mock('../../../src/lib/remote/remote-agents.js', () => ({
  loadRemoteAgentState: (agentId: string) => mocks.states.get(agentId) ?? null,
  saveRemoteAgentState: mocks.saveRemoteAgentState,
  listActiveRemoteAgentStates: () => [...mocks.states.values()].filter(
    (state) => state.status === 'running' || state.status === 'starting',
  ),
  getRemoteAgentOutput: mocks.getRemoteAgentOutput,
  sendToRemoteAgent: mocks.sendToRemoteAgent,
  killRemoteAgent: mocks.killRemoteAgent,
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: () => null,
  extractTeamPrefix: () => 'PAN',
  findProjectByTeam: () => ({ path: mocks.home }),
}));

vi.mock('../../../src/lib/workspace-manager.js', () => ({ createWorkspace: vi.fn() }));
vi.mock('../../../src/lib/workspace-manager/setup-marker.js', () => ({ workspaceNeedsSetup: () => false }));
vi.mock('../../../src/lib/review-artifacts.js', () => ({
  createReviewArtifactsForIssue: vi.fn().mockResolvedValue({ mergeSet: undefined }),
}));
vi.mock('../../../src/lib/agents.js', () => ({
  getAgentState: () => null,
  saveAgentStateSync: vi.fn(),
}));
vi.mock('../../../src/lib/remote/workspace-metadata.js', () => ({
  deleteWorkspaceMetadata: mocks.deleteWorkspaceMetadata,
}));
vi.mock('../../../src/lib/cloister/review-request-route.js', () => ({
  requestReviewThroughRoute: mocks.requestReviewThroughRoute,
}));

import { reapCompletedRemoteAgents } from '../../../src/lib/remote/remote-completion.js';

const remoteState = (issueId: string, status: 'running' | 'starting' = 'running') => ({
  id: `agent-${issueId.toLowerCase()}`,
  issueId,
  vmName: `vm-${issueId.toLowerCase()}`,
  model: 'claude-fable-5',
  status,
  startedAt: '2026-11-01T00:00:00.000Z',
  location: 'remote' as const,
  startedBy: 'test',
});

/** Route each exec by command: has-session and the sentinel get scripted answers, the rest succeed. */
function scriptExec(answers: { session?: string; sentinel?: string; exitCode?: number }) {
  mocks.fly.ssh.mockImplementation((_vm: string, command: string) => {
    if (answers.exitCode !== undefined) {
      return Effect.succeed({ stdout: '', stderr: 'exec failed', exitCode: answers.exitCode });
    }
    if (command.includes('has-session')) {
      return Effect.succeed({ stdout: `${answers.session ?? 'exists'}\n`, stderr: '', exitCode: 0 });
    }
    if (command.includes('REMOTE_DONE')) {
      return Effect.succeed({ stdout: `${answers.sentinel ?? 'absent'}\n`, stderr: '', exitCode: 0 });
    }
    return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 });
  });
}

function hasSessionCalls(): number {
  return mocks.fly.ssh.mock.calls.filter(([, command]) => String(command).includes('has-session')).length;
}

describe('reapCompletedRemoteAgents classification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.states.clear();
    mocks.fly.getStatus.mockReset().mockReturnValue(Effect.succeed('running'));
    mocks.fly.ssh.mockReset();
    mocks.fly.stopVm.mockReset().mockReturnValue(Effect.succeed(undefined));
    mocks.fly.deleteVm.mockReset().mockReturnValue(Effect.succeed(undefined));
    // copyFromVm returns an Effect; copiesRun counts only copies that actually ran.
    mocks.copiesRun.length = 0;
    mocks.fly.copyFromVm.mockReset().mockImplementation((_vm: string, remotePath: string) =>
      Effect.sync(() => { mocks.copiesRun.push(remotePath); }));
    mocks.saveRemoteAgentState.mockReset();
    mocks.getRemoteAgentOutput.mockReset().mockResolvedValue('');
    mocks.sendToRemoteAgent.mockReset();
    mocks.killRemoteAgent.mockReset().mockResolvedValue(undefined);
    mocks.deleteWorkspaceMetadata.mockReset();
    mocks.requestReviewThroughRoute.mockReset().mockResolvedValue({ requested: true });
    // `git ls-remote` finds the feature branch on origin.
    mocks.exec.mockReset().mockImplementation((cmd: string, _opts: unknown, cb: (err: Error | null, out: unknown) => void) => {
      cb(null, { stdout: cmd.includes('ls-remote') ? 'abc123\trefs/heads/feature/pan-0\n' : '', stderr: '' });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    rmSync(mocks.home, { recursive: true, force: true });
  });

  it('returns indeterminate and touches nothing when every exec on a running machine fails', async () => {
    mocks.states.set('agent-pan-1', remoteState('PAN-1'));
    scriptExec({ exitCode: 1 });

    const pending = reapCompletedRemoteAgents();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const results = await pending;

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('indeterminate');
    expect(hasSessionCalls()).toBe(3);
    expect(mocks.fly.stopVm).not.toHaveBeenCalled();
    expect(mocks.saveRemoteAgentState).not.toHaveBeenCalled();
  });

  it('returns indeterminate without any exec when Fly reports the machine state as unknown', async () => {
    mocks.states.set('agent-pan-2', remoteState('PAN-2'));
    mocks.fly.getStatus.mockReturnValue(Effect.succeed('unknown'));
    scriptExec({});

    const results = await reapCompletedRemoteAgents();

    expect(results[0].status).toBe('indeterminate');
    expect(results[0].details.join('\n')).toContain('unknown');
    expect(mocks.fly.ssh).not.toHaveBeenCalled();
    expect(mocks.fly.stopVm).not.toHaveBeenCalled();
    expect(mocks.saveRemoteAgentState).not.toHaveBeenCalled();
  });

  it('reports still-running when the session exists and the sentinel is absent', async () => {
    mocks.states.set('agent-pan-3', remoteState('PAN-3'));
    scriptExec({ session: 'exists', sentinel: 'absent' });

    const results = await reapCompletedRemoteAgents();

    expect(results[0].status).toBe('still-running');
    expect(mocks.fly.stopVm).not.toHaveBeenCalled();
    expect(mocks.saveRemoteAgentState).not.toHaveBeenCalled();
  });

  it('takes the crash path when the session is gone, the sentinel is absent and the pane is empty', async () => {
    mocks.states.set('agent-pan-4', remoteState('PAN-4'));
    scriptExec({ session: 'not-found', sentinel: 'absent' });

    const results = await reapCompletedRemoteAgents();

    expect(results[0].status).toBe('error');
    expect(hasSessionCalls()).toBe(1);
    expect(mocks.fly.stopVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveRemoteAgentState).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('treats a stopped machine as a crash without probing the session', async () => {
    mocks.states.set('agent-pan-5', remoteState('PAN-5'));
    mocks.fly.getStatus.mockReturnValue(Effect.succeed('stopped'));
    scriptExec({});

    const results = await reapCompletedRemoteAgents();

    expect(results[0].status).toBe('error');
    expect(results[0].details).toContain('Fly reports vm-pan-5 stopped — treating as crash, not completion');
    expect(hasSessionCalls()).toBe(0);
    expect(mocks.saveRemoteAgentState).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('skips starting agents when no issue is given', async () => {
    mocks.states.set('agent-pan-6', remoteState('PAN-6', 'starting'));
    mocks.states.set('agent-pan-7', remoteState('PAN-7', 'running'));
    scriptExec({ session: 'exists', sentinel: 'absent' });

    const results = await reapCompletedRemoteAgents();

    expect(results.map((result) => result.agentId)).toEqual(['agent-pan-7']);
  });

  it('requests review with source remote-reap after deleting the remote workspace metadata', async () => {
    mocks.states.set('agent-pan-8', remoteState('PAN-8'));
    scriptExec({ session: 'exists', sentinel: 'present' });

    const results = await reapCompletedRemoteAgents();

    expect(results[0].status).toBe('handed-off');
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledTimes(1);
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledWith('PAN-8', {
      source: 'remote-reap',
      message: expect.any(String),
    });
    expect(mocks.requestReviewThroughRoute.mock.invocationCallOrder[0])
      .toBeGreaterThan(mocks.deleteWorkspaceMetadata.mock.invocationCallOrder[0]);
    expect(results[0].details).toContain('Requested review through the dashboard review route');
  });

  it('runs the continue.json and session JSONL copies instead of only building them', async () => {
    mocks.states.set('agent-pan-10', remoteState('PAN-10'));
    mocks.fly.ssh.mockImplementation((_vm: string, command: string) => {
      if (command.includes('has-session')) return Effect.succeed({ stdout: 'exists\n', stderr: '', exitCode: 0 });
      if (command.includes('REMOTE_DONE')) return Effect.succeed({ stdout: 'present\n', stderr: '', exitCode: 0 });
      if (command.includes('.jsonl')) {
        return Effect.succeed({ stdout: '/root/.claude/projects/-workspace/s1.jsonl\n', stderr: '', exitCode: 0 });
      }
      return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 });
    });

    const results = await reapCompletedRemoteAgents();

    expect(results[0].status).toBe('handed-off');
    expect(mocks.copiesRun).toEqual([
      '/workspace/.pan/continue.json',
      '/root/.claude/projects/-workspace/s1.jsonl',
    ]);
    expect(results[0].details).toContain('Copied 1/1 session JSONL(s) to remote-sessions/');
  });

  it('still reports handed-off when the review route cannot be reached', async () => {
    mocks.states.set('agent-pan-9', remoteState('PAN-9'));
    scriptExec({ session: 'exists', sentinel: 'present' });
    mocks.requestReviewThroughRoute.mockResolvedValue({
      requested: false,
      reason: 'dashboard unreachable (ECONNREFUSED)',
    });

    const results = await reapCompletedRemoteAgents();

    expect(results[0].status).toBe('handed-off');
    expect(results[0].details.some((detail) => detail.includes('pan review request'))).toBe(true);
  });
});
