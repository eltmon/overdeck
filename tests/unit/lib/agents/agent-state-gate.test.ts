import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  decideResumeGate,
  getAgentResumeGateBlockReason,
  markAgentRunning,
  clearAgentOperatorGatesForIssueSync,
  clearAgentOperatorGatesForIssuesSync,
  saveAgentStateSync,
  getAgentStateSync,
  type AgentState,
  type ResumeGateBlock,
} from '../../../../src/lib/agents/agent-state.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

describe('getAgentResumeGateBlockReason', () => {
  it.each([
    [{}, undefined],
    [{ stoppedByUser: true }, 'stopped-by-user'],
    [{ troubled: true }, 'troubled'],
    [{ troubled: true, stoppedByUser: true }, 'troubled'],
    [{ paused: true }, 'paused'],
    [{ paused: true, stoppedByUser: true }, 'paused'],
    [{ paused: true, troubled: true }, 'paused'],
    [{ paused: true, troubled: true, stoppedByUser: true }, 'paused'],
  ] as const)('classifies the paused/troubled/stoppedByUser combination %j', (state, expected) => {
    expect(getAgentResumeGateBlockReason(state)?.gate).toBe(expected);
  });

  it('preserves gate-specific metadata and classifies failure backoff', () => {
    expect(getAgentResumeGateBlockReason({
      paused: true,
      pausedReason: 'scheduler capacity',
      yieldedByScheduler: true,
    })).toEqual({
      gate: 'paused',
      reason: 'agent is paused (scheduler capacity)',
      pausedReason: 'scheduler capacity',
      yieldedByScheduler: true,
    });
    expect(getAgentResumeGateBlockReason({ consecutiveFailures: 2 })).toEqual({
      gate: 'failure-backoff',
      reason: 'agent is in failure backoff (2 failures)',
      consecutiveFailures: 2,
    });
  });
});

describe('markAgentRunning', () => {
  function state(harness: AgentState['harness']): AgentState {
    return {
      id: `agent-${harness}`,
      issueId: 'PAN-2731',
      workspace: '/tmp/workspace',
      harness,
      status: 'starting',
      startedAt: '2026-07-15T15:22:04.971Z',
    };
  }

  it('does not invent a Codex lastActivity timestamp before observed activity', () => {
    const codex = state('codex');
    const claude = state('claude-code');

    markAgentRunning(codex);
    markAgentRunning(claude);

    expect(codex.lastActivity).toBeUndefined();
    expect(claude.lastActivity).toEqual(expect.any(String));
  });
});

