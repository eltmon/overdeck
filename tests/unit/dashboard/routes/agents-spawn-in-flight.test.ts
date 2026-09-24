/**
 * PAN-3849 (W34): the in-flight spawn claim and the no-placeholder invariant.
 *
 * The placeholder row (state.json + agents row with a 'pending-' model) is
 * gone: concurrent spawn requests serialize on an in-process set, and agent
 * state is written only when the child writes its real state (FR-24).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The projection logs via persistent-logger — fire-and-forget in tests.
vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: vi.fn(),
}));

import {
  claimAgentStart,
  releaseAgentStart,
  resetAgentStartsInFlight,
} from '../../../../src/dashboard/server/routes/agents/spawn-helpers.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import { getAgentState } from '../../../../src/lib/agents/agent-state.js';
import { getWorkAgentLifecycleStateSync } from '../../../../src/lib/work-agent-lifecycle.js';

const AGENT = 'agent-pan-3849';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  resetAgentStartsInFlight();
}, 20_000);

afterEach(() => {
  resetAgentStartsInFlight();
  teardownOverdeckTestDb(odb);
});

describe('claimAgentStart (PAN-3849 W34)', () => {
  it('AC1: two concurrent spawn claims for one agent — exactly one wins', () => {
    const first = claimAgentStart(AGENT);
    const second = claimAgentStart(AGENT);

    expect(first).toBe(true);
    expect(second).toBe(false);
    // Exactly one 409 AGENT_START_IN_FLIGHT: the loser's route returns it.
  });

  it('a claim is released in finally, so a failed spawn can be retried', () => {
    expect(claimAgentStart(AGENT)).toBe(true);
    releaseAgentStart(AGENT);

    expect(claimAgentStart(AGENT)).toBe(true);
  });

  it('claims for different agents are independent', () => {
    expect(claimAgentStart('agent-pan-1')).toBe(true);
    expect(claimAgentStart('agent-pan-2')).toBe(true);
  });

  it('a restart clears the set (resetAgentStartsInFlight)', () => {
    expect(claimAgentStart(AGENT)).toBe(true);
    resetAgentStartsInFlight();

    expect(claimAgentStart(AGENT)).toBe(true);
  });
});

describe('no-placeholder invariant (AC2)', () => {
  it('a failed spawn with no state written leaves getAgentStateSync null and pan start proceeds fresh', () => {
    // Simulate the whole W34 flow: claim, spawn fails before the child writes
    // anything, release. Nothing was ever persisted for this agent.
    expect(claimAgentStart(AGENT)).toBe(true);
    releaseAgentStart(AGENT);

    expect(getAgentState(AGENT)).toBeNull();

    // No 'resumable session' refusal: the lifecycle classifier offers a fresh start.
    const lifecycle = getWorkAgentLifecycleStateSync(AGENT);
    expect(lifecycle.hasAgentState).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.recommendedAction).toBe('start');
  });
});
