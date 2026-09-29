/**
 * `deriveWorkStart` (PAN-4399): the pure read of a workspace's pipeline
 * journal into "is the auto-started work agent actually here or not".
 * `readWorkStartFacts` is the IO wrapper `derived-issue-state.ts` calls;
 * this file exercises the pure derivation only, with an injected `now`.
 */
import { describe, expect, it } from 'vitest';

import { WORK_START_GRACE_MS, deriveWorkStart, type WorkStartFacts } from '../work-start-state.js';

const NOW = 1_800_000_000_000;
const AT = new Date(NOW - 5 * 60_000).toISOString();

function facts(overrides: Partial<WorkStartFacts> = {}): WorkStartFacts {
  return {
    lastHandoff: null,
    workAgentStartedAt: null,
    ...overrides,
  };
}

describe('deriveWorkStart', () => {
  it('reads no facts as no work-start signal', () => {
    expect(deriveWorkStart(facts(), NOW)).toBeUndefined();
  });

  it('a handoff.deferred entry reads as retrying, carrying the error and next retry', () => {
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.deferred', at: AT, data: { error: 'Agent ceiling reached', nextRetryAt: '2026-09-29T10:00:00.000Z' } },
    }), NOW);
    expect(result).toEqual({ status: 'retrying', at: AT, error: 'Agent ceiling reached', nextRetryAt: '2026-09-29T10:00:00.000Z' });
  });

  it('a handoff.retried entry also reads as retrying', () => {
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.retried', at: AT, data: { error: 'stack unhealthy', nextRetryAt: '2026-09-29T10:00:00.000Z' } },
    }), NOW);
    expect(result).toEqual({ status: 'retrying', at: AT, error: 'stack unhealthy', nextRetryAt: '2026-09-29T10:00:00.000Z' });
  });

  it('a gave-up handoff.abandoned entry reads as not-started with the recorded error', () => {
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.abandoned', at: AT, data: { outcome: 'gave-up', error: 'spawn guardrails still refused the work agent' } },
    }), NOW);
    expect(result).toEqual({ status: 'not-started', at: AT, error: 'spawn guardrails still refused the work agent' });
  });

  it('a stood-down handoff.abandoned entry reads as no signal at all', () => {
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.abandoned', at: AT, data: { outcome: 'stood-down', reason: 'the issue is paused' } },
    }), NOW);
    expect(result).toBeUndefined();
  });

  it('an accepted handoff.started within the grace window reads as no signal yet', () => {
    const startedAt = new Date(NOW - (WORK_START_GRACE_MS - 60_000)).toISOString();
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.started', at: startedAt, data: { agentId: 'agent-pan-4399' } },
    }), NOW);
    expect(result).toBeUndefined();
  });

  it('an accepted handoff.started past the grace window reads as not-started', () => {
    const startedAt = new Date(NOW - (WORK_START_GRACE_MS + 60_000)).toISOString();
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.started', at: startedAt, data: { agentId: 'agent-pan-4399' } },
    }), NOW);
    expect(result).toEqual({ status: 'not-started', at: startedAt, error: 'The work agent was accepted but never started' });
  });

  it('a queued handoff.started past the grace window names the container startup in the error', () => {
    const startedAt = new Date(NOW - (WORK_START_GRACE_MS + 60_000)).toISOString();
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.started', at: startedAt, data: { agentId: 'agent-pan-4399', queued: true } },
    }), NOW);
    expect(result).toEqual({
      status: 'not-started',
      at: startedAt,
      error: 'The work agent was accepted but never started (container startup did not finish)',
    });
  });

  it('a work agent started after the journal entry means the story is over — no signal', () => {
    const at = Date.parse(AT);
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.abandoned', at: AT, data: { outcome: 'gave-up', error: 'gave up' } },
      workAgentStartedAt: at + 1,
    }), NOW);
    expect(result).toBeUndefined();
  });

  it('a work agent started before the journal entry does not suppress the read', () => {
    const at = Date.parse(AT);
    const result = deriveWorkStart(facts({
      lastHandoff: { type: 'handoff.abandoned', at: AT, data: { outcome: 'gave-up', error: 'gave up' } },
      workAgentStartedAt: at - 1,
    }), NOW);
    expect(result).toEqual({ status: 'not-started', at: AT, error: 'gave up' });
  });

  // PAN-4399 review fix: `pan start` writes the work agent's own `startedAt`
  // BEFORE the spawn route answers, and `handoff.started` is journaled only
  // after that — so a real, successful auto-start always has
  // workAgentStartedAt < entry.at. Comparing against `requestedAt` (stamped
  // before the spawn call) instead of the entry's own `at` fixes the false
  // "never started" read a stopped-but-once-live agent produced.
  describe('a real accepted spawn (requestedAt ordering)', () => {
    it('an agent started between requestedAt and the entry\'s own at reads as no signal, even past grace', () => {
      const requestedAt = new Date(NOW - (WORK_START_GRACE_MS + 90_000)).toISOString();
      const startedAt = new Date(NOW - (WORK_START_GRACE_MS + 60_000)).toISOString();
      const at = new Date(NOW - (WORK_START_GRACE_MS + 30_000)).toISOString();
      const result = deriveWorkStart(facts({
        lastHandoff: { type: 'handoff.started', at, data: { agentId: 'agent-pan-4399', requestedAt } },
        workAgentStartedAt: Date.parse(startedAt),
      }), NOW);
      expect(result).toBeUndefined();
    });

    it('an agent that never started (no agent-state row) still reads not-started past grace, requestedAt notwithstanding', () => {
      const requestedAt = new Date(NOW - (WORK_START_GRACE_MS + 90_000)).toISOString();
      const at = new Date(NOW - (WORK_START_GRACE_MS + 30_000)).toISOString();
      const result = deriveWorkStart(facts({
        lastHandoff: { type: 'handoff.started', at, data: { agentId: 'agent-pan-4399', requestedAt } },
        workAgentStartedAt: null,
      }), NOW);
      expect(result).toEqual({ status: 'not-started', at, error: 'The work agent was accepted but never started' });
    });

    it('an older agent started before requestedAt still suppresses (a stale run, not this hand-off)', () => {
      const requestedAt = new Date(NOW - (WORK_START_GRACE_MS + 90_000)).toISOString();
      const at = new Date(NOW - (WORK_START_GRACE_MS + 30_000)).toISOString();
      const result = deriveWorkStart(facts({
        lastHandoff: { type: 'handoff.started', at, data: { agentId: 'agent-pan-4399', requestedAt } },
        workAgentStartedAt: Date.parse(requestedAt) - 1,
      }), NOW);
      expect(result).toEqual({ status: 'not-started', at, error: 'The work agent was accepted but never started' });
    });
  });

  // PAN-4210: while the Deacon is frozen, a deferral is journaled but never
  // actually retried — the badge/subline must say "held", not "retrying".
  describe('held (PAN-4210)', () => {
    it('a deferred entry with deaconPaused true reads as retrying and held', () => {
      const result = deriveWorkStart(facts({
        lastHandoff: { type: 'handoff.deferred', at: AT, data: { error: 'Agent ceiling reached', nextRetryAt: '2026-09-29T10:00:00.000Z', deaconPaused: true } },
      }), NOW);
      expect(result).toEqual({
        status: 'retrying', at: AT, error: 'Agent ceiling reached', nextRetryAt: '2026-09-29T10:00:00.000Z', held: true,
      });
    });

    it('a deferred entry without deaconPaused carries no held field', () => {
      const result = deriveWorkStart(facts({
        lastHandoff: { type: 'handoff.deferred', at: AT, data: { error: 'Agent ceiling reached', nextRetryAt: '2026-09-29T10:00:00.000Z' } },
      }), NOW);
      expect(result?.held).toBeUndefined();
    });
  });
});
