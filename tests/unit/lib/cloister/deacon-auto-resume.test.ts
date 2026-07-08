import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

const assessMemoryPressureMock = vi.fn();
const estimateFootprintMock = vi.fn();
const canAdmitMock = vi.fn();
const logDeaconEventSyncMock = vi.fn();
const getAgentStateSyncMock = vi.fn();
const listAllAgentsMock = vi.fn();
const getBootReconciliationPendingHoldSetMock = vi.fn();
const getBootReconciliationHeldResumeSetMock = vi.fn();
const listBootReconciliationCandidatesMock = vi.fn();
const getBootReconciliationStateMock = vi.fn();
const bootReconciliationSkipReasonMock = vi.fn();
const isIssueClosedMock = vi.fn();
const sessionExistsMock = vi.fn();
const getReviewStatusSyncMock = vi.fn();
const getAgentRuntimeStateSyncMock = vi.fn();
const getConcurrencyLimitsMock = vi.fn();
const countRunningAgentsMock = vi.fn();
const workResumeSlotsAvailableMock = vi.fn();
const resolveProjectFromIssueSyncMock = vi.fn();
const resumeAgentMock = vi.fn();

vi.mock('node:os', () => ({
  cpus: () => Array.from({ length: 8 }, () => ({})),
  loadavg: () => [0.5, 0.5, 0.5],
}));

vi.mock('../../../../src/lib/cloister/memory-governor.js', () => ({
  assessMemoryPressure: (...args: unknown[]) => assessMemoryPressureMock(...args),
  estimateFootprint: (...args: unknown[]) => estimateFootprintMock(...args),
  canAdmit: (...args: unknown[]) => canAdmitMock(...args),
}));

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logDeaconEventSync: (...args: unknown[]) => logDeaconEventSyncMock(...args),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/concurrency.js', () => ({
  getConcurrencyLimits: (...args: unknown[]) => getConcurrencyLimitsMock(...args),
  countRunningAgents: (...args: unknown[]) => countRunningAgentsMock(...args),
  workResumeSlotsAvailable: (...args: unknown[]) => workResumeSlotsAvailableMock(...args),
}));

vi.mock('../../../../src/lib/cloister/boot-reconciliation.js', () => ({
  getBootReconciliationHeldResumeSet: (...args: unknown[]) => getBootReconciliationHeldResumeSetMock(...args),
  getBootReconciliationPendingHoldSet: (...args: unknown[]) => getBootReconciliationPendingHoldSetMock(...args),
  listBootReconciliationCandidates: (...args: unknown[]) => listBootReconciliationCandidatesMock(...args),
}));

vi.mock('../../../../src/lib/cloister/boot-reconciliation-predicates.js', () => ({
  bootReconciliationSkipReason: (...args: unknown[]) => bootReconciliationSkipReasonMock(...args),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: (...args: unknown[]) => isIssueClosedMock(...args),
}));

vi.mock('../../../../src/lib/overdeck/agents.js', () => ({
  listAllAgentsSync: (...args: unknown[]) => listAllAgentsMock(...args),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (...args: unknown[]) => resolveProjectFromIssueSyncMock(...args),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: (...args: unknown[]) => getReviewStatusSyncMock(...args),
}));

vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({
  getBootReconciliationState: (...args: unknown[]) => getBootReconciliationStateMock(...args),
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExists: (...args: unknown[]) => sessionExistsMock(...args),
  killSession: vi.fn(),
  listPaneValues: vi.fn(),
  listSessionNames: vi.fn(),
  sessionExistsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: (...args: unknown[]) => getAgentStateSyncMock(...args),
  getAgentRuntimeStateSync: (...args: unknown[]) => getAgentRuntimeStateSyncMock(...args),
  getAgentDir: (id: string) => `/tmp/nonexistent-test-agent-dir/${id}`,
  getAgentState: vi.fn(() => Effect.succeed(null)),
  listAgentStates: vi.fn(() => []),
  markAgentRunningState: vi.fn(),
  recordAgentFailure: vi.fn(() => Effect.succeed(null)),
  resetAgentFailureCount: vi.fn(),
  resumeAgent: (...args: unknown[]) => resumeAgentMock(...args),
  saveAgentState: vi.fn(async () => {}),
  saveAgentStateSync: vi.fn(),
  buildDefaultResumeContinueMessage: vi.fn(),
  deliverInitialPromptWithRetry: vi.fn(async () => {}),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/transcript-landing.js', () => ({
  captureTranscriptUserRecordSnapshot: vi.fn(),
}));

