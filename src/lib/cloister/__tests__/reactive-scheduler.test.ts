import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agents.js', async () => {
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
  listRunningAgentsSync: vi.fn(() => []),
  listRunningAgents: effectMock([]),
  // PAN-1048 P1: activeRoleRunExists is now async and uses listRunningAgentsProgram
  // on the reactive scheduler hot path.
  listRunningAgentsProgram: effectMock([]),
  getAgentState: effectMock(null),
  getAgentStateSync: vi.fn(() => null),
  // PAN-1048 round-5 mechanical fix: resolveWorkspaceForIssue now awaits the
  // async agent-state read, so the mock module must export this symbol or the
  // dynamic call in the scheduler throws before reaching the wrapper spy.
  getAgentStateProgram: effectMock(null),
  getAgentRuntimeState: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(() => null),
  saveAgentRuntimeState: vi.fn(),
  saveAgentState: vi.fn(() => Effect.void),
  saveAgentStateSync: vi.fn(),
  resumeAgent: vi.fn(async () => ({ success: true })),
  recordAgentFailure: vi.fn(() => Effect.succeed(null)),
  resetAgentFailureCount: vi.fn(),
  markAgentRunningState: vi.fn((s: any) => { s.status = 'running'; }),
  getAgentDir: vi.fn((id: string) => `/tmp/agents/${id}`),
  normalizeAgentId: vi.fn((id: string) => id),
  spawnRun: vi.fn(async (issueId: string, role: string) => ({ id: `agent-${issueId.toLowerCase()}-${role}` })),
  };
});

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({
    projectKey: 'pan',
    projectPath: '/tmp/pan',
  })),
  resolveProjectFromIssueSync: vi.fn(() => ({
    projectKey: 'pan',
    projectPath: '/tmp/pan',
  })),
}));

// PAN-1048 review feedback 003: review and test go through their dedicated
// wrappers instead of bare spawnRun(). The scheduler dynamically imports
// these modules, so we mock them at the module factory layer.
vi.mock('../review-agent.js', () => ({
  spawnReviewRoleForIssue: vi.fn(async () => ({ success: true, message: 'mock review spawned' })),
}));

vi.mock('../test-agent-queue.js', () => ({
  dispatchTestAgentAndNotify: vi.fn(async () => undefined),
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: vi.fn(async () => false),
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEvent: vi.fn(),
  logDeaconEventSync: vi.fn(),
  logAgentLifecycle: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('../no-resume-mode.js', () => ({
  getNoResumeMode: () => ({ active: false, since: null }),
}));

vi.mock('../concurrency.js', () => ({
  workResumeSlotsAvailable: () => 1,
  countRunningAgents: () => ({ work: 0, advancing: 0, total: 0 }),
  getConcurrencyLimits: () => ({
    maxWorkAgents: 6,
    reservedAdvancingSlots: 3,
    totalCeiling: 9,
    exemptOperatorStarted: true,
  }),
  resetPatrolDispatchBudget: vi.fn(),
  tryReserveAdvancingSlot: () => true,
  releaseAdvancingSlot: vi.fn(),
  tryReserveSwarmSlot: () => true,
  releaseSwarmSlot: vi.fn(),
  describeRunningAgents: () => 'counts: work=0 advancing=0 total=0/9 | advancing=[] work=[]',
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: actual,
    loadavg: () => [0.5, 0.5, 0.5],
    cpus: () => Array.from({ length: 8 }, () => ({}) as ReturnType<typeof actual.cpus>[number]),
  };
});

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatusSync: vi.fn(() => undefined),
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
}));

const closedIssueReaperMock = vi.hoisted(() => ({
  handleIssueStatusChangedClosed: vi.fn(async () => ['reaped-closed']),
}));
vi.mock('../closed-issue-reaper.js', () => closedIssueReaperMock);

const orphanProposedMock = vi.hoisted(() => ({
  handleOrphanProposedSpec: vi.fn(async () => ['spawned-orphan']),
}));
vi.mock('../orphan-proposed-reconciler.js', () => orphanProposedMock);

const idleStackReaperMock = vi.hoisted(() => ({
  handleAgentLifecycleEventForIdleStack: vi.fn(),
}));
vi.mock('../idle-stack-reaper.js', () => idleStackReaperMock);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      if (path === '/tmp/workspace') return true;
      if (path.startsWith('/tmp/agents/')) return false;
      return actual.existsSync(path);
    },
  };
});

// Stale-session (zombie) detection: activeRoleRunExists probes the workspace
// HEAD and onIssueStateChange kills a leftover tmux session before re-dispatch.
// mockHeadSha is the value `git rev-parse --short=8 HEAD` resolves to.
let mockHeadSha = 'newhead1';
vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: vi.fn((_cmd: string, opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (
        err: Error | null,
        out: { stdout: string; stderr: string },
      ) => void;
      callback(null, { stdout: `${mockHeadSha}\n`, stderr: '' });
    }),
  };
});

