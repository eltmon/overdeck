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
  describeRunningAgents: vi.fn(() => 'counts: work=0 advancing=0 total=0/9'),
  releaseAdvancingSlot: mocks.releaseAdvancingSlot,
  tryReserveAdvancingSlot: mocks.tryReserveAdvancingSlot,
}));

vi.mock('../../lifecycle/archive-planning.js', () => ({
  findWorkspacePath: mocks.findWorkspacePath,
  inferBranchFromWorkspace: (workspacePath: string, issueLower: string) =>
    workspacePath.endsWith('-strike') ? `strike/${issueLower}` : `feature/${issueLower}`,
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
    issueId: 'PAN-3001',
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    updatedAt: '2026-07-07T00:00:00.000Z',
    readyForMerge: false,
    prUrl: 'https://github.com/eltmon/overdeck/pull/3001',
    ...fields,
  } as ReviewStatus;
}

describe('PAN-2341 orphan journal reconcile before re-dispatch', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.loadReviewStatuses.mockReturnValue({});
    mocks.getReviewStatusSync.mockImplementation((issueId: string) => status({ issueId }));
    mocks.getAgentStateSync.mockReturnValue(null);
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repo' });
    mocks.findWorkspacePath.mockReturnValue('/repo/workspaces/feature-pan-3001');
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.getAllProjectSpecialistStatuses.mockResolvedValue([]);
    mocks.getTmuxSessionName.mockImplementation((type: string) => type);
    mocks.tryReserveAdvancingSlot.mockReturnValue(true);
    mocks.shouldSkipDispatchAsMerged.mockResolvedValue({ skip: false });
    mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));
    mocks.spawnRun.mockResolvedValue({ id: 'agent-pan-3001-test' });
    mocks.buildTestRolePrompt.mockReturnValue('test prompt');
    mocks.getWorkspaceStackHealth.mockReturnValue(Effect.succeed({ healthy: true, reasons: [] }));

    const module = await import('../deacon-review-status.js');
    module.stalledReviewConvoyRecoveryState.clear();
  });

  it('reconciles a journaled blocked review verdict and does not spawn a fresh review', async () => {
    const raw = status({ issueId: 'PAN-3001', reviewStatus: 'reviewing' });
    const reconciled = status({ issueId: 'PAN-3001', reviewStatus: 'blocked', reviewNotes: 'blocked from journal' });
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-3001': raw });
    mocks.getReviewStatusSync.mockReturnValue(reconciled);

    const { recoverStalledReviewConvoys } = await import('../deacon-review-status.js');
    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(actions).toEqual([]);
    expect(mocks.getReviewStatusSync).toHaveBeenCalledWith('PAN-3001');
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
  });

  it('re-dispatches a stalled review when no journaled terminal verdict exists', async () => {
    const raw = status({ issueId: 'PAN-3002', reviewStatus: 'reviewing' });
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-3002': raw });
    mocks.getReviewStatusSync.mockReturnValue(raw);
    mocks.findWorkspacePath.mockReturnValue('/repo/workspaces/feature-pan-3002');

    const { recoverStalledReviewConvoys } = await import('../deacon-review-status.js');
    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(actions).toEqual([
      'Re-dispatched stalled review convoy for PAN-3002 (attempt 1/3)',
    ]);
    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledWith({
      issueId: 'PAN-3002',
      workspace: '/repo/workspaces/feature-pan-3002',
      branch: 'feature/pan-3002',
      force: true,
    });
  });

  it('reconciles a journaled passed test verdict and does not spawn a fresh test', async () => {
    const raw = status({ issueId: 'PAN-3003', reviewStatus: 'passed', testStatus: 'testing' });
    const reconciled = status({ issueId: 'PAN-3003', reviewStatus: 'passed', testStatus: 'passed' });
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-3003': raw });
    mocks.getReviewStatusSync.mockReturnValue(reconciled);

    const { checkOrphanedReviewStatuses } = await import('../deacon-review-status.js');
    const actions = await checkOrphanedReviewStatuses();

    expect(actions).toEqual([]);
    expect(mocks.getReviewStatusSync).toHaveBeenCalledWith('PAN-3003');
    expect(mocks.spawnRun).not.toHaveBeenCalled();
  });

  it('re-dispatches an orphaned test when no journaled verdict exists', async () => {
    const raw = status({ issueId: 'PAN-3004', reviewStatus: 'passed', testStatus: 'testing' });
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-3004': raw });
    mocks.getReviewStatusSync.mockReturnValue(raw);
    mocks.getAgentStateSync.mockImplementation((agentId: string) => agentId === 'agent-pan-3004'
      ? { id: agentId, issueId: 'PAN-3004', role: 'work', workspace: '/repo/workspaces/feature-pan-3004', status: 'running' }
      : null);

    const { checkOrphanedReviewStatuses } = await import('../deacon-review-status.js');
    const actions = await checkOrphanedReviewStatuses();

    expect(actions).toEqual([
      'Re-dispatched orphaned test for PAN-3004 via test role agent-pan-3001-test (deacon-orphan-recovery)',
    ]);
    expect(mocks.spawnRun).toHaveBeenCalledWith('PAN-3004', 'test', {
      workspace: '/repo/workspaces/feature-pan-3004',
      prompt: 'test prompt',
    });
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-3004', { testStatus: 'testing' });
  });
});
