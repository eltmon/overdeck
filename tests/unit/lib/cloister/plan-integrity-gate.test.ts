import { describe, expect, it } from 'vitest';
import { diffPlanDocuments } from '../../../../src/lib/cloister/plan-integrity-gate.js';

function makeSpec(): Record<string, any> {
  return {
    xBRIEFInfo: { version: '0.8', created: '2026-09-29T00:00:00Z', updated: '2026-09-29T00:00:00Z' },
    status: 'proposed',
    plan: {
      id: 'pan-1',
      title: 'Plan',
      status: 'proposed',
      sequence: 1,
      updated: '2026-09-29T00:00:00Z',
      narratives: { Problem: 'the problem', Outcome: 'the outcome' },
      items: [
        {
          id: 'x',
          title: 'Item x',
          status: 'pending',
          items: [{ id: 'x.ac1', title: 'Given X, then Y', status: 'pending', metadata: { kind: 'acceptance_criterion' } }],
        },
        { id: 'y', title: 'Item y', status: 'pending' },
      ],
      edges: [{ from: 'x', to: 'y', type: 'blocks' }],
    },
  };
}

describe('diffPlanDocuments (PAN-1728)', () => {
  it('reports a changed item title against the item id', () => {
    const head = makeSpec();
    head.plan.items[1].title = 'Rewritten';
    expect(diffPlanDocuments(makeSpec(), head)).toEqual([{ subject: 'y', kind: 'item-changed', keys: ['title'] }]);
  });

  it('reports a nested acceptance-criterion status change against the AC id', () => {
    const head = makeSpec();
    head.plan.items[0].items[0].status = 'completed';
    expect(diffPlanDocuments(makeSpec(), head)).toEqual([{ subject: 'x.ac1', kind: 'item-changed', keys: ['status'] }]);
  });

  it('ignores the five lifecycle status fields', () => {
    const head = makeSpec();
    head.status = 'active';
    head.plan.status = 'running';
    head.plan.updated = '2026-09-30T00:00:00Z';
    head.plan.sequence = 4;
    head.xBRIEFInfo.updated = '2026-09-30T00:00:00Z';
    expect(diffPlanDocuments(makeSpec(), head)).toEqual([]);
  });

  it('returns no violations for identical documents', () => {
    expect(diffPlanDocuments(makeSpec(), makeSpec())).toEqual([]);
  });

  it('ignores object key order', () => {
    const reference = makeSpec();
    const reordered = {
      plan: {
        ...Object.fromEntries(Object.entries(reference.plan).reverse()),
        items: reference.plan.items.map((item: Record<string, unknown>) => Object.fromEntries(Object.entries(item).reverse())),
      },
      status: reference.status,
      xBRIEFInfo: Object.fromEntries(Object.entries(reference.xBRIEFInfo).reverse()),
    };
    expect(diffPlanDocuments(reference, reordered)).toEqual([]);
  });

  it('treats a legacy vBRIEFInfo envelope as equal to the same xBRIEFInfo content', () => {
    const { xBRIEFInfo, ...rest } = makeSpec();
    const legacy = { vBRIEFInfo: xBRIEFInfo, ...rest };
    expect(diffPlanDocuments(legacy, makeSpec())).toEqual([]);
  });

  it('reports narrative, added-item and removed-item changes', () => {
    const head = makeSpec();
    head.plan.narratives.Problem = 'a different problem';
    head.plan.items = [head.plan.items[0], { id: 'z', title: 'Item z', status: 'pending' }];
    expect(diffPlanDocuments(makeSpec(), head)).toEqual([
      { subject: 'y', kind: 'item-removed' },
      { subject: 'z', kind: 'item-added' },
      { subject: 'plan.narratives', kind: 'field-changed' },
    ]);
  });

  it('reports other plan fields and top-level fields by dotted path', () => {
    const head = makeSpec();
    head.plan.title = 'New title';
    head.plan.edges = [];
    head.xBRIEFInfo.version = '0.9';
    expect(diffPlanDocuments(makeSpec(), head)).toEqual([
      { subject: 'plan.edges', kind: 'field-changed' },
      { subject: 'plan.title', kind: 'field-changed' },
      { subject: 'xBRIEFInfo', kind: 'field-changed' },
    ]);
  });

  it('keys items without an id by array position', () => {
    const reference = makeSpec();
    reference.plan.items.push({ title: 'anonymous', status: 'pending' });
    const head = makeSpec();
    head.plan.items.push({ title: 'anonymous', status: 'completed' });
    expect(diffPlanDocuments(reference, head)).toEqual([{ subject: 'plan.items[2]', kind: 'item-changed', keys: ['status'] }]);
  });
});
