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
  logAgentLifecycle: vi.fn(),
}));

// The classifier's liveness read goes to the host's terminal backend
// (PAN-3926); pin it so the test never depends on the host's Herdr or tmux.
vi.mock('../../../../src/lib/agents/liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/agents/liveness.js')>()),
  isAlive: async () => ({ alive: false, reason: 'no-session' }),
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
import { getWorkAgentLifecycleState } from '../../../../src/lib/work-agent-lifecycle.js';
import { markAgentStateServiceInProcess } from '../../../../src/lib/agent-runtime-mirror.js';
import { Effect } from 'effect';

// The lifecycle door reads runtime state through the async agent-state
// service, which outside the dashboard process fetches it over HTTP. Mark the
// service in-process so it reads the mirror these fixtures seed and the test
// never reaches a live dashboard.
Effect.runSync(markAgentStateServiceInProcess());

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
  it('AC1: two concurrent spawn claims for one agent — exactly one wins', async () => {
    const first = claimAgentStart(AGENT);
    const second = claimAgentStart(AGENT);

    expect(first).toBe(true);
    expect(second).toBe(false);
    // Exactly one 409 AGENT_START_IN_FLIGHT: the loser's route returns it.
  });

  it('a claim is released in finally, so a failed spawn can be retried', async () => {
    expect(claimAgentStart(AGENT)).toBe(true);
    releaseAgentStart(AGENT);

    expect(claimAgentStart(AGENT)).toBe(true);
  });

  it('claims for different agents are independent', async () => {
    expect(claimAgentStart('agent-pan-1')).toBe(true);
    expect(claimAgentStart('agent-pan-2')).toBe(true);
  });

  it('a restart clears the set (resetAgentStartsInFlight)', async () => {
    expect(claimAgentStart(AGENT)).toBe(true);
    resetAgentStartsInFlight();

    expect(claimAgentStart(AGENT)).toBe(true);
  });
});

describe('no-placeholder invariant (AC2)', () => {
  it('a failed spawn with no state written leaves getAgentState null and pan start proceeds fresh', async () => {
    // Simulate the whole W34 flow: claim, spawn fails before the child writes
    // anything, release. Nothing was ever persisted for this agent.
    expect(claimAgentStart(AGENT)).toBe(true);
    releaseAgentStart(AGENT);

    expect(getAgentState(AGENT)).toBeNull();

    // No 'resumable session' refusal: the lifecycle classifier offers a fresh start.
    const lifecycle = await getWorkAgentLifecycleState(AGENT);
    expect(lifecycle.hasAgentState).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.recommendedAction).toBe('start');
  });
});