vi.mock('../../tmux.js', async () => {
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
  sessionExists: effectMock(false),
  sessionExistsSync: vi.fn(() => false),
  killSession: effectMock(undefined),
  killSessionSync: vi.fn(() => undefined),
  };
});

import { listRunningAgentsSync, listRunningAgents, spawnRun, getAgentState, getAgentStateSync, resumeAgent } from '../../agents.js';
import { sessionExists, killSession, sessionExistsSync } from '../../tmux.js';
import { spawnReviewRoleForIssue } from '../review-agent.js';
import { dispatchTestAgentAndNotify } from '../test-agent-queue.js';
import { isIssueClosed } from '../issue-closed.js';
import { getReviewStatusSync, setReviewStatusSync } from '../../review-status.js';
import {
  handleCloisterDomainEvent,
  issueStateChangeFromDomainEvent,
  onIssueStateChange,
  stateToRole,
} from '../service.js';

describe('reactive Cloister scheduler', () => {
  let savedNoResume: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    savedNoResume = process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_NO_RESUME;
    vi.mocked(listRunningAgentsSync).mockReturnValue([]);
    vi.mocked(listRunningAgents).mockResolvedValue([]);
    vi.mocked(spawnRun).mockResolvedValue({ id: 'agent-pan-503-review' } as any);
    vi.mocked(getAgentState).mockResolvedValue(null);
    vi.mocked(sessionExists).mockResolvedValue(false);
    vi.mocked(killSession).mockResolvedValue(undefined);
    vi.mocked(isIssueClosed).mockResolvedValue(false);
    vi.mocked(getReviewStatusSync).mockReturnValue(undefined as any);
    mockHeadSha = 'newhead1';
  });

  afterEach(() => {
    if (savedNoResume !== undefined) {
      process.env.OVERDECK_NO_RESUME = savedNoResume;
    }
  });

  it('maps issue lifecycle states to roles', () => {
    expect(stateToRole('in_planning')).toBe('plan');
    expect(stateToRole('in_progress')).toBe('work');
    expect(stateToRole('in_review')).toBe('review');
    expect(stateToRole('testing')).toBe('test');
    expect(stateToRole('shipping')).toBeNull();
    expect(stateToRole('closed')).toBeNull();
    expect(stateToRole('canceled')).toBeNull();
  });

  it('starts the review role for an issue state transition via the wrapper', async () => {
    await Effect.runPromise(onIssueStateChange('pan-503', 'in_review'));

    // Review dispatches through spawnReviewRoleForIssue so the wrapper carries
    // review-temp stash + reviewSpawnedAt + status-posting prompt + idempotency.
    expect(spawnReviewRoleForIssue).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-503',
      branch: 'feature/pan-503',
    }));
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it.each([
    'in_review',
    'testing',
  ] as const)('skips %s dispatch when the issue is closed', async (state) => {
    vi.mocked(isIssueClosed).mockResolvedValue(true);

    await Effect.runPromise(onIssueStateChange('PAN-503', state));

    expect(isIssueClosed).toHaveBeenCalledWith('PAN-503');
    expect(spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(dispatchTestAgentAndNotify).not.toHaveBeenCalled();
    expect(spawnRun).not.toHaveBeenCalled();
    expect(listRunningAgents).not.toHaveBeenCalled();
    expect(getAgentState).not.toHaveBeenCalled();
    expect(sessionExists).not.toHaveBeenCalled();
  });

  it.each([
    'in_review',
    'testing',
  ] as const)('skips %s dispatch when the merge already landed (PAN-1746)', async (state) => {
    // Boot reconciliation replays state-change events on restart; a long-merged
    // issue still carrying its lifecycle state must NOT re-dispatch an advancing
    // role. mergeStatus='merged' is the same terminal signal a closed issue is.
    vi.mocked(getReviewStatusSync).mockReturnValue({ mergeStatus: 'merged' } as any);

    await Effect.runPromise(onIssueStateChange('PAN-503', state));

    expect(getReviewStatusSync).toHaveBeenCalledWith('PAN-503');
    expect(spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(dispatchTestAgentAndNotify).not.toHaveBeenCalled();
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('does not dispatch a role for the shipping state', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await Effect.runPromise(onIssueStateChange('PAN-503', 'shipping'));

    expect(logSpy).toHaveBeenCalledWith("[cloister] PAN-503: no role for issue state 'shipping'");
    expect(isIssueClosed).not.toHaveBeenCalled();
    expect(getReviewStatusSync).not.toHaveBeenCalled();
    expect(listRunningAgents).not.toHaveBeenCalled();
    expect(sessionExists).not.toHaveBeenCalled();
    expect(spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(dispatchTestAgentAndNotify).not.toHaveBeenCalled();
    expect(spawnRun).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('skips spawning when an active run already exists for the issue and role', async () => {
    // PAN-1048 P1 + C2: activeRoleRunExists no longer requires tmuxActive — any
    // non-stopped state.json with the matching role counts as in-flight, which
    // closes the spawn-route race against the reactive scheduler.
    vi.mocked(listRunningAgents).mockResolvedValue([
      {
        id: 'agent-pan-503-review',
        issueId: 'PAN-503',
        workspace: '/tmp/workspace',
        harness: 'claude-code',
        role: 'review',
        model: 'sonnet',
        status: 'running',
        startedAt: new Date().toISOString(),
        tmuxActive: true,
      },
    ] as any);

    await Effect.runPromise(onIssueStateChange('PAN-503', 'in_review'));

    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('derives state changes from existing issue and completion events', () => {
    expect(issueStateChangeFromDomainEvent({
      type: 'issue.transitioned',
      payload: { issueId: 'PAN-503', state: 'in_progress' },
    })).toEqual({ issueId: 'PAN-503', state: 'in_progress' });

    expect(issueStateChangeFromDomainEvent({
      type: 'work.completed',
      payload: { issueId: 'PAN-503' },
    })).toEqual({ issueId: 'PAN-503', state: 'in_review' });

    expect(issueStateChangeFromDomainEvent({
      type: 'review.approved',
      payload: { issueId: 'PAN-503' },
    })).toEqual({ issueId: 'PAN-503', state: 'testing' });

    expect(issueStateChangeFromDomainEvent({
      type: 'test.passed',
      payload: { issueId: 'PAN-503' },
    })).toEqual({ issueId: 'PAN-503', state: 'shipping' });
  });

  it('reacts to work, review, and test completion events by routing only spawned roles through dispatchers', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({ type: 'work.completed', payload: { issueId: 'PAN-503' } }));
    await Effect.runPromise(handleCloisterDomainEvent({ type: 'review.approved', payload: { issueId: 'PAN-503' } }));
    await Effect.runPromise(handleCloisterDomainEvent({ type: 'test.passed', payload: { issueId: 'PAN-503' } }));

    // PAN-1048 review feedback 003: review/test go through dedicated wrappers.
    // Shipping remains a lifecycle state, but no longer maps to a spawned role.
    expect(spawnReviewRoleForIssue).toHaveBeenCalledTimes(1);
    expect(spawnReviewRoleForIssue).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-503',
      branch: 'feature/pan-503',
    }));
    expect(dispatchTestAgentAndNotify).toHaveBeenCalledTimes(1);
    expect(dispatchTestAgentAndNotify).toHaveBeenCalledWith(
      'PAN-503',
      expect.any(String),
      'feature/pan-503',
    );
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('ignores agent.completed events for non-work roles so review/test cycles do not loop', () => {
    // Without role-branching, agent.completed from the review or test role
    // would re-enter onIssueStateChange with state='in_review' and double-dispatch.
    expect(issueStateChangeFromDomainEvent({
      type: 'agent.completed',
      payload: { issueId: 'PAN-503', role: 'review' },
    })).toBeNull();

    expect(issueStateChangeFromDomainEvent({
      type: 'agent.completed',
      payload: { issueId: 'PAN-503', role: 'test' },
    })).toBeNull();

    // work.completed-style agent.completed events still drive the work → review hop.
    expect(issueStateChangeFromDomainEvent({
      type: 'agent.completed',
      payload: { issueId: 'PAN-503', role: 'work' },
    })).toEqual({ issueId: 'PAN-503', state: 'in_review' });

    // Legacy events without role still fall through to the work mapping.
    expect(issueStateChangeFromDomainEvent({
      type: 'agent.completed',
      payload: { issueId: 'PAN-503' },
    })).toEqual({ issueId: 'PAN-503', state: 'in_review' });
  });

  it('routes agent.stopped events to the deacon resume handler', async () => {
    vi.mocked(getAgentStateSync).mockReturnValue({
      id: 'agent-pan-503',
      issueId: 'PAN-503',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    } as any);
    vi.mocked(getReviewStatusSync).mockReturnValue({
      issueId: 'PAN-503',
      reviewStatus: 'blocked',
      testStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
    } as any);
    vi.mocked(sessionExists).mockResolvedValue(false);

    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.stopped',
      payload: { agentId: 'agent-pan-503', issueId: 'PAN-503' },
    }));

    expect(resumeAgent).toHaveBeenCalledWith('agent-pan-503');
  });

  it('routes agent.heartbeat_dead events to the deacon orphan handler', async () => {
    vi.mocked(getAgentStateSync).mockReturnValue({
      id: 'agent-pan-503',
      issueId: 'PAN-503',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    } as any);
    vi.mocked(sessionExistsSync).mockReturnValue(false);

    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.heartbeat_dead',
      payload: { agentId: 'agent-pan-503', issueId: 'PAN-503' },
    }));

    expect(killSession).not.toHaveBeenCalled();
  });

  it('routes review.coordinator.died events to the deacon review recovery handler', async () => {
    vi.mocked(getReviewStatusSync).mockReturnValue({
      issueId: 'PAN-503',
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      reviewRetryCount: 0,
    } as any);
    vi.mocked(getAgentStateSync).mockReturnValue({
      id: 'agent-pan-503',
      issueId: 'PAN-503',
      workspace: '/tmp/workspace',
    } as any);
    vi.mocked(sessionExists).mockResolvedValue(false);
    vi.mocked(sessionExistsSync).mockReturnValue(false);

    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'review.coordinator.died',
      payload: { issueId: 'PAN-503', sessionName: 'agent-pan-503-review', reason: 'pane dead' },
    }));

    expect(setReviewStatusSync).toHaveBeenCalledWith('PAN-503', expect.objectContaining({ reviewStatus: 'pending' }));
  });

  it('routes work.completed events to the missing review-status handler', async () => {
    vi.mocked(getReviewStatusSync).mockReturnValue(undefined as any);

    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'work.completed',
      payload: { issueId: 'PAN-503' },
    }));

    expect(setReviewStatusSync).toHaveBeenCalledWith('PAN-503', expect.objectContaining({ reviewStatus: 'pending', testStatus: 'pending' }));
    expect(spawnReviewRoleForIssue).toHaveBeenCalledWith(expect.objectContaining({ issueId: 'PAN-503' }));
  });

  it('routes issue.statusChanged(closed) to the closed-issue reaper handler', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'issue.statusChanged',
      payload: { issueId: 'PAN-503', status: 'Closed', canonicalStatus: 'closed' },
    }));

    expect(closedIssueReaperMock.handleIssueStatusChangedClosed).toHaveBeenCalledWith('PAN-503');
    expect(orphanProposedMock.handleOrphanProposedSpec).not.toHaveBeenCalled();
  });

  it('routes issue.statusChanged(planned) to the orphan-proposed handler', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'issue.statusChanged',
      payload: { issueId: 'PAN-503', status: 'Planned', canonicalStatus: 'todo' },
    }));

    expect(orphanProposedMock.handleOrphanProposedSpec).toHaveBeenCalledWith('PAN-503');
    expect(closedIssueReaperMock.handleIssueStatusChangedClosed).not.toHaveBeenCalled();
  });

  it('routes agent.started to the idle-stack grace-clock reset', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.started',
      payload: { agentId: 'agent-pan-503' },
    }));

    expect(idleStackReaperMock.handleAgentLifecycleEventForIdleStack).toHaveBeenCalledWith('agent-pan-503');
  });

  it('routes agent.stopped to the idle-stack grace-clock reset', async () => {
    vi.mocked(getAgentStateSync).mockReturnValue(null);

    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.stopped',
      payload: { agentId: 'agent-pan-503' },
    }));

    expect(idleStackReaperMock.handleAgentLifecycleEventForIdleStack).toHaveBeenCalledWith('agent-pan-503');
  });
});

