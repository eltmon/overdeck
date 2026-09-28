import { describe, expect, it } from 'vitest';
import type { AgentSnapshot, DerivedIssueState, SessionNode } from '@overdeck/contracts';
import {
  SESSION_ENDED_FALLBACK,
  deriveSessionOutcome,
  outcomeFactsFromAgent,
  outcomeFactsFromSessionNode,
  type SessionOutcomeFacts,
} from './sessionOutcome';

function facts(overrides: Partial<SessionOutcomeFacts> = {}): SessionOutcomeFacts {
  return {
    role: 'work',
    synthesized: false,
    ...overrides,
  };
}

function node(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    type: 'work',
    sessionId: 's1',
    model: 'claude-code',
    startedAt: '2026-01-01T00:00:00Z',
    duration: 60,
    status: 'stopped',
    presence: 'ended',
    ...overrides,
  } as SessionNode;
}

function derived(overrides: Partial<DerivedIssueState> = {}): DerivedIssueState {
  return {
    issueId: 'PAN-1',
    state: 'working',
    ...overrides,
  } as DerivedIssueState;
}

function agentSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agent-pan-1-work',
    issueId: 'PAN-1',
    status: 'stopped',
    ...overrides,
  } as AgentSnapshot;
}

describe('deriveSessionOutcome — precedence table', () => {
  it('row 1: work/strike role merged (prMerged) → Merged', () => {
    expect(deriveSessionOutcome(facts({ role: 'work', prMerged: true })).label).toBe('Merged');
    expect(deriveSessionOutcome(facts({ role: 'strike', issueState: 'merged' })).label).toBe('Merged');
    expect(deriveSessionOutcome(facts({ role: 'work', prMerged: true })).tone).toBe('quiet');
  });

  it('row 2: reviewer/review approved → Review approved', () => {
    expect(deriveSessionOutcome(facts({ role: 'reviewer', reviewerVerdict: 'APPROVED' })).label).toBe('Review approved');
    expect(deriveSessionOutcome(facts({ role: 'review', prReviewState: 'approved' })).label).toBe('Review approved');
  });

  it('row 3: reviewer/review changes requested → Changes requested', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'reviewer', reviewerVerdict: 'CHANGES_REQUESTED' }));
    expect(outcome.label).toBe('Changes requested');
    expect(outcome.tone).toBe('quiet');
  });

  it('changes-requested review row is quiet, never attention (no red for an ended reviewer)', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'review', prReviewState: 'changes-requested' }));
    expect(outcome.tone).toBe('quiet');
  });

  it('row 4: test role green checks → Tests passed', () => {
    expect(deriveSessionOutcome(facts({ role: 'test', prChecks: 'green' })).label).toBe('Tests passed');
  });

  it('row 5: test role red checks → Tests failed', () => {
    expect(deriveSessionOutcome(facts({ role: 'test', prChecks: 'red' })).label).toBe('Tests failed');
  });

  it('row 6: plan role finalized → Plan finalized', () => {
    expect(deriveSessionOutcome(facts({ role: 'plan', planningComplete: true })).label).toBe('Plan finalized');
  });

  it('row 7: stoppedByUser → Stopped by operator', () => {
    expect(deriveSessionOutcome(facts({ stoppedByUser: true })).label).toBe('Stopped by operator');
  });

  it('row 8: issueState closed → Stopped by close-out', () => {
    expect(deriveSessionOutcome(facts({ issueState: 'closed' })).label).toBe('Stopped by close-out');
  });

  it('row 9: recorded error status → Ended unexpectedly (attention)', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'work', synthesized: false, recordedStatus: 'error', issueState: 'working' }));
    expect(outcome.label).toBe('Ended unexpectedly');
    expect(outcome.tone).toBe('attention');
  });

  it('row 10: recorded running/starting with no stop recorded → Ended unexpectedly', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'work', recordedStatus: 'running', issueState: 'working' }));
    expect(outcome.label).toBe('Ended unexpectedly');
    expect(outcome.tone).toBe('attention');
  });

  it('row 11: primary agent ended cleanly on a known open, unmerged issue → Ended unexpectedly', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'work', synthesized: false, paused: false, issueState: 'working' }));
    expect(outcome.label).toBe('Ended unexpectedly');
    expect(outcome.tone).toBe('attention');
  });

  it('row 12: otherwise → the fallback', () => {
    expect(deriveSessionOutcome(facts())).toEqual(SESSION_ENDED_FALLBACK);
  });

  it('no kind other than ended-unexpectedly ever returns tone attention', () => {
    const kinds: SessionOutcomeFacts[] = [
      facts({ role: 'work', prMerged: true }),
      facts({ role: 'reviewer', reviewerVerdict: 'APPROVED' }),
      facts({ role: 'review', prReviewState: 'changes-requested' }),
      facts({ role: 'test', prChecks: 'green' }),
      facts({ role: 'test', prChecks: 'red' }),
      facts({ role: 'plan', planningComplete: true }),
      facts({ stoppedByUser: true }),
      facts({ issueState: 'closed' }),
      facts(),
    ];
    for (const f of kinds) {
      expect(deriveSessionOutcome(f).tone).toBe('quiet');
    }
  });
});

