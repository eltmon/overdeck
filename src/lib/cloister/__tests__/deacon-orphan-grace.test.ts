import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFs = vi.hoisted(() => ({
  agentsDir: '/tmp/test-agents',
  agentDir: 'agent-pan-1256',
  state: {} as Record<string, unknown>,
}));

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
    saveAgentState: effectMock(undefined),
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
  getReviewStatus: vi.fn(),
  getReviewStatusSync: vi.fn(() => undefined),
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
    killSession: effectMock(undefined),
    killSessionSync: vi.fn(),
    listPaneValues: effectMock([]),
    listSessionNames: effectMock([]),
    sessionExists: effectMock(false),
    sessionExistsSync: vi.fn(() => false),
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
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith('/state.json')) return JSON.stringify(mockFs.state);
    if (path.endsWith('/reviewer-launcher.pid')) return '12345';
    return '{}';
  }),
  writeFileSync: vi.fn(),
  existsSync: vi.fn((path: string) => {
    if (path === mockFs.agentsDir) return true;
    if (path.endsWith('/state.json')) return true;
    if (path.endsWith('/reviewer-launcher.pid')) return false;
    return !path.endsWith('/completed') && !path.endsWith('/completed.processed');
  }),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn((path: string) => (path === mockFs.agentsDir ? [mockFs.agentDir] : [])),
  statSync: vi.fn(() => ({ isDirectory: () => true, mtimeMs: 0 })),
  rmSync: vi.fn(),
}));

import { recoverOrphanedAgents } from '../deacon.js';
import { saveAgentState } from '../../../lib/agents.js';

const NOW = new Date('2026-06-04T12:00:00.000Z');

const startedAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const setAgentState = (overrides: Record<string, unknown>) => {
  mockFs.state = {
    id: mockFs.agentDir,
    issueId: 'PAN-1256',
    workspace: '/tmp/workspace',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'starting',
    startedAt: startedAgo(30_000),
    ...overrides,
  };
};

const mockSaveAgentState = saveAgentState as any;

let processKillSpy: ReturnType<typeof vi.spyOn>;

describe('recoverOrphanedAgents WORK_LAUNCHER_GRACE_MS (PAN-1256)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockFs.agentDir = 'agent-pan-1256';
    setAgentState({});
  });

  afterEach(() => {
    vi.useRealTimers();
    processKillSpy.mockRestore();
  });

  it('does not stop a starting work agent 30s into the 120s launcher grace window', async () => {
    setAgentState({ status: 'starting', startedAt: startedAgo(30_000) });

    const actions = await recoverOrphanedAgents('test');

    expect(actions).toEqual([]);
    expect(mockSaveAgentState).not.toHaveBeenCalledWith(expect.objectContaining({
      id: mockFs.agentDir,
      status: 'stopped',
    }));
  });

  it('does not stop a starting swarm slot 29s after launch', async () => {
    setAgentState({ status: 'starting', startedAt: startedAgo(29_000) });

    const actions = await recoverOrphanedAgents('test');

    expect(actions).toEqual([]);
    expect(mockSaveAgentState).not.toHaveBeenCalledWith(expect.objectContaining({
      id: mockFs.agentDir,
      status: 'stopped',
    }));
  });

  it('stops a starting work agent after the 120s launcher grace window expires', async () => {
    setAgentState({ status: 'starting', startedAt: startedAgo(200_000) });

    const actions = await recoverOrphanedAgents('test');

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain(mockFs.agentDir);
    expect(mockSaveAgentState).toHaveBeenCalledWith(expect.objectContaining({
      id: mockFs.agentDir,
      status: 'stopped',
    }));
  });

  it('still stops a running work agent with no tmux session', async () => {
    setAgentState({ status: 'running', startedAt: startedAgo(30_000) });

    const actions = await recoverOrphanedAgents('test');

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain(mockFs.agentDir);
    expect(mockSaveAgentState).toHaveBeenCalledWith(expect.objectContaining({
      id: mockFs.agentDir,
      status: 'stopped',
    }));
  });

  it('preserves reviewer startup grace when reviewSubRole starts without a launcher pid file', async () => {
    setAgentState({
      status: 'starting',
      role: 'review',
      reviewSubRole: 'correctness',
      startedAt: startedAgo(30_000),
    });

    const actions = await recoverOrphanedAgents('test');

    expect(actions).toEqual([]);
    expect(mockSaveAgentState).not.toHaveBeenCalledWith(expect.objectContaining({
      id: mockFs.agentDir,
      status: 'stopped',
    }));
  });
});
