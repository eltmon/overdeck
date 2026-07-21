import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadReviewStatuses: vi.fn(),
  setReviewStatusSync: vi.fn(),
  listRunningAgents: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: mocks.loadReviewStatuses,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));
vi.mock('../../agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn(),
  getAgentStateSync: vi.fn(),
  listRunningAgents: mocks.listRunningAgents,
}));
vi.mock('../specialists.js', () => ({
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
  getTmuxSessionName: vi.fn(() => 'review-agent'),
}));
vi.mock('../../tmux.js', () => ({
  isPaneDead: vi.fn(),
  sessionExistsSync: vi.fn(() => false),
}));

describe('checkStuckReviewing', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z'));
  });

  it('resets a stale numeric-timestamp review despite latched running rows', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-2735': {
        issueId: 'PAN-2735',
        reviewStatus: 'reviewing',
        reviewSpawnedAt: Date.parse('2026-07-15T15:00:00.000Z'),
        updatedAt: '2026-07-15T15:59:00.000Z',
      },
    });
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      {
        id: 'agent-pan-2735-review-security',
        issueId: 'PAN-2735',
        role: 'review',
        status: 'running',
        lastActivity: '2026-07-15T15:00:00.000Z',
      },
    ]));

    const { checkStuckReviewing } = await import('../deacon-review-unsignaled.js');
    const actions = await checkStuckReviewing();

    expect(actions).toEqual(['Reset stuck reviewing status for PAN-2735 (no active session for 60min)']);
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-2735', expect.objectContaining({ reviewStatus: 'pending' }));
  });
});
