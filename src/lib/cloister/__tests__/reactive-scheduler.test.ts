import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agents.js', () => ({
  listRunningAgents: vi.fn(() => []),
  // PAN-1048 P1: activeRoleRunExists is now async and uses listRunningAgentsAsync
  // on the reactive scheduler hot path.
  listRunningAgentsAsync: vi.fn(async () => []),
  getAgentState: vi.fn(() => null),
  getAgentRuntimeState: vi.fn(() => null),
  saveAgentRuntimeState: vi.fn(),
  spawnRun: vi.fn(async (issueId: string, role: string) => ({ id: `agent-${issueId.toLowerCase()}-${role}` })),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({
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
}));

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: vi.fn(() => ({})),
  setReviewStatus: vi.fn(),
}));

import { listRunningAgents, listRunningAgentsAsync, spawnRun } from '../../agents.js';
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
    vi.mocked(listRunningAgents).mockReturnValue([]);
    vi.mocked(listRunningAgentsAsync).mockResolvedValue([]);
    vi.mocked(spawnRun).mockResolvedValue({ id: 'agent-pan-503-review' } as any);
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
    await onIssueStateChange('pan-503', 'in_review');

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
    vi.mocked(listRunningAgentsAsync).mockResolvedValue([
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

    await onIssueStateChange('PAN-503', 'in_review');

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
    await handleCloisterDomainEvent({ type: 'work.completed', payload: { issueId: 'PAN-503' } });
    await handleCloisterDomainEvent({ type: 'review.approved', payload: { issueId: 'PAN-503' } });
    await handleCloisterDomainEvent({ type: 'test.passed', payload: { issueId: 'PAN-503' } });

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
});
