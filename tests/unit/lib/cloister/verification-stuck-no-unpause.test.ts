/**
 * #4019: the verification "stuck" notice must not un-pause the agent that the
 * escalation just paused.
 *
 * `escalateVerificationStuck` pauses the work agent with a `needs-you:` reason
 * and stops it; every caller then sends the STUCK message through
 * `deliverVerificationFeedback`. That door resolves its target through the
 * REAL feedback-target module here, whose resurrection ladder lifts
 * `needs-you:` pauses (PAN-2461). Only the edges are faked: agent state,
 * liveness, resume, the activity stream, and the transport.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  states: new Map<string, Record<string, unknown>>(),
  live: new Set<string>(),
  clearPaused: vi.fn(),
  clearTroubled: vi.fn(),
  resumeAgent: vi.fn(),
  messageAgent: vi.fn(),
  emitActivity: vi.fn(),
  /** Runs on each liveness probe: lets a test land a concurrent escalation mid-resolution. */
  onProbe: undefined as undefined | ((id: string) => void),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: (id: string) => h.states.get(id) ?? null,
  messageAgent: h.messageAgent,
  setAgentPaused: (id: string, reason: string) => Effect.sync(() => {
    h.states.set(id, { ...(h.states.get(id) ?? { id }), paused: true, pausedReason: reason });
  }),
  clearAgentPaused: (id: string) => Effect.sync(() => {
    const state = h.states.get(id);
    if (state) h.states.set(id, { ...state, paused: false, pausedReason: undefined });
  }),
  stopAgent: (id: string) => Effect.sync(() => {
    h.states.set(id, { ...(h.states.get(id) ?? { id }), status: 'stopped' });
    h.live.delete(id);
  }),
}));

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  getAgentState: (id: string) => h.states.get(id) ?? null,
  clearAgentPausedSync: (id: string, onlyIf?: (state: Record<string, unknown>) => boolean) => {
    const state = h.states.get(id);
    if (!state) return false;
    if (onlyIf && !onlyIf(state)) return false;
    h.clearPaused(id);
    h.states.set(id, { ...state, paused: false, pausedReason: undefined });
    return true;
  },
  clearAgentTroubled: (id: string) => Effect.sync(() => { h.clearTroubled(id); return null; }),
}));

vi.mock('../../../../src/lib/agents/resume.js', () => ({ resumeAgent: h.resumeAgent }));

vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  isAlive: (id: string) => {
    h.onProbe?.(id);
    return Promise.resolve(h.live.has(id) ? { alive: true } : { alive: false, reason: 'no-session' });
  },
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
}));

vi.mock('../../../../src/lib/tmux.js', () => ({ listSessionNames: () => Effect.succeed([]) }));
vi.mock('../../../../src/lib/agents/agent-state-source.js', () => ({ readFeedbackAgentStates: () => [] }));
vi.mock('../../../../src/lib/cloister/deacon-swarm-record.js', () => ({ readSwarmSlotAssignments: () => [] }));
vi.mock('../../../../src/lib/projects.js', () => ({ resolveProjectFromIssueSync: () => null }));
vi.mock('../../../../src/lib/cloister/work-agent-start.js', () => ({
  spawnWorkAgentThroughAgentsEndpoint: vi.fn(async () => ({ spawned: false, error: 'not in this test' })),
}));
vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({ getPrFacts: vi.fn(async () => ({ merged: false })) }));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: h.emitActivity }));

import {
  deliverVerificationFeedback,
  escalateVerificationStuck,
  liftVerificationStuckPause,
  VERIFICATION_STUCK_PAUSE_PREFIX,
} from '../../../../src/lib/cloister/verification-escalation.js';

const AGENT = 'agent-pan-4019';
const STUCK = 'VERIFICATION STUCK for PAN-4019.\nFailed check: test after repeated attempts.';

/** What the real messageAgent does: a paused agent's message is queued to mail, never resumed. */
function transportHonoringPause(id: string) {
  const state = h.states.get(id);
  if (state?.paused === true) {
    return Promise.resolve({ delivered: false, queuedToMail: true, reason: `agent is paused: ${String(state.pausedReason)}` });
  }
  return Promise.resolve({ delivered: true, queuedToMail: false });
}

function needsYouMessages(): string[] {
  return h.emitActivity.mock.calls
    .map(([entry]) => (entry as { message: string }).message)
    .filter((message) => message.includes('needs you'));
}

