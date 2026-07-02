import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

const {
  mockGetProjectSync,
  mockResolveProjectFromIssueSync,
  mockReadIssueRecordSync,
  mockMarkWorkspaceStuck,
  mockSessionExists,
} = vi.hoisted(() => ({
  mockGetProjectSync: vi.fn(),
  mockResolveProjectFromIssueSync: vi.fn(),
  mockReadIssueRecordSync: vi.fn(),
  mockMarkWorkspaceStuck: vi.fn(),
  mockSessionExists: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  getProjectSync: mockGetProjectSync,
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecordSync: mockReadIssueRecordSync,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  markWorkspaceStuck: mockMarkWorkspaceStuck,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExists: (agentId: string) => Effect.succeed(Boolean(mockSessionExists(agentId))),
}));

import {
  resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou,
} from '../../../../src/lib/cloister/feedback-target.js';

describe('resolveIssueFeedbackTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'test', projectPath: '/repo' });
    mockGetProjectSync.mockReturnValue({ name: 'Test', path: '/repo' });
    mockReadIssueRecordSync.mockReturnValue({
      issueId: 'PAN-2214',
      schemaVersion: 2,
      pipeline: {
        issueId: 'PAN-2214',
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
      closeOut: {
        usage: { byStage: {}, totals: {} },
        merges: [],
        ranOn: 'test-host',
      },
      swarm: {
        slotAssignments: [
          { slotIndex: 1, itemId: 'item-a', agentId: 'agent-pan-2214-slot-1' },
          { slotIndex: 2, itemId: 'item-b', agentId: 'agent-pan-2214-slot-2' },
        ],
      },
    });
  });

  it('keeps existing behavior for a live whole-issue agent', async () => {
    mockSessionExists.mockImplementation((agentId: string) => agentId === 'agent-pan-2214');

    await expect(resolveIssueFeedbackTarget('PAN-2214')).resolves.toEqual({
      agentId: 'agent-pan-2214',
    });
    expect(mockReadIssueRecordSync).not.toHaveBeenCalled();
  });

  it('routes item-specific feedback to the assigned live slot agent', async () => {
    mockSessionExists.mockImplementation((agentId: string) => agentId === 'agent-pan-2214-slot-2');

    await expect(resolveIssueFeedbackTarget('PAN-2214', { itemId: 'item-b' })).resolves.toEqual({
      agentId: 'agent-pan-2214-slot-2',
    });
  });

  it('falls back to the first live slot when no item-specific slot is available', async () => {
    mockSessionExists.mockImplementation((agentId: string) => agentId === 'agent-pan-2214-slot-1');

    await expect(resolveIssueFeedbackTarget('PAN-2214', { itemId: 'item-missing' })).resolves.toEqual({
      agentId: 'agent-pan-2214-slot-1',
    });
  });

  it('returns needs-you when no whole-issue or slot session is live', async () => {
    mockSessionExists.mockReturnValue(false);

    const target = await resolveIssueFeedbackTarget('PAN-2214', { itemId: 'item-b' });

    expect(target).toEqual({
      needsYou: true,
      reason: expect.stringContaining('No live feedback target for PAN-2214 for item item-b'),
    });
  });

  it('surfaces needs-you feedback as a stuck workspace marker', () => {
    surfaceIssueFeedbackNeedsYou('PAN-2214', 'No live feedback target for PAN-2214', {
      specialist: 'test-agent',
      feedbackPath: '/repo/.pan/feedback/001-test-agent-failed.md',
    });

    expect(mockMarkWorkspaceStuck).toHaveBeenCalledWith('PAN-2214', 'feedback_delivery_needs_you', {
      reason: 'No live feedback target for PAN-2214',
      specialist: 'test-agent',
      feedbackPath: '/repo/.pan/feedback/001-test-agent-failed.md',
    });
  });
});
