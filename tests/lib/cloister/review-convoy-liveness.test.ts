import { describe, expect, it, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const agentStates = new Map<string, { status?: string; paused?: boolean; troubled?: boolean }>();
  return {
    agentStates,
    getAgentStateSync: vi.fn((agentId: string) => agentStates.get(agentId) ?? null),
    setReviewStatusSync: vi.fn(),
    spawnRun: vi.fn(),
    killSessionSync: vi.fn(),
    killSession: vi.fn(),
    spawnReviewRoleForIssue: vi.fn(),
  };
});

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
  loadReviewStatuses: vi.fn().mockReturnValue({}),
  setReviewStatusSync: (...args: unknown[]) => mocks.setReviewStatusSync(...args),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgentsSync: vi.fn().mockReturnValue([]),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentStateSync: (...args: [string]) => mocks.getAgentStateSync(...args),
  getAgentState: vi.fn().mockReturnValue(null),
  saveAgentStateSync: vi.fn(),
  saveAgentState: vi.fn(),
  resumeAgent: vi.fn(),
  recordAgentFailure: vi.fn(),
  markAgentRunningState: vi.fn(),
  spawnRun: (...args: unknown[]) => mocks.spawnRun(...args),
}));

vi.mock('../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    buildTmuxCommandString: vi.fn(),
    capturePane: vi.fn(() => Effect.succeed('')),
    createSession: vi.fn(() => Effect.succeed(undefined)),
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    killSessionSync: (...args: unknown[]) => mocks.killSessionSync(...args),
    killSession: (...args: unknown[]) => {
      mocks.killSession(...args);
      return Effect.succeed(undefined);
    },
    listPaneValuesSync: vi.fn().mockReturnValue([]),
    listPaneValues: vi.fn(() => Effect.succeed([])),
    listSessionNames: vi.fn(() => Effect.succeed([])),
    sessionExistsSync: vi.fn().mockReturnValue(false),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    sendKeys: vi.fn(() => Effect.succeed(undefined)),
  };
});

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  SpecialistAgentName: {},
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: (...args: unknown[]) => mocks.spawnReviewRoleForIssue(...args),
}));

import { reviewConvoyLiveness } from '../../../src/lib/cloister/deacon.js';

const convoyAgentIds = [
  'agent-pan-1614',
  'agent-pan-1614-review',
  'agent-pan-1614-review-security',
  'agent-pan-1614-review-correctness',
  'agent-pan-1614-review-performance',
  'agent-pan-1614-review-requirements',
];

describe('reviewConvoyLiveness', () => {
  beforeEach(() => {
    mocks.agentStates.clear();
    mocks.getAgentStateSync.mockClear();
    mocks.setReviewStatusSync.mockClear();
    mocks.spawnRun.mockClear();
    mocks.killSessionSync.mockClear();
    mocks.killSession.mockClear();
    mocks.spawnReviewRoleForIssue.mockClear();
  });

  it('enumerates the work, synthesis, and reviewer sub-role agent ids from REVIEW_SUB_ROLES', () => {
    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.agentIds).toEqual(convoyAgentIds);
    expect(mocks.getAgentStateSync.mock.calls.map(([agentId]) => agentId)).toEqual(convoyAgentIds);
  });

  it('reports all stopped agents as not live and not gated', () => {
    for (const agentId of convoyAgentIds) {
      mocks.agentStates.set(agentId, { status: 'stopped' });
    }

    expect(reviewConvoyLiveness('PAN-1614')).toEqual({
      anyLive: false,
      anyGated: false,
      agentIds: convoyAgentIds,
    });
  });

  it('reports a running sub-role reviewer as live', () => {
    mocks.agentStates.set('agent-pan-1614-review-performance', { status: 'running' });

    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.anyLive).toBe(true);
    expect(result.anyGated).toBe(false);
  });

  it('reports a paused work agent as gated', () => {
    mocks.agentStates.set('agent-pan-1614', { status: 'stopped', paused: true });

    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.anyLive).toBe(false);
    expect(result.anyGated).toBe(true);
  });

  it('reports a troubled sub-role reviewer as gated', () => {
    mocks.agentStates.set('agent-pan-1614-review-security', { status: 'stopped', troubled: true });

    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.anyLive).toBe(false);
    expect(result.anyGated).toBe(true);
  });

  it('treats absent state files as stopped and ungated', () => {
    expect(reviewConvoyLiveness('PAN-1614')).toEqual({
      anyLive: false,
      anyGated: false,
      agentIds: convoyAgentIds,
    });
  });

  it('does not mutate review state, spawn agents, or kill tmux sessions', () => {
    reviewConvoyLiveness('PAN-1614');

    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
    expect(mocks.spawnRun).not.toHaveBeenCalled();
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(mocks.killSessionSync).not.toHaveBeenCalled();
    expect(mocks.killSession).not.toHaveBeenCalled();
  });
});