describe('decideResumeGate', () => {
  const blocks: ResumeGateBlock[] = [
    { gate: 'paused', reason: 'agent is paused' },
    { gate: 'troubled', reason: 'agent is troubled' },
    { gate: 'stopped-by-user', reason: 'agent was stopped by the operator' },
    { gate: 'failure-backoff', reason: 'agent is in failure backoff', consecutiveFailures: 2 },
  ];

  it('blocks autonomous paused, troubled, and failure-backoff gates', () => {
    for (const block of blocks.filter(({ gate }) => gate !== 'stopped-by-user')) {
      expect(decideResumeGate(block, 'autonomous')).toMatchObject({ decision: 'block', reason: block.reason });
    }
  });

  it.each([
    [false, false, 'block'],
    [false, true, 'block'],
    [true, false, 'block'],
    [true, true, 'proceed'],
  ] as const)(
    'classifies stoppedByUser with completed handoff=%s and owed rework=%s as %s',
    (hasCompletedHandoff, owesRework, expected) => {
      const decision = decideResumeGate(blocks[2], 'autonomous', { hasCompletedHandoff, owesRework });
      expect(decision.decision).toBe(expected);
      if (expected === 'block') expect(decision).toMatchObject({ needsYou: true });
      else expect(decision).toMatchObject({ clearStoppedByUser: true });
    },
  );

  it('resumes a scheduler-yielded agent for merge preparation but blocks an operator pause (PAN-3120)', () => {
    const yielded: ResumeGateBlock = {
      gate: 'paused',
      reason: 'agent is paused (yield: making room for review of MIN-902)',
      pausedReason: 'yield: making room for review of MIN-902',
      yieldedByScheduler: true,
    };
    expect(decideResumeGate(yielded, 'merge-preparation')).toEqual({ decision: 'proceed', clearYield: true });

    // An operator's own pause is a decision, not a resource choice — surface it.
    const operatorPause: ResumeGateBlock = { gate: 'paused', reason: 'agent is paused (investigating)', pausedReason: 'investigating' };
    expect(decideResumeGate(operatorPause, 'merge-preparation')).toMatchObject({ decision: 'block', needsYou: true });
    expect(decideResumeGate(blocks[1], 'merge-preparation')).toMatchObject({ decision: 'block', needsYou: true });

    // The merge click is itself the operator action, so it clears an operator stop.
    expect(decideResumeGate(blocks[2], 'merge-preparation')).toEqual({ decision: 'proceed', clearStoppedByUser: true });
    expect(decideResumeGate(blocks[3], 'merge-preparation')).toMatchObject({ decision: 'proceed', overrideFailureBackoff: true });
    expect(decideResumeGate(undefined, 'merge-preparation')).toEqual({ decision: 'proceed' });
  });

  it('makes operator start authoritative only for stopped-by-user and failure backoff', () => {
    expect(decideResumeGate(blocks[0], 'operator-start')).toEqual({
      decision: 'block',
      reason: 'agent is paused; run pan unpause first',
    });
    expect(decideResumeGate(blocks[1], 'operator-start')).toEqual({
      decision: 'block',
      reason: 'agent is troubled; run pan untroubled first',
    });
    expect(decideResumeGate(blocks[2], 'operator-start')).toEqual({
      decision: 'proceed',
      clearStoppedByUser: true,
    });
    expect(decideResumeGate(blocks[3], 'operator-start')).toEqual({
      decision: 'proceed',
      overrideFailureBackoff: true,
      warning: 'Operator start overrides agent is in failure backoff',
    });
  });

  it('queues message delivery without requesting gate mutation', () => {
    for (const block of blocks) {
      expect(decideResumeGate(block, 'message-delivery')).toEqual({
        decision: 'queue-message',
        reason: block.reason,
      });
    }
    expect(decideResumeGate(undefined, 'message-delivery')).toEqual({ decision: 'proceed' });
  });

  it('re-drives a stopped-by-user agent for rework-owing feedback delivery (PAN-2668)', () => {
    const stoppedByUser = blocks.find((block) => block.gate === 'stopped-by-user')!;
    // The completed-handoff + owes-rework exception applies to message delivery
    // the same way it does to autonomous re-drive — verification/review feedback
    // must not be silently queued to a stopped agent nothing will resume.
    expect(decideResumeGate(stoppedByUser, 'message-delivery', { hasCompletedHandoff: true, owesRework: true })).toEqual({
      decision: 'proceed',
      clearStoppedByUser: true,
    });
    // Either half of the context missing → still queued.
    expect(decideResumeGate(stoppedByUser, 'message-delivery', { hasCompletedHandoff: true })).toEqual({
      decision: 'queue-message',
      reason: stoppedByUser.reason,
    });
    expect(decideResumeGate(stoppedByUser, 'message-delivery', { owesRework: true })).toEqual({
      decision: 'queue-message',
      reason: stoppedByUser.reason,
    });
    // Other gates never re-drive on message delivery, even with full context.
    for (const block of blocks.filter((candidate) => candidate.gate !== 'stopped-by-user')) {
      expect(decideResumeGate(block, 'message-delivery', { hasCompletedHandoff: true, owesRework: true })).toEqual({
        decision: 'queue-message',
        reason: block.reason,
      });
    }
  });
});

