import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markAdvancingSessionStopped,
  reconcileInFlightJournals,
  type AdvancingSelfHealDeps,
} from '../advancing-selfheal.js';
import {
  isIdlePastThreshold,
  selectNonMergedTerminalAdvancingSessions,
  type ReapableStatus,
} from '../reap-terminal-sessions.js';
import type { AgentState } from '../../agents.js';
import type { ReviewStatus } from '../../review-status.js';

const mocks = vi.hoisted(() => ({
  loadReviewStatuses: vi.fn(),
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  getAgentStateSync: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  saveAgentStateSync: vi.fn(),
  markAgentStoppedState: vi.fn(),
  listRunningAgents: vi.fn(),
  spawnRun: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  findWorkspacePath: vi.fn(),
  isIssueClosed: vi.fn(),
  sessionExistsSync: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn(),
  getTmuxSessionName: vi.fn(),
  tryReserveAdvancingSlot: vi.fn(),
  releaseAdvancingSlot: vi.fn(),
  shouldSkipDispatchAsMerged: vi.fn(),
  buildTestRolePrompt: vi.fn(),
  getWorkspaceStackHealth: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: mocks.loadReviewStatuses,
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
  saveAgentStateSync: mocks.saveAgentStateSync,
  markAgentStoppedState: mocks.markAgentStoppedState,
  listRunningAgents: mocks.listRunningAgents,
  spawnRun: mocks.spawnRun,
}));

vi.mock('../../overdeck/agents.js', () => ({
  listAllAgentsSync: vi.fn(() => []),
}));

vi.mock('../../overdeck/review-status-sync.js', () => ({
  markWorkspaceStuck: vi.fn(),
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
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

vi.mock('../merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: mocks.shouldSkipDispatchAsMerged,
}));

vi.mock('../test-agent-queue.js', () => ({
  buildTestRolePrompt: mocks.buildTestRolePrompt,
}));

vi.mock('../../workspace/stack-health.js', () => ({
  getWorkspaceStackHealth: mocks.getWorkspaceStackHealth,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: vi.fn(),
}));

vi.mock('../deacon-nudge-log.js', () => ({
  recordDeaconNudge: vi.fn(),
}));

function status(fields: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-4001',
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    updatedAt: '2026-07-07T12:00:00.000Z',
    readyForMerge: false,
    prUrl: 'https://github.com/eltmon/overdeck/pull/4001',
    ...fields,
  } as ReviewStatus;
}

function agent(fields: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-4001-review',
    issueId: 'PAN-4001',
    workspace: '/repo/workspaces/feature-pan-4001',
    role: 'review',
    model: 'test-model',
    status: 'running',
    startedAt: '2026-07-07T12:00:00.000Z',
    ...fields,
  };
}

