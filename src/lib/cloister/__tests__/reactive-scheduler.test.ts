import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agents.js', () => ({
  listRunningAgents: vi.fn(() => []),
  getAgentState: vi.fn(() => null),
  getAgentRuntimeState: vi.fn(() => null),
  saveAgentRuntimeState: vi.fn(),
  spawnRun: vi.fn(async (issueId: string, role: string) => ({ id: `agent-${issueId.toLowerCase()}-${role}` })),
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: vi.fn(() => ({})),
  setReviewStatus: vi.fn(),
}));

import { listRunningAgents, spawnRun } from '../../agents.js';
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

  it('starts the role for an issue state transition', async () => {
    await onIssueStateChange('pan-503', 'in_review');

    expect(spawnRun).toHaveBeenCalledWith('PAN-503', 'review', expect.objectContaining({
      prompt: expect.stringContaining('REVIEW TASK for PAN-503'),
    }));
  });

  it('skips spawning when an active run already exists for the issue and role', async () => {
    vi.mocked(listRunningAgents).mockReturnValue([
      {
        id: 'agent-pan-503-review',
        issueId: 'PAN-503',
        workspace: '/tmp/workspace',
        runtime: 'claude',
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

  it('reacts to work, review, and test completion events by spawning the next role', async () => {
    await handleCloisterDomainEvent({ type: 'work.completed', payload: { issueId: 'PAN-503' } });
    await handleCloisterDomainEvent({ type: 'review.approved', payload: { issueId: 'PAN-503' } });
    await handleCloisterDomainEvent({ type: 'test.passed', payload: { issueId: 'PAN-503' } });

    expect(spawnRun).toHaveBeenNthCalledWith(1, 'PAN-503', 'review', expect.any(Object));
    expect(spawnRun).toHaveBeenNthCalledWith(2, 'PAN-503', 'test', expect.any(Object));
    expect(spawnRun).toHaveBeenNthCalledWith(3, 'PAN-503', 'ship', expect.any(Object));
  });
});
