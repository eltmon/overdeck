import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/agents.js', async () => {
  const { Effect } = await import('effect');
  const effectMock = (initial?: unknown) => {
    const wrap = (value: unknown) => {
      if (value && typeof value === 'object' && 'pipe' in value) return value;
      return Effect.succeed(value);
    };
    const fn: any = vi.fn(() => wrap(typeof initial === 'function' ? (initial as () => unknown)() : initial));
    fn.mockResolvedValue = (value: unknown) => fn.mockReturnValue(Effect.succeed(value));
    fn.mockRejectedValue = (error: unknown) => fn.mockReturnValue(Effect.fail(error));
    fn.mockResolvedValueOnce = (value: unknown) => fn.mockReturnValueOnce(Effect.succeed(value));
    fn.mockRejectedValueOnce = (error: unknown) => fn.mockReturnValueOnce(Effect.fail(error));
    const originalMockImplementation = fn.mockImplementation.bind(fn);
    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => originalMockImplementation((...args: unknown[]) => {
      const result = impl(...args);
      if (result && typeof result === 'object' && 'pipe' in result) return result;
      return Effect.promise(() => Promise.resolve(result));
    });
    return fn;
  };
  return {
  getAgentRuntimeState: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(() => null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn((agentId: string) => `/tmp/test-agents/${agentId}`),
  getAgentState: effectMock(null),
  getAgentStateSync: vi.fn(),
  getAgentStateProgram: effectMock(null),
  messageAgent: vi.fn(async () => undefined),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  resumeAgent: vi.fn(async () => ({ success: true })),
  recordAgentFailure: effectMock(null),
  recordAgentFailureProgram: effectMock(null),
  };
});

vi.mock('../../../lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatusSync: vi.fn(() => undefined),
  getReviewStatus: vi.fn(),
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../../lib/shadow-state.js', async () => {
  const { Effect } = await import('effect');
  const getShadowState: any = vi.fn(() => Effect.succeed(null));
  getShadowState.mockResolvedValue = (value: unknown) => getShadowState.mockReturnValue(Effect.succeed(value));
  getShadowState.mockResolvedValueOnce = (value: unknown) => getShadowState.mockReturnValueOnce(Effect.succeed(value));
  getShadowState.mockRejectedValue = (error: unknown) => getShadowState.mockReturnValue(Effect.fail(error));
  getShadowState.mockRejectedValueOnce = (error: unknown) => getShadowState.mockReturnValueOnce(Effect.fail(error));
  return { getShadowState };
});

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: vi.fn(async () => false),
}));

vi.mock('../../../lib/database/review-status-db.js', () => ({
  markWorkspaceStuck: vi.fn(),
}));

vi.mock('../../../lib/database/app-settings.js', () => ({
  isDeaconGloballyPaused: vi.fn(() => false),
}));

vi.mock('../agent-idle.js', () => ({
  isAgentIdleForNudge: vi.fn(() => false),
}));

vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, optsOrCb: unknown, maybeCb?: unknown) => {
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void;
    cb(null, { stdout: '○ workspace-nudge ● P2 pan-871: Continue work\n', stderr: '' });
  }),
  execFile: vi.fn(),
}));

vi.mock('../../../lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: vi.fn(() => '/tmp/workspace'),
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon-cli' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'panopticon-cli' })),
}));

vi.mock('../../../lib/persistent-logger.js', () => ({
  logDeaconEvent: vi.fn(),
  logDeaconEventSync: vi.fn(),
  logAgentLifecycle: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('../../../lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../specialists.js', () => ({
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn(async () => false),
  getAllProjectSpecialistStatuses: vi.fn(() => []),
}));

vi.mock('../../../lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  const effectMock = (initial?: unknown) => {
    const wrap = (value: unknown) => {
      if (value && typeof value === 'object' && 'pipe' in value) return value;
      return Effect.succeed(value);
    };
    const fn: any = vi.fn(() => wrap(typeof initial === 'function' ? (initial as () => unknown)() : initial));
    fn.mockResolvedValue = (value: unknown) => fn.mockReturnValue(Effect.succeed(value));
    fn.mockRejectedValue = (error: unknown) => fn.mockReturnValue(Effect.fail(error));
    fn.mockResolvedValueOnce = (value: unknown) => fn.mockReturnValueOnce(Effect.succeed(value));
    fn.mockRejectedValueOnce = (error: unknown) => fn.mockReturnValueOnce(Effect.fail(error));
    const originalMockImplementation = fn.mockImplementation.bind(fn);
    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => originalMockImplementation((...args: unknown[]) => {
      const result = impl(...args);
      if (result && typeof result === 'object' && 'pipe' in result) return result;
      return Effect.promise(() => Promise.resolve(result));
    });
    return fn;
  };
  return {
  buildTmuxCommandString: vi.fn(() => 'tmux'),
  capturePane: effectMock(''),
  createSession: effectMock(undefined),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  killSession: effectMock(undefined),
  listPaneValues: vi.fn(() => []),
  listPaneValues: effectMock([]),
  listSessionNames: effectMock([]),
  sessionExists: vi.fn(() => false),
  sessionExistsSync: vi.fn(() => false),
  sessionExists: effectMock(false),
  sendKeysProgram: effectMock(undefined),
  };
});

vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({ patrolIntervalMs: 60000 })),
  loadCloisterConfigSync: vi.fn(() => ({ patrolIntervalMs: 60000 })),
}));