describe('PAN-2341 ceiling self-heal regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T12:10:00.000Z'));
    vi.clearAllMocks();

    mocks.loadReviewStatuses.mockReturnValue({});
    mocks.getReviewStatusSync.mockImplementation((issueId: string) => status({ issueId }));
    mocks.getAgentStateSync.mockReturnValue(null);
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.saveAgentStateSync.mockImplementation(() => undefined);
    mocks.markAgentStoppedState.mockImplementation((state: AgentState) => ({ ...state, status: 'stopped' }));
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repo' });
    mocks.findWorkspacePath.mockImplementation((_projectPath: string, issueLower: string) => `/repo/workspaces/feature-${issueLower}`);
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.getAllProjectSpecialistStatuses.mockResolvedValue([]);
    mocks.getTmuxSessionName.mockImplementation((type: string) => type);
    mocks.tryReserveAdvancingSlot.mockReturnValue(true);
    mocks.shouldSkipDispatchAsMerged.mockResolvedValue({ skip: false });
    mocks.spawnRun.mockResolvedValue({ id: 'agent-pan-4002-test' });
    mocks.buildTestRolePrompt.mockReturnValue('test prompt');
    mocks.getWorkspaceStackHealth.mockReturnValue(Effect.succeed({ healthy: true, reasons: [] }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconciles a journaled review verdict, reaps the idle advancing session, and flips its row stopped', async () => {
    const reviewRows: Record<string, ReviewStatus> = {
      'PAN-4001': status({ issueId: 'PAN-4001', reviewStatus: 'reviewing' }),
    };
    const agentRows = new Map<string, AgentState>([
      ['agent-pan-4001-review', agent()],
    ]);
    const aliveSessions = new Set(['agent-pan-4001-review']);
    const killedSessions: string[] = [];

    const countAdvancing = () => [...agentRows.values()].filter((row) => row.role === 'review' && row.status === 'running').length;
    expect(countAdvancing()).toBe(1);

    const reconcileDeps: AdvancingSelfHealDeps = {
      loadReviewStatuses: () => ({ ...reviewRows }),
      getReviewStatusSync: vi.fn((issueId: string) => {
        reviewRows[issueId] = status({
          issueId,
          reviewStatus: 'passed',
          updatedAt: '2026-07-07T12:09:00.000Z',
        });
        return reviewRows[issueId];
      }),
      listSessionNames: vi.fn(async () => [...aliveSessions]),
      getAgentStateSync: vi.fn((session: string) => agentRows.get(session) ?? null),
      saveAgentStateSync: vi.fn((state: AgentState) => { agentRows.set(state.id, state); }),
      markAgentStoppedState: vi.fn((state: AgentState) => ({ ...state, status: 'stopped' as const })),
      warn: vi.fn(),
    };

    const reconcileActions = await reconcileInFlightJournals(reconcileDeps);
    const candidates = selectNonMergedTerminalAdvancingSessions(reviewRows, [...aliveSessions]);
    for (const session of candidates) {
      if (!isIdlePastThreshold({
        state: 'idle',
        lastActivity: '2026-07-07T12:00:00.000Z',
      }, 10 * 60 * 1000)) continue;
      killedSessions.push(session);
      aliveSessions.delete(session);
      markAdvancingSessionStopped(session, reconcileDeps);
    }

    expect(reconcileActions).toEqual(['Reconciled journaled advancing verdict for PAN-4001']);
    expect(reviewRows['PAN-4001'].reviewStatus).toBe('passed');
    expect(killedSessions).toEqual(['agent-pan-4001-review']);
    expect(agentRows.get('agent-pan-4001-review')?.status).toBe('stopped');
    expect(countAdvancing()).toBe(0);
  });

  it('re-dispatches a stopped mid-stage test with no verdict during orphan recovery', async () => {
    const raw = status({ issueId: 'PAN-4002', reviewStatus: 'passed', testStatus: 'testing' });
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-4002': raw });
    mocks.getReviewStatusSync.mockReturnValue(raw);
    mocks.getAgentStateSync.mockImplementation((agentId: string) => agentId === 'agent-pan-4002'
      ? agent({
        id: agentId,
        issueId: 'PAN-4002',
        role: 'work',
        workspace: '/repo/workspaces/feature-pan-4002',
      })
      : null);

    const { checkOrphanedReviewStatuses } = await import('../deacon-review-status.js');
    const actions = await checkOrphanedReviewStatuses();

    expect(actions).toEqual([
      'Re-dispatched orphaned test for PAN-4002 via test role agent-pan-4002-test (deacon-orphan-recovery)',
    ]);
    expect(mocks.spawnRun).toHaveBeenCalledWith('PAN-4002', 'test', {
      workspace: '/repo/workspaces/feature-pan-4002',
      prompt: 'test prompt',
      startedBy: 'deacon:orphan-test-recovery',
    });
  });

  it('uses virtual time for the idle threshold without real waits', async () => {
    const runtime = {
      state: 'idle',
      lastActivity: '2026-07-07T12:00:00.000Z',
    };

    vi.setSystemTime(new Date('2026-07-07T12:09:30.000Z'));
    expect(isIdlePastThreshold(runtime, 10 * 60 * 1000)).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(isIdlePastThreshold(runtime, 10 * 60 * 1000)).toBe(true);
  });
});
