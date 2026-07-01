import { describe, it, expect } from 'vitest';
import {
  computePredictedConflictSignals,
  declaredIssueFootprint,
  orderMergeCandidates,
  pickFromSequence,
  planMergeTrain,
  planUatCandidate,
} from '../../../src/lib/flywheel-merge-order.js';
import type { SequenceNode } from '../../../src/lib/backlog/types.js';
import type { VBriefDocument } from '../../../src/lib/vbrief/types.js';

const c = (issueId: string, footprint: number, conflictCount: number) => ({
  issueId,
  footprint,
  conflictCount,
});

function spec(issueId: string, filesScope: string[]): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-06-30T00:00:00Z' },
    plan: {
      id: issueId.toLowerCase(),
      title: issueId,
      status: 'proposed',
      items: [{
        id: 'item-1',
        title: 'Item',
        status: 'pending',
        metadata: { files_scope: filesScope },
      }],
      edges: [],
    },
  };
}

function node(issue: string, rank: number): SequenceNode {
  return {
    issue,
    rank,
    size: 'S',
    importance: 'medium',
    score: 50,
    condition: 'ok',
    dependsOn: [],
    why: `Why for ${issue}`,
    gate: 'auto',
    planning: 'auto',
  };
}

describe('orderMergeCandidates (PAN-1691 conflict-aware order)', () => {
  it('orders all-disjoint candidates by issue number', () => {
    const out = orderMergeCandidates([c('PAN-30', 5, 0), c('PAN-10', 99, 0), c('PAN-20', 1, 0)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-10', 'PAN-20', 'PAN-30']);
  });

  it('puts disjoint (safe) candidates before conflicting ones', () => {
    const out = orderMergeCandidates([c('PAN-1', 100, 2), c('PAN-99', 1, 0)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-99', 'PAN-1']);
  });

  it('orders conflicting candidates broadest-footprint first', () => {
    const out = orderMergeCandidates([c('PAN-5', 3, 1), c('PAN-6', 40, 1), c('PAN-7', 12, 1)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-6', 'PAN-7', 'PAN-5']);
  });

  it('breaks footprint ties within a cluster by issue number', () => {
    const out = orderMergeCandidates([c('PAN-8', 10, 1), c('PAN-3', 10, 1)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-3', 'PAN-8']);
  });

  it('combines tiers: disjoint-by-number, then conflicting-by-footprint', () => {
    const out = orderMergeCandidates([
      c('PAN-50', 8, 1),
      c('PAN-12', 2, 0),
      c('PAN-40', 30, 2),
      c('PAN-3', 99, 0),
    ]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-3', 'PAN-12', 'PAN-40', 'PAN-50']);
  });
});

describe('planMergeTrain (PAN-1691 batch/serialize plan)', () => {
  it('batches all disjoint candidates with an empty serialize list', () => {
    const plan = planMergeTrain([c('PAN-2', 4, 0), c('PAN-1', 9, 0)]);
    expect(plan.batch).toEqual(['PAN-1', 'PAN-2']);
    expect(plan.serialize).toEqual([]);
    expect(plan.order).toEqual(['PAN-1', 'PAN-2']);
  });

  it('splits disjoint into batch and conflicting into serialize (broadest first)', () => {
    const plan = planMergeTrain([c('PAN-10', 5, 0), c('PAN-20', 3, 1), c('PAN-30', 50, 2)]);
    expect(plan.batch).toEqual(['PAN-10']);
    expect(plan.serialize).toEqual(['PAN-30', 'PAN-20']);
    expect(plan.order).toEqual(['PAN-10', 'PAN-30', 'PAN-20']);
  });

  it('returns empty plan for no candidates', () => {
    expect(planMergeTrain([])).toEqual({ batch: [], serialize: [], order: [] });
  });
});

describe('computePredictedConflictSignals (declared-footprint conflict signal)', () => {
  it('counts overlapping declared footprints before branches exist', () => {
    const signals = computePredictedConflictSignals([
      declaredIssueFootprint('PAN-10', spec('PAN-10', ['src/shared.ts', 'src/a.ts'])),
      declaredIssueFootprint('PAN-20', spec('PAN-20', ['src/shared.ts', 'src/b.ts'])),
    ]);

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: 'PAN-10', source: 'declared', footprint: 2, conflictCount: 1, conflictsWith: ['PAN-20'] }),
      expect.objectContaining({ issueId: 'PAN-20', source: 'declared', footprint: 2, conflictCount: 1, conflictsWith: ['PAN-10'] }),
    ]));
  });

  it('lets actual changed files replace a declared footprint once a branch exists', () => {
    const signals = computePredictedConflictSignals([
      declaredIssueFootprint('PAN-10', spec('PAN-10', ['src/shared.ts'])),
      { issueId: 'PAN-10', source: 'actual' as const, files: ['src/actual-only.ts'] },
      declaredIssueFootprint('PAN-20', spec('PAN-20', ['src/shared.ts'])),
    ]);

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: 'PAN-10', source: 'actual', footprint: 1, conflictCount: 0, conflictsWith: [] }),
      expect.objectContaining({ issueId: 'PAN-20', source: 'declared', footprint: 1, conflictCount: 0, conflictsWith: [] }),
    ]));
  });

  it('excludes configured hotspot files from the predicted-conflict computation', () => {
    const signals = computePredictedConflictSignals([
      declaredIssueFootprint('PAN-10', spec('PAN-10', ['package-lock.json'])),
      declaredIssueFootprint('PAN-20', spec('PAN-20', ['package-lock.json'])),
    ], { hotspots: ['package-lock.json'] });

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: 'PAN-10', footprint: 0, conflictCount: 0, conflictsWith: [] }),
      expect.objectContaining({ issueId: 'PAN-20', footprint: 0, conflictCount: 0, conflictsWith: [] }),
    ]));
  });

  it('is advisory only: conflict counts order candidates without dropping them', () => {
    const signals = computePredictedConflictSignals([
      declaredIssueFootprint('PAN-10', spec('PAN-10', ['src/shared.ts'])),
      declaredIssueFootprint('PAN-20', spec('PAN-20', ['src/shared.ts'])),
    ]);

    expect(planMergeTrain(signals).order).toEqual(['PAN-10', 'PAN-20']);
    expect(planMergeTrain(signals).serialize).toEqual(['PAN-10', 'PAN-20']);
  });
});