vi.mock('../../../lib/paths.js', () => ({
  PANOPTICON_HOME: '/tmp/test-panopticon',
  AGENTS_DIR: '/tmp/test-agents',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn((path: string) => !path.endsWith('/completed') && !path.endsWith('/completed.processed')),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn((path: string) => (path === '/tmp/test-agents' ? ['agent-pan-871'] : [])),
  statSync: vi.fn(() => ({ isDirectory: () => true, mtimeMs: 0 })),
  rmSync: vi.fn(),
}));

import { autoResumeStoppedWorkAgents, nudgeIdleWorkAgentsWithOpenBeads } from '../deacon.js';
import { getAgentStateSync, getAgentState, messageAgent, resumeAgent } from '../../../lib/agents.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { getShadowState } from '../../../lib/shadow-state.js';
import { sessionExists } from '../../../lib/tmux.js';
import { isAgentIdleForNudge } from '../agent-idle.js';
import { isIssueClosed } from '../issue-closed.js';
import { existsSync } from 'fs';

const mockGetAgentState = getAgentStateSync as any;
const mockGetAgentStateAsync = getAgentState as any;
const mockMessageAgent = messageAgent as any;
const mockResumeAgent = resumeAgent as any;
const mockGetReviewStatus = getReviewStatusSync as any;
const mockGetShadowState = getShadowState as any;
const mockSessionExists = sessionExists as any;
const mockIsAgentIdleForNudge = isAgentIdleForNudge as any;
const mockIsIssueClosed = isIssueClosed as any;
const mockExistsSync = existsSync as any;

// Default existsSync behaviour mirrors the module mock: no completed markers present.
const noCompletedMarkers = (path: string) =>
  !path.endsWith('/completed') && !path.endsWith('/completed.processed');

describe('autoResumeStoppedWorkAgents (PAN-871)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const agentState = {
      id: 'agent-pan-871',
      issueId: 'PAN-871',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    };
    mockGetAgentState.mockReturnValue(agentState);
    mockGetAgentStateAsync.mockResolvedValue({ ...agentState, status: 'running' });
    mockGetReviewStatus.mockReturnValue({
      issueId: 'PAN-871',
      reviewStatus: 'blocked',
      testStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
      updatedAt: new Date().toISOString(),
    } as any);
    mockGetShadowState.mockResolvedValue(null);
    mockSessionExists.mockResolvedValue(false);
    mockIsAgentIdleForNudge.mockReturnValue(false);
    mockIsIssueClosed.mockResolvedValue(false);
    mockMessageAgent.mockResolvedValue(undefined);
    mockResumeAgent.mockResolvedValue({ success: true } as any);
    mockExistsSync.mockImplementation(noCompletedMarkers);
  });

  it('does not auto-resume a closed issue even when review feedback is pending', async () => {
    mockIsIssueClosed.mockResolvedValue(true);

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([]);
    expect(mockIsIssueClosed).toHaveBeenCalledWith('PAN-871');
    expect(mockResumeAgent).not.toHaveBeenCalled();
  });

  it('does not auto-resume a deliberately killed agent (no completed marker) even when review feedback is pending', async () => {
    // `pan kill` mid-work: stoppedByUser=true but the agent never reached `pan done`,
    // so there is no completed marker. The user's stop must stand.
    mockGetAgentState.mockReturnValue({
      id: 'agent-pan-871',
      issueId: 'PAN-871',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      stoppedByUser: true,
    });

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([]);
    expect(mockResumeAgent).not.toHaveBeenCalled();
  });

  it('auto-resumes a done-handoff agent (completed marker + stoppedByUser) when the review came back blocked (PAN-1614)', async () => {
    // `pan done` stamps both a completed.processed marker AND stoppedByUser=true.
    // When the review later lands blocked and the agent's tmux session has been
    // reaped, the deacon must resume it to address the feedback — the deliberate-stop
    // gate must not wedge a done-handoff agent forever.
    mockExistsSync.mockImplementation(
      (path: string) => path.endsWith('/completed.processed') || noCompletedMarkers(path),
    );
    mockGetAgentState.mockReturnValue({
      id: 'agent-pan-871',
      issueId: 'PAN-871',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      stoppedByUser: true,
    });

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual(['agent-pan-871']);
    expect(mockResumeAgent).toHaveBeenCalledWith('agent-pan-871');
  });

  it('still auto-resumes an open issue with pending review feedback when not deliberately stopped', async () => {
    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual(['agent-pan-871']);
    expect(mockResumeAgent).toHaveBeenCalledWith('agent-pan-871');
  });

  it('does not nudge an idle work agent when the issue is closed', async () => {
    mockGetAgentState.mockReturnValue({
      id: 'agent-pan-871',
      issueId: 'PAN-871',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    mockIsIssueClosed.mockResolvedValue(true);
    mockSessionExists.mockResolvedValue(true);
    mockIsAgentIdleForNudge.mockReturnValue(true);

    const actions = await nudgeIdleWorkAgentsWithOpenBeads();

    expect(actions).toEqual([]);
    expect(mockIsIssueClosed).toHaveBeenCalledWith('PAN-871');
    expect(mockSessionExists).not.toHaveBeenCalled();
    expect(mockMessageAgent).not.toHaveBeenCalled();
  });

  it('still nudges an idle work agent when the issue is open', async () => {
    mockGetAgentState.mockReturnValue({
      id: 'agent-pan-871',
      issueId: 'PAN-871',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    mockSessionExists.mockResolvedValue(true);
    mockIsAgentIdleForNudge.mockReturnValue(true);

    const actions = await nudgeIdleWorkAgentsWithOpenBeads();

    expect(actions).toEqual(['Nudged idle agent-pan-871 (PAN-871) — 1 open bead(s)']);
    expect(mockMessageAgent).toHaveBeenCalledWith('agent-pan-871', expect.stringContaining('Next ready bead: workspace-nudge'));
  });
});