describe('PAN-2159: duplicate planner twin on in_planning', () => {
  it('does not spawn a twin while the canonical planner is freshly starting (tmux session not yet created)', async () => {
    // The start-planning route writes planning-<issue> state BEFORE the
    // lifecycle transition; the tmux session is created after it. The guard
    // must treat this fresh 'starting' state as alive.
    vi.mocked(getAgentState).mockImplementation(((id: string) => {
      if (id === 'planning-pan-503') {
        return { id, issueId: 'PAN-503', role: 'plan', status: 'starting', startedAt: new Date().toISOString() };
      }
      return null;
    }) as never);
    vi.mocked(sessionExists).mockResolvedValue(false);

    await Effect.runPromise(onIssueStateChange('PAN-503', 'in_planning'));

    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('still unsticks a stale crashed spawn (starting past the grace window, no session)', async () => {
    vi.mocked(getAgentState).mockImplementation(((id: string) => {
      if (id === 'planning-pan-503') {
        return { id, issueId: 'PAN-503', role: 'plan', status: 'starting', startedAt: new Date(Date.now() - 10 * 60_000).toISOString() };
      }
      return null;
    }) as never);
    vi.mocked(sessionExists).mockResolvedValue(false);

    await Effect.runPromise(onIssueStateChange('PAN-503', 'in_planning'));

    expect(spawnRun).toHaveBeenCalledWith('PAN-503', 'plan', expect.anything());
  });
});