vi.mock('../../../../src/lib/beads-query.js', () => ({
  queryReadyBeadsByIssueLabels: vi.fn(() => []),
  resolveBeadsQueryRoot: vi.fn(() => '/tmp'),
}));

vi.mock('../../../../src/lib/cloister/agent-grace.js', () => ({
  isStartingWithinGrace: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/cloister/agent-idle.js', () => ({
  isAgentIdleForNudge: vi.fn(() => false),
}));

import {
  autoResumeStoppedWorkAgents,
  applyBootReconciliationDecision,
  handleAgentStoppedEvent,
} from '../../../../src/lib/cloister/deacon-auto-resume.js';

const GIB = 1024 ** 3;
const deps = { notifyAgentStopped: vi.fn(), notifyAgentStatusChanged: vi.fn() };

function stoppedWorkAgent(id: string) {
  return {
    id,
    issueId: 'PAN-9999',
    workspace: '/tmp/nonexistent-workspace',
    role: 'work' as const,
    model: 'test-model',
    status: 'stopped' as const,
    startedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getConcurrencyLimitsMock.mockReturnValue({ maxWorkAgents: 6, reservedAdvancingSlots: 3, reservedSwarmSlots: 3, totalCeiling: 9, exemptOperatorStarted: true });
  countRunningAgentsMock.mockReturnValue({ work: 0, advancing: 0, swarm: 0, total: 0 });
  workResumeSlotsAvailableMock.mockReturnValue(5);
  getBootReconciliationPendingHoldSetMock.mockReturnValue(new Set());
  getBootReconciliationHeldResumeSetMock.mockReturnValue(new Set());
  bootReconciliationSkipReasonMock.mockReturnValue(null);
  isIssueClosedMock.mockResolvedValue(false);
  sessionExistsMock.mockReturnValue(Effect.succeed(false));
  getReviewStatusSyncMock.mockReturnValue(undefined);
  getAgentRuntimeStateSyncMock.mockReturnValue({ state: 'running' });
  resolveProjectFromIssueSyncMock.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo' });
  estimateFootprintMock.mockResolvedValue(2 * GIB);
  canAdmitMock.mockReturnValue(true);
  resumeAgentMock.mockResolvedValue({ success: false, error: 'not reached' });
});

describe('autoResumeStoppedWorkAgents — memory gate (PAN-2500 wire-deacon-gate)', () => {
  it('resumes zero agents and logs the memory gate when band is soft', async () => {
    listAllAgentsMock.mockReturnValue([stoppedWorkAgent('agent-mem-test-1')]);
    getAgentStateSyncMock.mockReturnValue(stoppedWorkAgent('agent-mem-test-1'));
    assessMemoryPressureMock.mockResolvedValue({ band: 'soft', availableBytes: 3 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } });

    const resumed = await autoResumeStoppedWorkAgents(deps);

    expect(resumed).toEqual([]);
    const memoryLog = logDeaconEventSyncMock.mock.calls.find(([msg]) => String(msg).includes('memory gate'));
    expect(memoryLog).toBeDefined();
    expect(String(memoryLog![0])).toContain('availMB=');
  });

  it('proceeds to resume candidates when band is ok (behavior unchanged)', async () => {
    listAllAgentsMock.mockReturnValue([]);
    assessMemoryPressureMock.mockResolvedValue({ band: 'ok', availableBytes: 20 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } });

    const resumed = await autoResumeStoppedWorkAgents(deps);
    expect(resumed).toEqual([]);
    const memoryDeferLog = logDeaconEventSyncMock.mock.calls.find(([msg]) => String(msg).includes('memory gate'));
    expect(memoryDeferLog).toBeUndefined();
  });
});

