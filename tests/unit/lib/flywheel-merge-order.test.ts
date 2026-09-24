import { describe, it, expect } from 'vitest';
import {
  computePredictedConflictSignals,
  orderMergeCandidates,
} from '../../../src/lib/flywheel-merge-order.js';
import type { XBriefDocument } from '../../../src/lib/xbrief/types.js';
import type { IssueFileFootprint } from '../../../src/lib/flywheel-merge-order.js';

// A declared footprint: the sorted union of every item's files_scope. (Built here since
// PAN-3958 CH-8 deleted the test-only declaredIssueFootprint/computeIssueFootprint helpers.)
function declaredIssueFootprint(issueId: string, doc: XBriefDocument): IssueFileFootprint {
  const files = new Set<string>();
  for (const item of doc.plan.items) for (const file of item.metadata?.files_scope ?? []) files.add(file);
  return { issueId, files: Array.from(files).sort(), source: 'declared' };
}

const c = (issueId: string, footprint: number, conflictCount: number) => ({
  issueId,
  footprint,
  conflictCount,
});

function spec(issueId: string, filesScope: string[]): XBriefDocument {
  return {
    xBRIEFInfo: { version: '1.0', created: '2026-06-30T00:00:00Z' },
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

    const ordered = orderMergeCandidates(signals);
    expect(ordered.map((candidate) => candidate.issueId)).toEqual(['PAN-10', 'PAN-20']);
    expect(ordered.every((candidate) => candidate.conflictCount > 0)).toBe(true);
  });
});



