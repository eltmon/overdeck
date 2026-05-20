import { describe, it, expect } from 'vitest';
import { computeBeadCounts } from '../issue-data-service.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';

describe('computeBeadCounts', () => {
  function makeDoc(items: Array<{ status: string }>): VBriefDocument {
    return {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'plan-1',
        title: 'Test Plan',
        status: 'active',
        items: items.map((it, idx) => ({
          id: `item-${idx}`,
          title: `Task ${idx}`,
          status: it.status as any,
        })),
        edges: [],
      },
    };
  }

  it('returns completed and total for a plan with 7 completed of 12', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      status: i < 7 ? 'completed' : 'pending',
    }));
    const doc = makeDoc(items);
    expect(computeBeadCounts(doc)).toEqual({ completed: 7, total: 12 });
  });

  it('returns 0 completed for a plan with 0 of 5', () => {
    const items = Array.from({ length: 5 }, () => ({ status: 'pending' }));
    const doc = makeDoc(items);
    expect(computeBeadCounts(doc)).toEqual({ completed: 0, total: 5 });
  });

  it('returns null when the plan has no items', () => {
    const doc = makeDoc([]);
    expect(computeBeadCounts(doc)).toBeNull();
  });

  it('returns null when the document is null', () => {
    expect(computeBeadCounts(null)).toBeNull();
  });

  it('returns null when the document has no plan', () => {
    const doc = {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: { id: 'plan-1', title: 'Test', status: 'active', items: [], edges: [] },
    } as VBriefDocument;
    expect(computeBeadCounts(doc)).toBeNull();
  });
});
