import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  getAgentStateSync: effectMock(null),
  // PAN-1048 round-5 mechanical fix: resolveWorkspaceForIssue now awaits the
  // async agent-state read, so the mock module must export this symbol or the
  // dynamic call in the scheduler throws before reaching the wrapper spy.
  getAgentStateProgram: effectMock(null),
  getAgentRuntimeState: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(() => null),
  saveAgentRuntimeState: vi.fn(),
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

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatusSync: vi.fn(() => undefined),
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
}));

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
  sessionExistsSync: effectMock(false),
  killSession: effectMock(undefined),
  killSessionSync: effectMock(undefined),
  };
});

import { listRunningAgentsSync, listRunningAgents, spawnRun, getAgentState } from '../../agents.js';
import { sessionExists, killSession } from '../../tmux.js';
import { spawnReviewRoleForIssue } from '../review-agent.js';
import { dispatchTestAgentAndNotify } from '../test-agent-queue.js';
import {
  handleCloisterDomainEvent,
  issueStateChangeFromDomainEvent,
  onIssueStateChange,
  stateToRole,
} from '../service.js';

describe('reactive Cloister scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRunningAgentsSync).mockReturnValue([]);
    vi.mocked(listRunningAgents).mockResolvedValue([]);
    vi.mocked(spawnRun).mockResolvedValue({ id: 'agent-pan-503-review' } as any);
    vi.mocked(getAgentState).mockResolvedValue(null);
    vi.mocked(sessionExists).mockResolvedValue(false);
    vi.mocked(killSession).mockResolvedValue(undefined);
    mockHeadSha = 'newhead1';
  });

  it('maps issue lifecycle states to roles', () => {
    expect(stateToRole('in_planning')).toBe('plan');
    expect(stateToRole('in_progress')).toBe('work');
    expect(stateToRole('in_review')).toBe('review');
    expect(stateToRole('testing')).toBe('test');
    expect(stateToRole('shipping')).toBe('ship');
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

  it('reacts to work, review, and test completion events by routing each role through its dispatcher', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({ type: 'work.completed', payload: { issueId: 'PAN-503' } }));
    await Effect.runPromise(handleCloisterDomainEvent({ type: 'review.approved', payload: { issueId: 'PAN-503' } }));
    await Effect.runPromise(handleCloisterDomainEvent({ type: 'test.passed', payload: { issueId: 'PAN-503' } }));

    // PAN-1048 review feedback 003: review/test go through dedicated wrappers,
    // ship still uses bare spawnRun().
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
    expect(spawnRun).toHaveBeenCalledTimes(1);
    expect(spawnRun).toHaveBeenCalledWith('PAN-503', 'ship', expect.any(Object));
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

  it('treats a ship session as still-active when its roleRunHead matches the workspace HEAD', async () => {
    // A genuinely in-flight ship run: state.json HEAD marker == current HEAD.
    // The scheduler must NOT re-dispatch — that would double-spawn ship.
    vi.mocked(getAgentState).mockImplementation(async (id: string) => {
      if (id === 'agent-pan-503') return { workspace: '/tmp/ws' } as any;
      if (id === 'agent-pan-503-ship') {
        return { role: 'ship', status: 'running', roleRunHead: 'samehead', workspace: '/tmp/ws' } as any;
      }
      return null;
    });
    mockHeadSha = 'samehead';

    await Effect.runPromise(onIssueStateChange('PAN-503', 'shipping'));

    expect(spawnRun).not.toHaveBeenCalled();
    expect(killSession).not.toHaveBeenCalled();
  });

  it('re-dispatches ship when the existing ship session is a stale zombie (HEAD moved past roleRunHead)', async () => {
    // The ship-stall bug: an agent finished work but never exited, leaving
    // state.json status:'running' forever. Once the workspace HEAD advances
    // past the run's roleRunHead marker, that session is stale — the scheduler
    // must kill it and dispatch a fresh ship run for the new HEAD.
    vi.mocked(getAgentState).mockImplementation(async (id: string) => {
      if (id === 'agent-pan-503') return { workspace: '/tmp/ws' } as any;
      if (id === 'agent-pan-503-ship') {
        return { role: 'ship', status: 'running', roleRunHead: 'oldhead0', workspace: '/tmp/ws' } as any;
      }
      return null;
    });
    // Zombie tmux session still physically present.
    vi.mocked(sessionExists).mockResolvedValue(true);
    mockHeadSha = 'newhead1';

    await Effect.runPromise(onIssueStateChange('PAN-503', 'shipping'));

    expect(killSession).toHaveBeenCalledWith('agent-pan-503-ship');
    expect(spawnRun).toHaveBeenCalledWith('PAN-503', 'ship', expect.any(Object));
  });
});
