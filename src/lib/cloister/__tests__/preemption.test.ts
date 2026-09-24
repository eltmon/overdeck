/**
 * PAN-2507 preemptive scheduler — unit tests for the yield mechanic.
 *
 * `selectYieldVictim` is pure (time injected as a param), so its cooldown test
 * needs no timers. `resumeYieldedAgents` is covered with mocked dependencies;
 * the cooldown behavior is exercised through the pure selector with an injected
 * `nowMs` (NFR-2: no real wall-clock delays).
 */

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  selectYieldVictim,
  resumeYieldedAgents,
  type YieldCandidate,
} from '../preemption.js';

const mocks = vi.hoisted(() => ({
  loadCloisterConfigSync: vi.fn(),
  listRunningAgents: vi.fn(),
  listAgentStates: vi.fn(),
  setAgentYieldedSync: vi.fn(),
  clearYieldForResumeSync: vi.fn(),
  stopAgent: vi.fn(),
  resumeAgent: vi.fn(),
  getReviewStatusSync: vi.fn(),
  listSessions: vi.fn(),
  isAgentIdleForNudge: vi.fn(),
  assessMemoryPressure: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  logDeaconEventSync: vi.fn(),
  countRunningAgents: vi.fn(async () => ({ work: 0, advancing: 0, swarm: 0, total: 0 })),
}));

vi.mock('../../agents.js', () => ({
  listRunningAgents: mocks.listRunningAgents,
  listAgentStates: mocks.listAgentStates,
  setAgentYieldedSync: mocks.setAgentYieldedSync,
  clearYieldForResumeSync: mocks.clearYieldForResumeSync,
  stopAgent: mocks.stopAgent,
  resumeAgent: mocks.resumeAgent,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
}));

vi.mock('../../tmux.js', () => ({
  listSessions: mocks.listSessions,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: mocks.logDeaconEventSync,
}));

vi.mock('../config.js', () => ({
  loadCloisterConfigSync: mocks.loadCloisterConfigSync,
}));

vi.mock('../../agents/liveness.js', () => ({
  isIdle: mocks.isAgentIdleForNudge,
}));

vi.mock('../memory-governor.js', () => ({
  assessMemoryPressure: mocks.assessMemoryPressure,
}));

vi.mock('../concurrency.js', () => ({
  // PAN-3917: the running count is read from the selected backend's inventory,
  // so it is async and preemption awaits it before reserving.
  countRunningAgents: mocks.countRunningAgents,
}));

function candidate(overrides: Partial<YieldCandidate> = {}): YieldCandidate {
  return {
    id: 'agent-pan-1000',
    issueId: 'PAN-1000',
    idle: true,
    attached: false,
    paused: false,
    reviewBlocked: false,
    lastActivityMs: 1_000_000,
    lastYieldResumeMs: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stopAgent.mockReturnValue(Effect.void);
  mocks.listSessions.mockReturnValue(Effect.succeed([]));
  mocks.setAgentYieldedSync.mockReturnValue(true);
  mocks.clearYieldForResumeSync.mockReturnValue(true);
  mocks.resumeAgent.mockResolvedValue({ success: true });
  mocks.assessMemoryPressure.mockResolvedValue({ band: 'ok', availableBytes: 8e9 });
  mocks.getReviewStatusSync.mockReturnValue(null);
  mocks.listAgentStates.mockReturnValue([]);
  mocks.loadCloisterConfigSync.mockReturnValue({
    concurrency: { preemption: true, max_yielded: 3, yield_cooldown_secs: 600 },
  });
});