describe('pickFromSequence predicted-conflict signal', () => {
  it('uses predicted conflicts as an advisory launch-order preference', () => {
    const signals = computePredictedConflictSignals([
      declaredIssueFootprint('PAN-10', spec('PAN-10', ['src/shared.ts'])),
      declaredIssueFootprint('PAN-20', spec('PAN-20', ['src/shared.ts'])),
      declaredIssueFootprint('PAN-30', spec('PAN-30', ['src/isolated.ts'])),
    ]);

    const result = pickFromSequence([node('PAN-10', 1), node('PAN-30', 2), node('PAN-20', 3)], {
      issueLabels: () => ['ready', 'released'],
      isReadyOrHasPrd: () => true,
      requireReady: true,
      predictedConflictSignals: signals,
    });

    expect(result).toMatchObject({
      issueId: 'PAN-30',
      predictedConflictCount: 0,
      predictedConflictsWith: [],
    });
  });

  it('never gates out a pickable issue solely because it has predicted conflicts', () => {
    const signals = computePredictedConflictSignals([
      declaredIssueFootprint('PAN-10', spec('PAN-10', ['src/shared.ts'])),
      declaredIssueFootprint('PAN-20', spec('PAN-20', ['src/shared.ts'])),
    ]);

    const result = pickFromSequence([node('PAN-10', 1)], {
      issueLabels: () => ['ready', 'released'],
      isReadyOrHasPrd: () => true,
      requireReady: true,
      predictedConflictSignals: signals,
    });

    expect(result).toMatchObject({
      issueId: 'PAN-10',
      predictedConflictCount: 1,
      predictedConflictsWith: ['PAN-20'],
    });
  });
});

