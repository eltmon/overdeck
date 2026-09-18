import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

const {
  mockGetProjectSync,
  mockResolveProjectFromIssueSync,
  mockReadSlotAssignments,
  mockEmitActivityEntrySync,
  mockSessionExists,
  mockIsAlive,
  mockListSessionNames,
  mockListOverdeckAgentStatesSync,
} = vi.hoisted(() => ({
  mockGetProjectSync: vi.fn(),
  mockResolveProjectFromIssueSync: vi.fn(),
  mockReadSlotAssignments: vi.fn(),
  mockEmitActivityEntrySync: vi.fn(),
  mockSessionExists: vi.fn(),
  mockIsAlive: vi.fn(),
  mockListSessionNames: vi.fn(),
  mockListOverdeckAgentStatesSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  getProjectSync: mockGetProjectSync,
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/cloister/deacon-swarm-record.js', () => ({
  readSwarmSlotAssignments: mockReadSlotAssignments,
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: mockEmitActivityEntrySync,
}));

vi.mock('../../../../src/lib/agents/agent-state-source.js', () => ({
  readFeedbackAgentStates: mockListOverdeckAgentStatesSync,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  listSessionNames: () => Effect.succeed(mockListSessionNames()),
}));

// PAN-3849 (W32): feedback routing reads liveness from the single oracle. The
// default verdict mirrors the legacy mockSessionExists fixture so existing
// cases keep their meaning; zombie cases override mockIsAlive directly.
vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  isAlive: (agentId: string) => Promise.resolve(mockIsAlive(agentId)),
  // Mirrors the real isConfirmedDead: only a confirmed absence is death.
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
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
    mockReadSlotAssignments.mockReturnValue([
      { slotIndex: 1, itemId: 'item-a', agentId: 'agent-pan-2214-slot-1' },
      { slotIndex: 2, itemId: 'item-b', agentId: 'agent-pan-2214-slot-2' },
    ]);
  });

  it('keeps existing behavior for a live whole-issue agent', async () => {
    mockSessionExists.mockImplementation((agentId: string) => agentId === 'agent-pan-2214');

    await expect(resolveIssueFeedbackTarget('PAN-2214')).resolves.toEqual({
      agentId: 'agent-pan-2214',
    });
    expect(mockReadSlotAssignments).not.toHaveBeenCalled();
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

  it('falls back to a live slot session the ledger does not name, writing nothing back', async () => {
    mockListSessionNames.mockReturnValue(['agent-pan-2214-slot-3']);
    mockSessionExists.mockImplementation((agentId: string) => agentId === 'agent-pan-2214-slot-3');

    await expect(resolveIssueFeedbackTarget('PAN-2214', { itemId: 'item-c' })).resolves.toEqual({
      agentId: 'agent-pan-2214-slot-3',
    });
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
    expect(mockEmitActivityEntrySync).not.toHaveBeenCalled();
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

  it('announces needs-you on the activity stream instead of writing a stuck flag', async () => {
    await surfaceIssueFeedbackNeedsYou('PAN-2214', 'No live feedback target for PAN-2214', {
      specialist: 'test-agent',
      feedbackPath: '/repo/.pan/feedback/001-test-agent-failed.md',
    });

    expect(mockEmitActivityEntrySync).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'warn',
      issueId: 'PAN-2214',
      message: 'PAN-2214 needs you: No live feedback target for PAN-2214',
    }));
  });
});
