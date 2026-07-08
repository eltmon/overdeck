/**
 * PAN-2507 dispatch-site wiring lock.
 *
 * Exercises a real advancing-dispatch site (`recoverStalledReviewConvoys`, the
 * stalled-review-convoy path) with the advancing ceiling reached
 * (`tryReserveAdvancingSlot` → false) and asserts the wired composition
 * `!tryReserveAdvancingSlot() && !(await tryYieldForAdvancingDispatch(...))`:
 *   - yield succeeds ⇒ the dispatch proceeds within the same patrol (AC-4);
 *   - yield fails    ⇒ the site defers exactly as before (AC-1 / AC-4).
 *
 * `tryYieldForAdvancingDispatch` is mocked here; its internal FR-1/FR-6c
 * behavior is covered in preemption.test.ts.
 */

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../review-status.js';

const mocks = vi.hoisted(() => ({
  loadReviewStatuses: vi.fn(),
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  getAgentStateSync: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  listRunningAgents: vi.fn(),
  markWorkspaceStuck: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  findWorkspacePath: vi.fn(),
  isIssueClosed: vi.fn(),
  sessionExistsSync: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn(),
  getTmuxSessionName: vi.fn(),
  tryReserveAdvancingSlot: vi.fn(),
  releaseAdvancingSlot: vi.fn(),
  shouldSkipDispatchAsMerged: vi.fn(),
  spawnReviewRoleForIssue: vi.fn(),
  spawnRun: vi.fn(),
  buildTestRolePrompt: vi.fn(),
  getWorkspaceStackHealth: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  logDeaconEventSync: vi.fn(),
  recordDeaconNudge: vi.fn(),
  tryYieldForAdvancingDispatch: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: mocks.loadReviewStatuses,
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
  listRunningAgents: mocks.listRunningAgents,
  spawnRun: mocks.spawnRun,
}));

vi.mock('../../overdeck/agents.js', () => ({
  listAllAgentsSync: vi.fn(() => []),
}));

vi.mock('../../overdeck/review-status-sync.js', () => ({
  markWorkspaceStuck: mocks.markWorkspaceStuck,
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../tmux.js', () => ({
  isPaneDead: vi.fn(() => false),
  sessionExistsSync: mocks.sessionExistsSync,
}));

vi.mock('../specialists.js', () => ({
  getAllProjectSpecialistStatuses: mocks.getAllProjectSpecialistStatuses,
  getTmuxSessionName: mocks.getTmuxSessionName,
}));

vi.mock('../concurrency.js', () => ({
  describeRunningAgents: vi.fn(() => 'counts: work=6 advancing=3 total=9/9'),
  releaseAdvancingSlot: mocks.releaseAdvancingSlot,
  tryReserveAdvancingSlot: mocks.tryReserveAdvancingSlot,
}));

vi.mock('../preemption.js', () => ({
  tryYieldForAdvancingDispatch: mocks.tryYieldForAdvancingDispatch,
}));

vi.mock('../../lifecycle/archive-planning.js', () => ({
  findWorkspacePath: mocks.findWorkspacePath,
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

vi.mock('../merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: mocks.shouldSkipDispatchAsMerged,
}));

vi.mock('../review-agent.js', () => ({
  spawnReviewRoleForIssue: mocks.spawnReviewRoleForIssue,
}));

vi.mock('../test-agent-queue.js', () => ({
  buildTestRolePrompt: mocks.buildTestRolePrompt,
}));

vi.mock('../../workspace/stack-health.js', () => ({
  getWorkspaceStackHealth: mocks.getWorkspaceStackHealth,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: mocks.logDeaconEventSync,
}));

vi.mock('../deacon-nudge-log.js', () => ({
  recordDeaconNudge: mocks.recordDeaconNudge,
}));

function status(fields: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3002',
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    updatedAt: '2026-07-07T00:00:00.000Z',
    readyForMerge: false,
    prUrl: 'https://github.com/eltmon/overdeck/pull/3002',
    ...fields,
  } as ReviewStatus;
}

describe('PAN-2507 stalled-review-convoy dispatch site wiring', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getAgentStateSync.mockReturnValue(null);
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repo' });
    mocks.findWorkspacePath.mockReturnValue('/repo/workspaces/feature-pan-3002');
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.shouldSkipDispatchAsMerged.mockResolvedValue({ skip: false });
    mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));

    const raw = status({ issueId: 'PAN-3002', reviewStatus: 'reviewing' });
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-3002': raw });
    mocks.getReviewStatusSync.mockReturnValue(raw);

    const module = await import('../deacon-review-status.js');
    module.stalledReviewConvoyRecoveryState.clear();
  });

  it('at the ceiling, a successful yield lets the review convoy dispatch (AC-4)', async () => {
    mocks.tryReserveAdvancingSlot.mockReturnValue(false); // ceiling reached
    mocks.tryYieldForAdvancingDispatch.mockResolvedValue(true); // yield freed a slot

    const { recoverStalledReviewConvoys } = await import('../deacon-review-status.js');
    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(mocks.tryYieldForAdvancingDispatch).toHaveBeenCalledWith('review', 'PAN-3002');
    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalled();
    expect(actions).toContain('Re-dispatched stalled review convoy for PAN-3002 (attempt 1/3)');
  });

  it('at the ceiling with no eligible victim, the site defers exactly as before (AC-1)', async () => {
    mocks.tryReserveAdvancingSlot.mockReturnValue(false); // ceiling reached
    mocks.tryYieldForAdvancingDispatch.mockResolvedValue(false); // no yield

    const { recoverStalledReviewConvoys } = await import('../deacon-review-status.js');
    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(mocks.tryYieldForAdvancingDispatch).toHaveBeenCalledWith('review', 'PAN-3002');
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(actions).toContain(
      'Stalled review convoy for PAN-3002: deferring — advancing-role concurrency ceiling reached',
    );
  });

  it('when a slot is free, the yield path is never consulted (AC-1 short-circuit)', async () => {
    mocks.tryReserveAdvancingSlot.mockReturnValue(true); // slot available

    const { recoverStalledReviewConvoys } = await import('../deacon-review-status.js');
    await recoverStalledReviewConvoys(async () => 'in_review');

    expect(mocks.tryYieldForAdvancingDispatch).not.toHaveBeenCalled();
    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalled();
  });
});