describe('#4019: the stuck notice never un-pauses the agent escalation paused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.states.clear();
    h.live.clear();
    h.onProbe = undefined;
    h.states.set(AGENT, { id: AGENT, status: 'running' });
    h.live.add(AGENT);
    h.messageAgent.mockImplementation(transportHonoringPause);
    h.resumeAgent.mockImplementation(async (id: string) => {
      h.live.add(id);
      h.states.set(id, { ...(h.states.get(id) ?? { id }), status: 'running' });
      return { success: true };
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reaching the budget leaves the agent paused and surfaces the stuck notice to the operator', async () => {
    await escalateVerificationStuck('PAN-4019', 'test', 3, 'three red heads', 'verification');
    const delivered = await deliverVerificationFeedback('PAN-4019', STUCK, { failedCheck: 'test' }, 'verification');

    expect(delivered).toBe(false);
    expect(h.clearPaused).not.toHaveBeenCalled();
    expect(h.resumeAgent).not.toHaveBeenCalled();
    expect(h.states.get(AGENT)).toEqual(expect.objectContaining({
      paused: true,
      pausedReason: expect.stringMatching(new RegExp(`^${VERIFICATION_STUCK_PAUSE_PREFIX}`)),
      status: 'stopped',
    }));
    expect(needsYouMessages()).toEqual([
      expect.stringContaining(`Verification stuck: ${AGENT} is paused for the operator`),
    ]);
  });

  it('a pane that outlived the stop (Herdr) gets the notice queued to mail, not a resume', async () => {
    await escalateVerificationStuck('PAN-4019', 'test', 3, 'three red heads', 'verification');
    h.live.add(AGENT);

    const delivered = await deliverVerificationFeedback('PAN-4019', STUCK, { failedCheck: 'test' }, 'verification');

    expect(delivered).toBe(false);
    expect(h.messageAgent).toHaveBeenCalledWith(AGENT, STUCK, 'internal', expect.objectContaining({ owesRework: true }));
    expect(h.resumeAgent).not.toHaveBeenCalled();
    expect(h.states.get(AGENT)).toEqual(expect.objectContaining({ paused: true }));
    expect(needsYouMessages()).toEqual([
      expect.stringContaining('the stuck notice is queued to its mail'),
    ]);
  });

  it('control: a stopped agent that is not stuck-paused is still resurrected for verification feedback', async () => {
    h.states.set(AGENT, { id: AGENT, status: 'stopped' });
    h.live.delete(AGENT);

    const delivered = await deliverVerificationFeedback('PAN-4019', 'VERIFICATION FAILED for PAN-4019.', {}, 'verification');

    expect(h.resumeAgent).toHaveBeenCalledWith(AGENT);
    expect(delivered).toBe(true);
  });

  it('a stuck pause that lands while the delivery resolves its target is not lifted (CodeRabbit on #4039)', async () => {
    // The CI relay's delivery read "not stuck", then the local gate escalated
    // the same issue while this delivery probed liveness.
    let escalated = false;
    h.onProbe = (id) => {
      if (escalated || id !== AGENT) return;
      escalated = true;
      h.states.set(AGENT, {
        ...(h.states.get(AGENT) ?? { id: AGENT }),
        status: 'stopped',
        paused: true,
        pausedReason: `${VERIFICATION_STUCK_PAUSE_PREFIX} after 3/3 attempts (test)`,
      });
      h.live.delete(AGENT);
    };

    const delivered = await deliverVerificationFeedback('PAN-4019', 'VERIFICATION FAILED for PAN-4019.', {}, 'verification');

    expect(escalated).toBe(true);
    expect(delivered).toBe(false);
    expect(h.clearPaused).not.toHaveBeenCalled();
    expect(h.resumeAgent).not.toHaveBeenCalled();
    expect(h.states.get(AGENT)).toEqual(expect.objectContaining({
      paused: true,
      pausedReason: expect.stringMatching(new RegExp(`^${VERIFICATION_STUCK_PAUSE_PREFIX}`)),
    }));
    expect(needsYouMessages()).toEqual([
      expect.stringContaining(`Verification stuck: ${AGENT} is paused for the operator`),
    ]);
  });

  it('a verification pass lifts the stuck pause; later feedback then reaches the agent normally', async () => {
    await escalateVerificationStuck('PAN-4019', 'test', 3, 'three red heads', 'verification');

    await expect(liftVerificationStuckPause('PAN-4019', 'verification')).resolves.toBe(true);
    expect(h.states.get(AGENT)).toEqual(expect.objectContaining({ paused: false }));

    const delivered = await deliverVerificationFeedback('PAN-4019', 'VERIFICATION FAILED for PAN-4019.', {}, 'verification');
    expect(h.resumeAgent).toHaveBeenCalledWith(AGENT);
    expect(delivered).toBe(true);
  });

  it('a verification pass never lifts an operator pause', async () => {
    h.states.set(AGENT, { id: AGENT, status: 'stopped', paused: true, pausedReason: 'operator: hold for demo' });

    await expect(liftVerificationStuckPause('PAN-4019', 'verification')).resolves.toBe(false);
    expect(h.states.get(AGENT)).toEqual(expect.objectContaining({ paused: true, pausedReason: 'operator: hold for demo' }));
  });
});