describe('planUatCandidate (PAN-1691 on-demand UAT branch)', () => {
  const qi = (issueId: string, batchGroup: 'batch' | 'serialize') => ({
    issueId,
    title: issueId,
    branchName: `feature/${issueId.toLowerCase()}`,
    mergeOrder: 1,
    conflictsWith: [] as string[],
    batchGroup,
  });

  it('bundles only the batch items and dates the branch name', () => {
    const plan = planUatCandidate(
      [qi('PAN-1', 'batch'), qi('PAN-2', 'serialize'), qi('PAN-3', 'batch')],
      { dateIso: '2026-06-09T12:00:00.000Z' },
    );
    expect(plan.bundled).toEqual(['PAN-1', 'PAN-3']);
    expect(plan.branchName).toBe('uat/candidate-2026-06-09');
  });

  it('uses the label in the branch name', () => {
    const plan = planUatCandidate([qi('PAN-1', 'batch')], { dateIso: '2026-06-09T00:00:00Z', label: 'pan' });
    expect(plan.branchName).toBe('uat/pan-2026-06-09');
  });

  it('returns an empty bundle when nothing is batchable', () => {
    expect(planUatCandidate([qi('PAN-1', 'serialize')], { dateIso: '2026-06-09T00:00:00Z' }).bundled).toEqual([]);
  });
});

describe('MERGE_GATE_VERBS (PAN-1736 verb contract)', () => {
  it("treats both 'shipping' and 'merging' as at-the-merge-gate", async () => {
    const { MERGE_GATE_VERBS } = await import('../../../src/lib/flywheel-merge-order.js');
    expect(MERGE_GATE_VERBS.has('shipping')).toBe(true);
    expect(MERGE_GATE_VERBS.has('merging')).toBe(true);
  });

  it('excludes verbs that do not mean merge-ready', async () => {
    const { MERGE_GATE_VERBS } = await import('../../../src/lib/flywheel-merge-order.js');
    for (const verb of ['planning', 'working', 'reviewing', 'testing', 'blocked', 'parked'] as const) {
      expect(MERGE_GATE_VERBS.has(verb)).toBe(false);
    }
  });
});

describe('mergeGateEligibility (PAN-1759 verb vs authoritative state)', () => {
  it('passes only when review passed and test passed/skipped', async () => {
    const { mergeGateEligibility } = await import('../../../src/lib/review-status.js');
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'passed' })).toEqual({ eligible: true });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'skipped', verificationStatus: 'pending' })).toEqual({ eligible: true });
  });

  it('rejects mid-review, unfinished tests, failed verification, missing records, and already-merged', async () => {
    const { mergeGateEligibility } = await import('../../../src/lib/review-status.js');
    expect(mergeGateEligibility({ reviewStatus: 'reviewing', testStatus: 'pending', verificationStatus: 'passed' }))
      .toEqual({ eligible: false, reason: 'review is reviewing' });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'testing', verificationStatus: 'passed' }))
      .toEqual({ eligible: false, reason: 'test is testing' });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'failed' }))
      .toEqual({ eligible: false, reason: 'verification failed' });
    expect(mergeGateEligibility(null)).toEqual({ eligible: false, reason: 'no review record' });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'passed', mergeStatus: 'merged' }))
      .toEqual({ eligible: false, reason: 'already merged' });
  });
});

describe('computeMergeQueue eligibility gate (PAN-1759)', () => {
  it('excludes verb-tagged items the review pipeline has not cleared, reporting each rejection', async () => {
    const { Effect } = await import('effect');
    const { layer: nodeServicesLayer } = await import('@effect/platform-node/NodeServices');
    const { computeMergeQueue } = await import('../../../src/lib/flywheel-merge-order.js');
    const items = [
      { issueId: 'PAN-1', title: 'Mid-review rider', verb: 'merging' },
      { issueId: 'PAN-2', title: 'Still testing', verb: 'shipping' },
      { issueId: 'PAN-3', title: 'Not at the gate', verb: 'working' },
    ] as never[];
    const rejected: Array<[string, string]> = [];
    const queue = await Effect.runPromise(
      computeMergeQueue(items, '/nonexistent', {
        eligibility: (issueId) =>
          issueId === 'PAN-1'
            ? { eligible: false, reason: 'review is reviewing' }
            : { eligible: false, reason: 'test is testing' },
        onIneligible: (issueId, reason) => rejected.push([issueId, reason]),
      }).pipe(Effect.provide(nodeServicesLayer)),
    );
    expect(queue).toEqual([]);
    // PAN-3 never reaches the eligibility gate — wrong verb.
    expect(rejected).toEqual([
      ['PAN-1', 'review is reviewing'],
      ['PAN-2', 'test is testing'],
    ]);
  });
});