describe('clearAgentOperatorGatesForIssueSync', () => {
  let odb: OverdeckTestDb;
  beforeEach(() => { odb = setupOverdeckTestDb(); });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  function stoppedState(overrides: Partial<AgentState> = {}): AgentState {
    return {
      id: 'agent-pan-3727-work',
      issueId: 'PAN-3727',
      workspace: '/tmp/workspace',
      role: 'work',
      model: 'claude-opus-4-8',
      status: 'stopped',
      startedAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    } as AgentState;
  }

  it('clears stoppedByUser on a stopped row and returns its id', () => {
    saveAgentStateSync(stoppedState({ stoppedByUser: true }));

    const mutated = clearAgentOperatorGatesForIssueSync('PAN-3727');

    expect(mutated).toEqual(['agent-pan-3727-work']);
    expect(getAgentStateSync('agent-pan-3727-work')?.stoppedByUser).toBeUndefined();
  });

  it('leaves a running agent row untouched and omits it from the returned ids', () => {
    saveAgentStateSync(stoppedState({ id: 'agent-pan-3727-review', status: 'running', stoppedByUser: true }));

    const mutated = clearAgentOperatorGatesForIssueSync('PAN-3727');

    expect(mutated).toEqual([]);
    expect(getAgentStateSync('agent-pan-3727-review')?.stoppedByUser).toBe(true);
  });

  it('preserves a scheduler yield (paused + yieldedByScheduler) on a stopped row', () => {
    saveAgentStateSync(stoppedState({
      id: 'agent-pan-3727-yielded',
      paused: true,
      pausedReason: 'yield: making room for review of PAN-9999',
      yieldedByScheduler: true,
      yieldedAt: '2026-08-01T00:00:00.000Z',
    }));

    const mutated = clearAgentOperatorGatesForIssueSync('PAN-3727');

    expect(mutated).toEqual([]);
    const loaded = getAgentStateSync('agent-pan-3727-yielded');
    expect(loaded?.paused).toBe(true);
    expect(loaded?.yieldedByScheduler).toBe(true);
  });
});

describe('clearAgentOperatorGatesForIssuesSync (batch, PAN-3727 review finding)', () => {
  let odb: OverdeckTestDb;
  beforeEach(() => { odb = setupOverdeckTestDb(); });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  function stoppedState(overrides: Partial<AgentState> = {}): AgentState {
    return {
      id: 'agent-pan-3727-work',
      issueId: 'PAN-3727',
      workspace: '/tmp/workspace',
      role: 'work',
      model: 'claude-opus-4-8',
      status: 'stopped',
      startedAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    } as AgentState;
  }

  it('clears matching stopped rows across multiple issues in one pass and groups results by issue', () => {
    saveAgentStateSync(stoppedState({ id: 'agent-pan-1-work', issueId: 'PAN-1', stoppedByUser: true }));
    saveAgentStateSync(stoppedState({ id: 'agent-pan-2-work', issueId: 'PAN-2', troubled: true, troubledAt: '2026-08-01T00:00:00.000Z' }));
    saveAgentStateSync(stoppedState({ id: 'agent-pan-3-work', issueId: 'PAN-3', stoppedByUser: true }));

    const mutated = clearAgentOperatorGatesForIssuesSync(new Set(['PAN-1', 'PAN-2']));

    expect([...mutated.keys()].sort()).toEqual(['PAN-1', 'PAN-2']);
    expect(mutated.get('PAN-1')).toEqual(['agent-pan-1-work']);
    expect(mutated.get('PAN-2')).toEqual(['agent-pan-2-work']);
    expect(getAgentStateSync('agent-pan-1-work')?.stoppedByUser).toBeUndefined();
    expect(getAgentStateSync('agent-pan-2-work')?.troubled).toBeUndefined();
    // PAN-3 was not in the requested set — left untouched.
    expect(getAgentStateSync('agent-pan-3-work')?.stoppedByUser).toBe(true);
  });

  it('returns an empty map without scanning when given an empty issue set', () => {
    saveAgentStateSync(stoppedState({ id: 'agent-pan-1-work', issueId: 'PAN-1', stoppedByUser: true }));

    const mutated = clearAgentOperatorGatesForIssuesSync(new Set());

    expect(mutated.size).toBe(0);
    expect(getAgentStateSync('agent-pan-1-work')?.stoppedByUser).toBe(true);
  });
});
