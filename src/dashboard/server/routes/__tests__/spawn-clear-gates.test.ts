import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

const mockAppendOperatorInterventionEvent = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockClearAgentPaused = vi.hoisted(() => vi.fn());
const mockClearAgentTroubled = vi.hoisted(() => vi.fn());
const mockGetAgentState = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: mockAppendOperatorInterventionEvent,
}));

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  clearAgentPaused: mockClearAgentPaused,
  clearAgentTroubled: mockClearAgentTroubled,
}));

import { resolveStartAgentGateForRoute } from '../agents/spawn.js';
import type { AgentState } from '../../../../lib/agents.js';

function makeState(overrides: Partial<AgentState> & { id: string; issueId: string }): AgentState {
  return {
    id: overrides.id,
    issueId: overrides.issueId,
    workspace: '/tmp/workspace',
    role: 'work',
    model: 'claude-sonnet-5',
    status: 'stopped',
    startedAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  } as AgentState;
}

describe('resolveStartAgentGateForRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no persistent gate is set', async () => {
    mockGetAgentState.mockReturnValue(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: false,
        originOk: true,
      }),
    );

    expect(result).toBeNull();
    expect(mockClearAgentPaused).not.toHaveBeenCalled();
    expect(mockClearAgentTroubled).not.toHaveBeenCalled();
  });

  it('returns the paused gate reason when clearGates is false', async () => {
    mockGetAgentState.mockReturnValue(
      Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', paused: true, pausedReason: 'manual inspection' })),
    );

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: false,
        originOk: true,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        blocked: true,
        paused: true,
        troubled: false,
        error: 'Agent agent-pan-1234 is paused (manual inspection).',
      }),
    );
    expect(mockClearAgentPaused).not.toHaveBeenCalled();
    expect(mockAppendOperatorInterventionEvent).not.toHaveBeenCalled();
  });

  it('returns the troubled gate reason when clearGates is false', async () => {
    mockGetAgentState.mockReturnValue(
      Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', troubled: true, consecutiveFailures: 3 })),
    );

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: false,
        originOk: true,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        blocked: true,
        paused: false,
        troubled: true,
        error: 'Agent agent-pan-1234 is troubled (3 failures).',
      }),
    );
    expect(mockClearAgentTroubled).not.toHaveBeenCalled();
  });

  it('clears a paused gate and emits an operator intervention when clearGates is true', async () => {
    mockGetAgentState
      .mockReturnValueOnce(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', paused: true, pausedReason: 'manual inspection' })))
      .mockReturnValueOnce(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));
    mockClearAgentPaused.mockReturnValue(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: true,
        originOk: true,
      }),
    );

    expect(result).toBeNull();
    expect(mockClearAgentPaused).toHaveBeenCalledWith('agent-pan-1234');
    expect(mockClearAgentTroubled).not.toHaveBeenCalled();
    expect(mockAppendOperatorInterventionEvent).toHaveBeenCalledTimes(1);
    expect(mockAppendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1234', kind: 'unpause', source: 'dashboard start-agent' }),
    );
  });

  it('clears a troubled gate and emits an operator intervention when clearGates is true', async () => {
    mockGetAgentState
      .mockReturnValueOnce(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', troubled: true, consecutiveFailures: 3 })))
      .mockReturnValueOnce(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));
    mockClearAgentTroubled.mockReturnValue(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: true,
        originOk: true,
      }),
    );

    expect(result).toBeNull();
    expect(mockClearAgentTroubled).toHaveBeenCalledWith('agent-pan-1234');
    expect(mockClearAgentPaused).not.toHaveBeenCalled();
    expect(mockAppendOperatorInterventionEvent).toHaveBeenCalledTimes(1);
    expect(mockAppendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1234', kind: 'untroubled', source: 'dashboard start-agent' }),
    );
  });

  it('clears both gates when an agent is paused and has failure tracking', async () => {
    mockGetAgentState
      .mockReturnValueOnce(
        Effect.succeed(
          makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', paused: true, pausedReason: 'yielded', troubled: false, consecutiveFailures: 2 }),
        ),
      )
      .mockReturnValueOnce(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));
    mockClearAgentPaused.mockReturnValue(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));
    mockClearAgentTroubled.mockReturnValue(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: true,
        originOk: true,
      }),
    );

    expect(result).toBeNull();
    expect(mockClearAgentPaused).toHaveBeenCalledWith('agent-pan-1234');
    expect(mockClearAgentTroubled).toHaveBeenCalledWith('agent-pan-1234');
    expect(mockAppendOperatorInterventionEvent).toHaveBeenCalledTimes(2);
  });

  it('ignores clearGates when the request origin is not trusted', async () => {
    mockGetAgentState.mockReturnValue(
      Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', paused: true, pausedReason: 'manual inspection' })),
    );

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: true,
        originOk: false,
      }),
    );

    expect(result).toEqual(expect.objectContaining({ blocked: true, paused: true }));
    expect(mockClearAgentPaused).not.toHaveBeenCalled();
    expect(mockAppendOperatorInterventionEvent).not.toHaveBeenCalled();
  });

  it('re-evaluates the gate after clearing and returns it if the agent is still blocked', async () => {
    // First read: paused; clearing function succeeds but second read still sees paused.
    mockGetAgentState
      .mockReturnValueOnce(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', paused: true, pausedReason: 'manual inspection' })))
      .mockReturnValueOnce(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234', paused: true, pausedReason: 'still paused' })));
    mockClearAgentPaused.mockReturnValue(Effect.succeed(makeState({ id: 'agent-pan-1234', issueId: 'PAN-1234' })));

    const result = await Effect.runPromise(
      resolveStartAgentGateForRoute({
        agentSessionName: 'agent-pan-1234',
        issueId: 'PAN-1234',
        clearGates: true,
        originOk: true,
      }),
    );

    expect(result).toEqual(expect.objectContaining({ blocked: true, paused: true }));
  });
});