describe('selectYieldVictim (pure predicate + ordering)', () => {
  const NOW = 10_000_000;

  it('returns null when there are no candidates', () => {
    expect(selectYieldVictim([], NOW, 600)).toBeNull();
  });

  it('excludes non-idle, attached, and operator-paused agents', () => {
    const nonIdle = candidate({ id: 'a', idle: false });
    const attached = candidate({ id: 'b', attached: true });
    const paused = candidate({ id: 'c', paused: true });
    expect(selectYieldVictim([nonIdle, attached, paused], NOW, 600)).toBeNull();
  });

  it('excludes agents inside the re-yield cooldown', () => {
    // resumed 100s ago, cooldown 600s ⇒ still cooling down
    const cooling = candidate({ id: 'cool', lastYieldResumeMs: NOW - 100_000 });
    expect(selectYieldVictim([cooling], NOW, 600)).toBeNull();

    // resumed 700s ago ⇒ out of cooldown, now eligible
    const cooled = candidate({ id: 'cooled', lastYieldResumeMs: NOW - 700_000 });
    expect(selectYieldVictim([cooled], NOW, 600)?.id).toBe('cooled');
  });

  it('prefers a pipeline-blocked agent over a non-blocked one', () => {
    const notBlocked = candidate({ id: 'plain', reviewBlocked: false, lastActivityMs: 0 });
    const blocked = candidate({ id: 'blocked', reviewBlocked: true, lastActivityMs: 9_999_999 });
    // Even though `blocked` is more recently active, review-blocked wins.
    expect(selectYieldVictim([notBlocked, blocked], NOW, 600)?.id).toBe('blocked');
  });

  it('breaks ties by longest-idle (oldest lastActivity first)', () => {
    const recent = candidate({ id: 'recent', lastActivityMs: 5_000_000 });
    const old = candidate({ id: 'old', lastActivityMs: 1_000_000 });
    expect(selectYieldVictim([recent, old], NOW, 600)?.id).toBe('old');
  });
});



describe('resumeYieldedAgents', () => {
  it('resumes yielded agents oldest-first, clearing yield + stamping cooldown', async () => {
    // Two resumes ⇒ one inter-resume RSS settle. Fake timers so no real
    // wall-clock delay (NFR-2 / repo fake-timers rule).
    vi.useFakeTimers();
    try {
      mocks.listAgentStates.mockReturnValue([
        { id: 'agent-newer', issueId: 'PAN-2', role: 'work', status: 'stopped', yieldedByScheduler: true, yieldedAt: '2026-07-08T02:00:00.000Z' },
        { id: 'agent-older', issueId: 'PAN-1', role: 'work', status: 'stopped', yieldedByScheduler: true, yieldedAt: '2026-07-08T01:00:00.000Z' },
      ]);

      const pending = resumeYieldedAgents(5);
      await vi.runAllTimersAsync();
      const resumed = await pending;

      expect(resumed).toEqual(['agent-older', 'agent-newer']);
      expect(mocks.clearYieldForResumeSync).toHaveBeenNthCalledWith(1, 'agent-older');
      expect(mocks.resumeAgent).toHaveBeenNthCalledWith(1, 'agent-older');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops resuming when the memory band is not ok', async () => {
    mocks.listAgentStates.mockReturnValue([
      { id: 'agent-older', issueId: 'PAN-1', role: 'work', status: 'stopped', yieldedByScheduler: true, yieldedAt: '2026-07-08T01:00:00.000Z' },
    ]);
    mocks.assessMemoryPressure.mockResolvedValue({ band: 'soft', availableBytes: 1e9 });

    const resumed = await resumeYieldedAgents(5);
    expect(resumed).toEqual([]);
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
  });

  it('respects the resume budget', async () => {
    mocks.listAgentStates.mockReturnValue([
      { id: 'agent-a', issueId: 'PAN-1', role: 'work', status: 'stopped', yieldedByScheduler: true, yieldedAt: '2026-07-08T01:00:00.000Z' },
      { id: 'agent-b', issueId: 'PAN-2', role: 'work', status: 'stopped', yieldedByScheduler: true, yieldedAt: '2026-07-08T02:00:00.000Z' },
    ]);

    const resumed = await resumeYieldedAgents(0);
    expect(resumed).toEqual([]);
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
  });
});
