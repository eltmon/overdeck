import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

const {
  mockGetProjectSync,
  mockResolveProjectFromIssueSync,
  mockReadIssueRecordSync,
  mockMarkWorkspaceStuck,
  mockSessionExists,
  mockIsAlive,
  mockListSessionNames,
  mockUpdateIssueRecord,
  mockListOverdeckAgentStatesSync,
} = vi.hoisted(() => ({
  mockGetProjectSync: vi.fn(),
  mockResolveProjectFromIssueSync: vi.fn(),
  mockReadIssueRecordSync: vi.fn(),
  mockMarkWorkspaceStuck: vi.fn(),
  mockSessionExists: vi.fn(),
  mockIsAlive: vi.fn(),
  mockListSessionNames: vi.fn(),
  mockUpdateIssueRecord: vi.fn().mockResolvedValue(undefined),
  mockListOverdeckAgentStatesSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  getProjectSync: mockGetProjectSync,
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecordSync: mockReadIssueRecordSync,
}));

vi.mock('../../../../src/lib/pan-dir/record-update.js', () => ({
  updateIssueRecord: mockUpdateIssueRecord,
}));

vi.mock('../../../../src/lib/agents/agent-state-source.js', () => ({
  readFeedbackAgentStates: mockListOverdeckAgentStatesSync,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  markWorkspaceStuck: mockMarkWorkspaceStuck,
  FEEDBACK_DELIVERY_STUCK_REASON: 'feedback_delivery_needs_you',
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  listSessionNames: () => Effect.succeed(mockListSessionNames()),
}));

// PAN-3849 (W32): feedback routing reads liveness from the single oracle. The
// default verdict mirrors the legacy mockSessionExists fixture so existing
// cases keep their meaning; zombie cases override mockIsAlive directly.
vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  isAlive: (agentId: string) => Promise.resolve(mockIsAlive(agentId)),
}));

import {
  resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou,
} from '../../../../src/lib/cloister/feedback-target.js';

vi.setConfig({ testTimeout: 15_000 });

describe('resolveIssueFeedbackTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAlive.mockImplementation((agentId: string) => (
      mockSessionExists(agentId)
        ? { alive: true, paneAlive: true }
        : { alive: false, reason: 'no-session' }
    ));
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'test', projectPath: '/repo' });
    mockGetProjectSync.mockReturnValue({ name: 'Test', path: '/repo' });
    mockListSessionNames.mockReturnValue([]);
    mockListOverdeckAgentStatesSync.mockReturnValue([]);
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

  it('PAN-3849 AC4: a remain-on-exit zombie pane is not a live feedback target', async () => {
    // The tmux session exists (has-session passes) but the harness process is
    // gone from the pane — the oracle says pane-dead / runtime-missing, and
    // routing must fall through to resurrection instead of pasting feedback
    // into the dead shell (pipeline-reliability-review F12, last bullet).
    mockIsAlive.mockImplementation((agentId: string) => (
      agentId === 'agent-pan-2214'
        ? { alive: false, reason: 'pane-dead' }
        : { alive: false, reason: 'no-session' }
    ));

    const target = await resolveIssueFeedbackTarget('PAN-2214');

    expect(target).toEqual({
      needsYou: true,
      reason: expect.stringContaining('No live feedback target for PAN-2214'),
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

  it('falls back to a live unregistered slot session and self-heals the record', async () => {
    mockListSessionNames.mockReturnValue(['agent-pan-2214-slot-3']);
    mockSessionExists.mockImplementation((agentId: string) => agentId === 'agent-pan-2214-slot-3');

    await expect(resolveIssueFeedbackTarget('PAN-2214', { itemId: 'item-c' })).resolves.toEqual({
      agentId: 'agent-pan-2214-slot-3',
    });

    expect(mockUpdateIssueRecord).toHaveBeenCalledWith(
      { name: 'Test', path: '/repo' },
      'PAN-2214',
      expect.any(Function),
    );
  });

  it('routes feedback to a live agents-table work session missing from slot assignments', async () => {
    const registeredAgentId = 'agent-pan-2214-slot-7';
    const revive = vi.fn().mockResolvedValue(false);
    mockListOverdeckAgentStatesSync.mockReturnValue([
      { id: registeredAgentId, issueId: 'PAN-2214', role: 'work' },
    ]);
    mockSessionExists.mockImplementation((agentId: string) => agentId === registeredAgentId);

    await expect(resolveIssueFeedbackTarget('PAN-2214', {
      revivePipelinePausedAgent: revive,
    })).resolves.toEqual({ agentId: registeredAgentId });

    expect(revive).not.toHaveBeenCalled();
    expect(mockMarkWorkspaceStuck).not.toHaveBeenCalled();
  });

  it('skips a live convoy reviewer row and routes to the following work row', async () => {
    const reviewerId = 'agent-pan-2214-review-security';
    const workAgentId = 'agent-pan-2214-slot-7';
    const revive = vi.fn().mockResolvedValue(false);
    mockListOverdeckAgentStatesSync.mockReturnValue([
      { id: reviewerId, issueId: 'PAN-2214', role: 'review' },
      { id: workAgentId, issueId: 'PAN-2214', role: 'work' },
    ]);
    mockSessionExists.mockImplementation((agentId: string) =>
      agentId === reviewerId || agentId === workAgentId);

    await expect(resolveIssueFeedbackTarget('PAN-2214', {
      revivePipelinePausedAgent: revive,
    })).resolves.toEqual({ agentId: workAgentId });

    expect(revive).not.toHaveBeenCalled();
  });

  it.each([
    ['agent-pan-2214-review', 'review'],
    ['agent-pan-2214-test', 'test'],
    ['agent-pan-2214-ship', 'ship'],
    ['agent-pan-2214-plan', 'plan'],
    ['agent-pan-2214-strike', 'strike'],
    ['agent-pan-2214-knowledge', 'knowledge'],
  ])('does not route feedback to the non-work %s session', async (registeredAgentId, role) => {
    const revive = vi.fn().mockResolvedValue(false);
    mockListOverdeckAgentStatesSync.mockReturnValue([
      { id: registeredAgentId, issueId: 'PAN-2214', role },
    ]);
    mockSessionExists.mockImplementation((agentId: string) => agentId === registeredAgentId);

    const target = await resolveIssueFeedbackTarget('PAN-2214', {
      revivePipelinePausedAgent: revive,
    });

    expect(target).toMatchObject({ needsYou: true });
    expect(target).not.toEqual({ agentId: registeredAgentId });
  });

  it('surfaces needs-you feedback as a stuck workspace marker', async () => {
    await surfaceIssueFeedbackNeedsYou('PAN-2214', 'No live feedback target for PAN-2214', {
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