describe('deriveSessionOutcome — PR-derived outcomes outrank stop causes', () => {
  it('merged after close: issueState closed + prMerged true, role work → Merged', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'work', issueState: 'closed', prMerged: true }));
    expect(outcome.label).toBe('Merged');
  });

  it('PR wins over operator stop: reviewer approved + stoppedByUser true → Review approved', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'reviewer', reviewerVerdict: 'APPROVED', stoppedByUser: true }));
    expect(outcome.label).toBe('Review approved');
  });
});

describe('deriveSessionOutcome — false-alarm guards', () => {
  it('synthesized review row with no verdict and PR-derived error status → Session ended', () => {
    // The synthesized Review row's own `node.status` is PR-derived ('error' for
    // changes-requested/red, via normalizeAgentStatus) and is never failure
    // evidence — the adapter drops it for synthesized rows, so it never
    // reaches deriveSessionOutcome as recordedStatus.
    const f = outcomeFactsFromSessionNode(
      node({ type: 'review', status: 'error' }),
      derived({ state: 'working' }),
      undefined,
    );
    expect(f.recordedStatus).toBeUndefined();
    expect(deriveSessionOutcome(f)).toEqual(SESSION_ENDED_FALLBACK);
  });

  it('unknown issue state for a stopped work agent → Session ended', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'work', synthesized: false, issueState: undefined }));
    expect(outcome).toEqual(SESSION_ENDED_FALLBACK);
  });

  it('paused work agent (machine pause, no stoppedByUser), open issue → Session ended', () => {
    const outcome = deriveSessionOutcome(facts({ role: 'work', synthesized: false, paused: true, issueState: 'working' }));
    expect(outcome).toEqual(SESSION_ENDED_FALLBACK);
  });
});

describe('outcomeFactsFromSessionNode — role mapping', () => {
  it('a work-typed node whose agent snapshot has role worker maps to role worker', () => {
    const f = outcomeFactsFromSessionNode(node({ type: 'work' }), derived(), agentSnapshot({ role: 'worker' }));
    expect(f.role).toBe('worker');
  });

  it('a work-typed node whose snapshot role is worker, on an open issue with a clean stop → Session ended', () => {
    const f = outcomeFactsFromSessionNode(node({ type: 'work', status: 'stopped' }), derived({ state: 'working' }), agentSnapshot({ role: 'worker', status: 'stopped' }));
    expect(deriveSessionOutcome(f)).toEqual(SESSION_ENDED_FALLBACK);
  });

  it('planning node maps to role plan', () => {
    expect(outcomeFactsFromSessionNode(node({ type: 'planning' }), undefined, undefined).role).toBe('plan');
  });

  it('legacy node maps to role plan but is synthesized (reaches the fallback, not row 11)', () => {
    const f = outcomeFactsFromSessionNode(node({ type: 'legacy', status: 'stopped' }), derived({ state: 'working' }), undefined);
    expect(f.role).toBe('plan');
    expect(f.synthesized).toBe(true);
    expect(deriveSessionOutcome(f)).toEqual(SESSION_ENDED_FALLBACK);
  });

  it('strike/review/reviewer/test node types map 1:1', () => {
    expect(outcomeFactsFromSessionNode(node({ type: 'strike' }), undefined, undefined).role).toBe('strike');
    expect(outcomeFactsFromSessionNode(node({ type: 'review' }), undefined, undefined).role).toBe('review');
    expect(outcomeFactsFromSessionNode(node({ type: 'reviewer' }), undefined, undefined).role).toBe('reviewer');
    expect(outcomeFactsFromSessionNode(node({ type: 'test' }), undefined, undefined).role).toBe('test');
  });

  it('knowledge/lint/ship/merge node types map to other', () => {
    expect(outcomeFactsFromSessionNode(node({ type: 'knowledge' }), undefined, undefined).role).toBe('other');
    expect(outcomeFactsFromSessionNode(node({ type: 'lint' }), undefined, undefined).role).toBe('other');
    expect(outcomeFactsFromSessionNode(node({ type: 'ship' }), undefined, undefined).role).toBe('other');
    expect(outcomeFactsFromSessionNode(node({ type: 'merge' }), undefined, undefined).role).toBe('other');
  });

  it('review/test nodes are synthesized; work/plan/reviewer nodes are not', () => {
    expect(outcomeFactsFromSessionNode(node({ type: 'review' }), undefined, undefined).synthesized).toBe(true);
    expect(outcomeFactsFromSessionNode(node({ type: 'test' }), undefined, undefined).synthesized).toBe(true);
    expect(outcomeFactsFromSessionNode(node({ type: 'work' }), undefined, undefined).synthesized).toBe(false);
    expect(outcomeFactsFromSessionNode(node({ type: 'reviewer' }), undefined, undefined).synthesized).toBe(false);
  });

  it('recordedStatus prefers the agent snapshot over the node status', () => {
    const f = outcomeFactsFromSessionNode(node({ type: 'work', status: 'error' }), undefined, agentSnapshot({ status: 'stopped' }));
    expect(f.recordedStatus).toBe('stopped');
  });

  it('recordedStatus falls back to node.status for a non-synthesized, non-reviewer/lint node with no agent', () => {
    const f = outcomeFactsFromSessionNode(node({ type: 'work', status: 'error' }), undefined, undefined);
    expect(f.recordedStatus).toBe('error');
  });

  it('recordedStatus is undefined for a synthesized node with no agent', () => {
    const f = outcomeFactsFromSessionNode(node({ type: 'review', status: 'error' }), undefined, undefined);
    expect(f.recordedStatus).toBeUndefined();
  });

  it('recordedStatus is undefined for a reviewer/lint node with no agent', () => {
    expect(outcomeFactsFromSessionNode(node({ type: 'reviewer', status: 'error' }), undefined, undefined).recordedStatus).toBeUndefined();
    expect(outcomeFactsFromSessionNode(node({ type: 'lint', status: 'error' }), undefined, undefined).recordedStatus).toBeUndefined();
  });

  it('reviewer verdict comes from roundMetadata.latestReviewResult', () => {
    const f = outcomeFactsFromSessionNode(
      node({ type: 'reviewer', roundMetadata: { roundCount: 1, latestRound: 1, latestReviewResult: 'APPROVED', history: [] } }),
      undefined,
      undefined,
    );
    expect(f.reviewerVerdict).toBe('APPROVED');
  });
});

