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
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn(() => []),
  getAgentDir: vi.fn((agentId: string) => `/tmp/test-agents/${agentId}`),
  getAgentState: vi.fn(),
  getAgentStateEffect: effectMock(null),
  saveAgentState: vi.fn(),
  resumeAgent: vi.fn(async () => ({ success: true })),
  recordAgentFailureEffect: effectMock(null),
  };
});

vi.mock('../../../lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatus: vi.fn(),
}));

vi.mock('../../../lib/shadow-state.js', () => ({
  getShadowState: vi.fn(async () => null),
}));

vi.mock('../../../lib/database/review-status-db.js', () => ({
  markWorkspaceStuck: vi.fn(),
}));

vi.mock('../../../lib/database/app-settings.js', () => ({
  isDeaconGloballyPaused: vi.fn(() => false),
}));

vi.mock('../../../lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: vi.fn(() => '/tmp/workspace'),
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon-cli' })),
}));

vi.mock('../../../lib/persistent-logger.js', () => ({
  logDeaconEvent: vi.fn(),
  logAgentLifecycle: vi.fn(),
}));

vi.mock('../../../lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityTts: vi.fn(),
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
  killSession: effectMock(undefined),
  listPaneValues: vi.fn(() => []),
  listPaneValues: effectMock([]),
  listSessionNames: effectMock([]),
  sessionExists: vi.fn(() => false),
  sessionExists: effectMock(false),
  sendKeysEffect: effectMock(undefined),
  };
});

vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({ patrolIntervalMs: 60000 })),
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

import { autoResumeStoppedWorkAgents } from '../deacon.js';
import { getAgentStateSync, getAgentState, resumeAgent } from '../../../lib/agents.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { getShadowState } from '../../../lib/shadow-state.js';

const mockGetAgentState = getAgentStateSync as any;
const mockGetAgentStateAsync = getAgentState as any;
const mockResumeAgent = resumeAgent as any;
const mockGetReviewStatus = getReviewStatusSync as any;
const mockGetShadowState = getShadowState as any;

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
    mockResumeAgent.mockResolvedValue({ success: true } as any);
  });

  it('does not auto-resume a closed issue even when review feedback is pending', async () => {
    mockGetShadowState.mockResolvedValue({
      issueId: 'PAN-871',
      shadowStatus: 'closed',
      trackerStatus: 'closed',
      trackerStatusUpdatedAt: new Date().toISOString(),
      shadowedAt: new Date().toISOString(),
      history: [],
    } as any);

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([]);
    expect(mockResumeAgent).not.toHaveBeenCalled();
  });

  it('does not auto-resume a deliberately stopped agent even when review feedback is pending', async () => {
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

  it('still auto-resumes an open issue with pending review feedback when not deliberately stopped', async () => {
    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual(['agent-pan-871']);
    expect(mockResumeAgent).toHaveBeenCalledWith('agent-pan-871');
  });
});
