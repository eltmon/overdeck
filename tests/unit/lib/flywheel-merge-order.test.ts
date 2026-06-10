import { describe, it, expect } from 'vitest';
import { orderMergeCandidates, planMergeTrain, planUatCandidate } from '../../../src/lib/flywheel-merge-order.js';

const c = (issueId: string, footprint: number, conflictCount: number) => ({
  issueId,
  footprint,
  conflictCount,
});

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

describe('planUatCandidate (PAN-1691 on-demand UAT branch)', () => {
  const qi = (issueId: string, batchGroup: 'batch' | 'serialize') => ({
    issueId,
    title: issueId,
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
