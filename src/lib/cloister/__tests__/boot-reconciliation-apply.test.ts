import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  candidates: [] as Array<{
    id: string;
    issueId: string;
    stoppedByUser?: boolean;
  }>,
  bootState: {
    decision: 'resume_all' as 'resume_all' | 'hold_all' | 'per_agent',
    perAgent: {} as Record<string, 'resume' | 'hold'>,
    bootId: 'boot-default',
  },
  handleAgentStoppedEvent: vi.fn(async () => null as string | null),
  logDeaconEventSync: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    cpus: () => Array.from({ length: 8 }, () => ({}) as ReturnType<typeof actual.cpus>[number]),
    loadavg: () => [0.5, 0.5, 0.5] as [number, number, number],
  };
});

vi.mock('../boot-reconciliation.js', () => ({
  listBootReconciliationCandidates: vi.fn(() => mocks.candidates),
}));

vi.mock('../deacon-auto-resume.js', () => ({
  handleAgentStoppedEvent: mocks.handleAgentStoppedEvent,
  RESUME_LOAD_FACTOR: 1.5,
  RESUME_STAGGER_MS: 150,
  RSS_SETTLE_MS: 2_000,
}));

vi.mock('../concurrency.js', () => ({
  getConcurrencyLimits: vi.fn(() => ({ maxWorkAgents: 6, reservedAdvancingSlots: 3, totalCeiling: 9 })),
  countRunningAgents: vi.fn(() => ({ work: 0, advancing: 0, total: 0 })),
  workResumeSlotsAvailable: vi.fn(() => 6),
}));

vi.mock('../memory-governor.js', () => ({
  assessMemoryPressure: vi.fn(async () => ({
    band: 'ok',
    availableBytes: Number.MAX_SAFE_INTEGER,
  })),
}));

vi.mock('../../overdeck/control-settings.js', () => ({
  getBootReconciliationState: vi.fn(() => ({ ...mocks.bootState })),
}));

vi.mock('../../tmux.js', () => ({
  sessionExists: vi.fn(() => Effect.succeed(false)),
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: mocks.logDeaconEventSync,
}));

vi.mock('../boot-reconciliation-predicates.js', () => ({
  bootReconciliationSkipReason: vi.fn(() => null),
}));

import { applyBootReconciliationDecision } from '../boot-reconciliation-apply.js';

const deps = {
  notifyAgentStopped: vi.fn(),
  notifyAgentStatusChanged: vi.fn(),
};
let bootSequence = 0;

function candidate(id: string, stoppedByUser = false) {
  return {
    id,
    issueId: id.replace('agent-', 'PAN-').toUpperCase(),
    stoppedByUser,
  };
}

describe('applyBootReconciliationDecision origin handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.candidates = [];
    mocks.bootState = {
      decision: 'resume_all',
      perAgent: {},
      bootId: `boot-${++bootSequence}`,
    };
  });

  it('filters stoppedByUser candidates from auto-origin apply', async () => {
    const stoppedByUser = candidate('agent-stopped-by-user', true);
    const plain = candidate('agent-plain');
    mocks.candidates = [stoppedByUser, plain];

    await applyBootReconciliationDecision(deps);

    expect(mocks.handleAgentStoppedEvent).toHaveBeenCalledTimes(1);
    expect(mocks.handleAgentStoppedEvent).toHaveBeenCalledWith(
      plain.id,
      { skipGlobalGates: true, context: 'boot-reconciliation' },
      deps,
    );
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(
      'applyBootReconciliationDecision: auto origin filtered 1 stoppedByUser candidate(s)',
    );
  });

  it('passes the explicit stoppedByUser override for operator-origin apply', async () => {
    const stoppedByUser = candidate('agent-stopped-by-user', true);
    const plain = candidate('agent-plain');
    mocks.candidates = [stoppedByUser, plain];

    await applyBootReconciliationDecision(deps, { origin: 'operator' });

    expect(mocks.handleAgentStoppedEvent).toHaveBeenCalledTimes(2);
    expect(mocks.handleAgentStoppedEvent).toHaveBeenNthCalledWith(
      1,
      stoppedByUser.id,
      { skipGlobalGates: true, context: 'boot-reconciliation', overrideStoppedByUser: true },
      deps,
    );
    expect(mocks.handleAgentStoppedEvent).toHaveBeenNthCalledWith(
      2,
      plain.id,
      { skipGlobalGates: true, context: 'boot-reconciliation', overrideStoppedByUser: true },
      deps,
    );
  });

  it('does nothing for hold_all', async () => {
    mocks.bootState.decision = 'hold_all';
    mocks.candidates = [candidate('agent-plain')];

    const result = await applyBootReconciliationDecision(deps);

    expect(result).toEqual({
      resumed: [],
      outcomes: [],
      skipped: { workspace_missing: 0, merged: 0, completed: 0, other: 0 },
      deferred: 0,
    });
    expect(mocks.handleAgentStoppedEvent).not.toHaveBeenCalled();
  });
});
