import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';

const mocks = vi.hoisted(() => ({
  agentRoot: '',
  getReviewStatusSync: vi.fn(),
  messageAgent: vi.fn(),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentDir: (agentId: string) => join(mocks.agentRoot, agentId),
  getAgentRuntimeStateSync: vi.fn(),
  getAgentState: vi.fn(() => Effect.succeed(null)),
  getAgentStateSync: vi.fn(),
  listAgentStates: vi.fn(() => [{
    id: 'agent-pan-2796',
    issueId: 'PAN-2796',
    workspace: '/tmp/pan-2796-workspace',
    role: 'work',
    model: 'test-model',
    status: 'running',
    startedAt: '2026-09-09T00:00:00.000Z',
  }]),
  markAgentRunningState: vi.fn(),
  messageAgent: mocks.messageAgent,
  recordAgentFailure: vi.fn(() => Effect.succeed(null)),
  resetAgentFailureCount: vi.fn(),
  resumeAgent: vi.fn(),
  saveAgentState: vi.fn(() => Effect.void),
  saveAgentStateSync: vi.fn(),
  stopAgent: vi.fn(),
  deliverInitialPromptWithRetry: vi.fn(),
}));

vi.mock('../../../../src/lib/overdeck/agents.js', () => ({
  listAllAgentsSync: vi.fn(() => []),
  RETAINED_TRANSCRIPTS_PHASE: 'retained-transcripts',
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  killSession: vi.fn(),
  listPaneValues: vi.fn(),
  listSessionNames: vi.fn(),
  sessionExists: vi.fn(() => Effect.succeed(true)),
  sessionExistsSync: vi.fn(() => true),
}));

vi.mock('../../../../src/lib/cloister/agent-idle.js', () => ({
  isAgentIdleForNudge: vi.fn(() => true),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: vi.fn(async () => false),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));

vi.mock('../../../../src/lib/xbrief/io.js', () => ({
  readWorkspacePlanSync: vi.fn(() => plan),
}));

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: vi.fn(),
  logDeaconEventSync: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/concurrency.js', () => ({
  countRunningAgents: vi.fn(() => ({ work: 0, advancing: 0, swarm: 0, total: 0 })),
  getConcurrencyLimits: vi.fn(() => ({ maxWorkAgents: 6, reservedAdvancingSlots: 3, totalCeiling: 9 })),
  workResumeSlotsAvailable: vi.fn(() => 6),
}));

vi.mock('../../../../src/lib/cloister/memory-governor.js', () => ({
  assessMemoryPressure: vi.fn(async () => ({
    band: 'ok',
    availableBytes: Number.MAX_SAFE_INTEGER,
    thresholds: { warningBytes: 0, criticalBytes: 0 },
  })),
}));

vi.mock('../../../../src/lib/cloister/preemption.js', () => ({ resumeYieldedAgents: vi.fn() }));
vi.mock('../../../../src/lib/cloister/agent-grace.js', () => ({ isStartingWithinGrace: vi.fn(() => false) }));
vi.mock('../../../../src/lib/cloister/boot-reconciliation.js', () => ({
  getBootReconciliationHeldResumeSet: vi.fn(() => new Set()),
  getBootReconciliationPendingHoldSet: vi.fn(() => new Set()),
  isAutoResumableRole: vi.fn(() => true),
}));
vi.mock('../../../../src/lib/cloister/boot-reconciliation-predicates.js', () => ({ bootReconciliationSkipReason: vi.fn() }));
vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({ getBootReconciliationState: vi.fn(() => ({})) }));
vi.mock('../../../../src/lib/transcript-landing.js', () => ({ captureTranscriptUserRecordSnapshot: vi.fn() }));
vi.mock('../../../../src/lib/agents/placeholder-reconciliation.js', () => ({ reconcileLiveWorkSpawnPlaceholder: vi.fn() }));
vi.mock('../../../../src/lib/cloister/confirmed-session-query.js', () => ({
  consumeConfirmedSessionDetail: vi.fn(),
  queryConfirmedSession: vi.fn(),
}));
vi.mock('../../../../src/lib/cloister/swarm-slot-lifecycle.js', () => ({ isTerminalSwarmSlotAgent: vi.fn(() => false) }));

import { nudgeIdleWorkAgentsWithOpenBeads } from '../../../../src/lib/cloister/deacon-auto-resume.js';

const plan: XBriefDocument = {
  xBRIEFInfo: {
    version: '0.8',
    created: '2026-09-09T00:00:00.000Z',
    author: 'test',
  },
  plan: {
    id: 'pan-2796',
    title: 'Inspection gate regression',
    status: 'active',
    items: [
      {
        id: 'wi-1-spawn',
        title: 'Create the supervisor',
        status: 'completed',
        metadata: { requiresInspection: true, foundationFor: ['wi-2-registry'] },
      },
      {
        id: 'wi-2-registry',
        title: 'Register the supervisor',
        status: 'pending',
        metadata: { requiresInspection: false },
      },
    ],
    edges: [{ from: 'wi-1-spawn', to: 'wi-2-registry', type: 'blocks' }],
  },
};

describe('Deacon idle nudge mandatory inspection gate', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.agentRoot = await mkdtemp(join(tmpdir(), 'pan-2796-idle-nudge-'));
    mkdirSync(join(mocks.agentRoot, 'agent-pan-2796'));
  });

  afterEach(async () => {
    await rm(mocks.agentRoot, { recursive: true, force: true });
  });

  it('reports the failed inspected item and notes without advertising its dependent as ready', async () => {
    mocks.getReviewStatusSync.mockReturnValue({
      inspectStatus: 'failed',
      inspectBeadId: 'wi-1-spawn',
      inspectNotes: 'Lint fails in supervisor registration.',
    });

    await nudgeIdleWorkAgentsWithOpenBeads();

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    const message = String(mocks.messageAgent.mock.calls[0]?.[1]);
    expect(message).toContain('wi-1-spawn');
    expect(message).toContain('Lint fails in supervisor registration.');
    expect(message).toContain('fix');
    expect(message).not.toContain('Next ready task: wi-2-registry');
    expect(message).not.toContain('you have 1 ready task(s)');
  });

  it('reports an infrastructure-error inspection and prohibits task advancement', async () => {
    mocks.getReviewStatusSync.mockReturnValue({
      inspectStatus: 'error',
      inspectBeadId: 'wi-1-spawn',
      inspectNotes: 'Supervisor stopped at the workspace trust prompt.',
    });

    await nudgeIdleWorkAgentsWithOpenBeads();

    const message = String(mocks.messageAgent.mock.calls[0]?.[1]);
    expect(message).toContain('wi-1-spawn');
    expect(message).toContain('Supervisor stopped at the workspace trust prompt.');
    expect(message).toContain('do not advance');
    expect(message).not.toContain('Next ready task: wi-2-registry');
  });

  it('advertises the dependent task after the mandatory inspection passes', async () => {
    mocks.getReviewStatusSync.mockReturnValue({
      inspectStatus: 'passed',
      inspectBeadId: 'wi-1-spawn',
      inspectNotes: 'All acceptance criteria pass.',
    });

    await nudgeIdleWorkAgentsWithOpenBeads();

    const message = String(mocks.messageAgent.mock.calls[0]?.[1]);
    expect(message).toContain('you have 1 ready task(s)');
    expect(message).toContain('Next ready task: wi-2-registry Register the supervisor');
  });
});