describe('applyBootReconciliationDecision — memory gate (PAN-2500 wire-deacon-gate)', () => {
  it('defers all candidates and records deferred-memory when band is hard', async () => {
    getBootReconciliationStateMock.mockReturnValue({ decision: 'resume_all', bootId: 'boot-test', perAgent: {} });
    listBootReconciliationCandidatesMock.mockReturnValue([{ id: 'agent-boot-1', issueId: 'PAN-9999' }]);
    assessMemoryPressureMock.mockResolvedValue({ band: 'hard', availableBytes: 1 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } });

    const result = await applyBootReconciliationDecision(deps);

    expect(result.resumed).toEqual([]);
    expect(result.deferred).toBe(1);
    expect(result.outcomes.some((o) => o.reason === 'deferred-memory')).toBe(true);
  });

  it('paces resume_all with settle-window memory checks and defers the remaining candidates on pressure', async () => {
    vi.useFakeTimers();
    try {
      const candidates = Array.from({ length: 20 }, (_, index) => stoppedWorkAgent(`agent-boot-${index + 1}`));
      getBootReconciliationStateMock.mockReturnValue({ decision: 'resume_all', bootId: 'boot-paced', perAgent: {} });
      listBootReconciliationCandidatesMock.mockReturnValue(candidates);
      getAgentStateSyncMock.mockImplementation((agentId: string) => candidates.find((candidate) => candidate.id === agentId));
      workResumeSlotsAvailableMock.mockReturnValue(20);
      resumeAgentMock.mockResolvedValue({ success: true });
      assessMemoryPressureMock
        .mockResolvedValueOnce({ band: 'ok', availableBytes: 20 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } })
        .mockResolvedValueOnce({ band: 'ok', availableBytes: 18 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } })
        .mockResolvedValueOnce({ band: 'ok', availableBytes: 16 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } })
        .mockResolvedValueOnce({ band: 'soft', availableBytes: 3 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } });

      const resultPromise = applyBootReconciliationDecision(deps);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.resumed).toEqual(['agent-boot-1', 'agent-boot-2', 'agent-boot-3']);
      expect(result.deferred).toBe(17);
      expect(result.outcomes.filter((outcome) => outcome.reason === 'resumed')).toHaveLength(3);
      expect(result.outcomes.filter((outcome) => outcome.reason === 'deferred-memory')).toHaveLength(17);
      expect(assessMemoryPressureMock).toHaveBeenCalledTimes(4);
      expect(estimateFootprintMock).toHaveBeenCalledTimes(3);
      expect(canAdmitMock).toHaveBeenCalledTimes(3);
      expect(resumeAgentMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('handleAgentStoppedEvent — memory gate (PAN-2500 wire-deacon-gate)', () => {
  it('defers (returns null) when band is soft, with global gates active', async () => {
    getAgentStateSyncMock.mockReturnValue(stoppedWorkAgent('agent-reactive-1'));
    assessMemoryPressureMock.mockResolvedValue({ band: 'soft', availableBytes: 3 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } });

    const result = await handleAgentStoppedEvent('agent-reactive-1', {}, deps);

    expect(result).toBeNull();
    const memoryLog = logDeaconEventSyncMock.mock.calls.find(([msg]) => String(msg).includes('memory gate'));
    expect(memoryLog).toBeDefined();
  });

  it('does not consult the memory gate when skipGlobalGates is true (patrol-driven call)', async () => {
    getAgentStateSyncMock.mockReturnValue(stoppedWorkAgent('agent-reactive-2'));
    assessMemoryPressureMock.mockResolvedValue({ band: 'hard', availableBytes: 1 * GIB, thresholds: { warningBytes: 4 * GIB, criticalBytes: 2 * GIB } });

    await handleAgentStoppedEvent('agent-reactive-2', { skipGlobalGates: true }, deps);

    expect(assessMemoryPressureMock).not.toHaveBeenCalled();
  });
});