describe('outcomeFactsFromAgent — drawer role mapping', () => {
  it('review agent whose id matches -review-<role> maps to reviewer', () => {
    const f = outcomeFactsFromAgent({ id: 'agent-pan-1-review-security', status: 'stopped', role: 'review' }, undefined);
    expect(f.role).toBe('reviewer');
  });

  it('review agent whose id does not match the per-role pattern maps to review', () => {
    const f = outcomeFactsFromAgent({ id: 'agent-pan-1-review', status: 'stopped', role: 'review' }, undefined);
    expect(f.role).toBe('review');
  });

  it('plan/work/strike/test/worker roles map 1:1', () => {
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'plan' }, undefined).role).toBe('plan');
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'work' }, undefined).role).toBe('work');
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'strike' }, undefined).role).toBe('strike');
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'test' }, undefined).role).toBe('test');
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'worker' }, undefined).role).toBe('worker');
  });

  it('an unknown role maps to other', () => {
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'lint' }, undefined).role).toBe('other');
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped' }, undefined).role).toBe('other');
  });

  it('never synthesized', () => {
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'work' }, undefined).synthesized).toBe(false);
  });

  it('D6: planningComplete is true once derived.state has moved past planning, excluding closed', () => {
    for (const state of ['planned', 'working', 'in-review', 'changes-requested', 'ready', 'merged'] as const) {
      expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'plan' }, derived({ state })).planningComplete).toBe(true);
    }
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'plan' }, derived({ state: 'closed' })).planningComplete).toBeUndefined();
    expect(outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'plan' }, derived({ state: 'backlog' })).planningComplete).toBeUndefined();
  });

  it('a closed issue falls through to Stopped by close-out via the drawer adapter', () => {
    const f = outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'plan' }, derived({ state: 'closed' }));
    expect(deriveSessionOutcome(f).label).toBe('Stopped by close-out');
  });

  it('a clean stopped status is not failure evidence for the drawer (only row 11 can flag it)', () => {
    const f = outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'work' }, derived({ state: 'working' }));
    expect(f.recordedStatus).toBe('stopped');
    expect(deriveSessionOutcome(f).label).toBe('Ended unexpectedly');
  });

  it('stoppedByUser and paused pass through from the agent record', () => {
    const stopped = outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'work', stoppedByUser: true }, derived({ state: 'working' }));
    expect(deriveSessionOutcome(stopped).label).toBe('Stopped by operator');

    const paused = outcomeFactsFromAgent({ id: 'a', status: 'stopped', role: 'work', paused: true }, derived({ state: 'working' }));
    expect(deriveSessionOutcome(paused)).toEqual(SESSION_ENDED_FALLBACK);
  });
});
