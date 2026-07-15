import { describe, expect, it } from 'vitest';
import {
  decideResumeGate,
  getAgentResumeGateBlockReason,
  type ResumeGateBlock,
} from '../../../../src/lib/agents/agent-state.js';

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
