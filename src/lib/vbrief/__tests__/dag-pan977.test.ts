/**
 * Tests for PAN-977 DAG functions:
 *   getDispatchableItems, blockingParentCount, hasFileOverlap
 */
import { describe, it, expect } from 'vitest';
import { getDispatchableItems, blockingParentCount, hasFileOverlap, createActiveSlice, applyTaskOperation, getPipelineMirror, setPipelineMirror, getTaskGraphView, activeSlicePromptSize } from '../dag.js';
import type { VBriefDocument, VBriefItem } from '../types.js';

function makeDoc(
  items: Array<{ id: string; status?: string; files_scope?: string[] }>,
  edges: Array<{ from: string; to: string; type?: string }>,
): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'active',
      items: items.map(i => ({
        id: i.id,
        title: i.id,
        status: (i.status ?? 'pending') as any,
        metadata: i.files_scope ? { files_scope: i.files_scope } : undefined,
      })),
      edges: edges.map(e => ({ from: e.from, to: e.to, type: (e.type ?? 'blocks') as any })),
    },
  };
}

function item(id: string, files_scope?: string[]): VBriefItem {
  return {
    id,
    title: id,
    status: 'running',
    metadata: files_scope ? { files_scope } : undefined,
  };
}

// ─── getDispatchableItems ──────────────────────────────────────────────────

describe('getDispatchableItems', () => {
  it('returns all items when no edges and none merged', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], []);
    const result = getDispatchableItems(doc, new Set());
    expect(result.map(i => i.id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('blocks downstream until upstream is merged', () => {
    // a → b (a must merge before b is dispatchable)
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);

    const withoutMerge = getDispatchableItems(doc, new Set());
    expect(withoutMerge.map(i => i.id)).toContain('a');
    expect(withoutMerge.map(i => i.id)).not.toContain('b');

    const withMerge = getDispatchableItems(doc, new Set(['a']));
    expect(withMerge.map(i => i.id)).toContain('b');
  });

  it('releases item only when ALL blockers are merged (diamond)', () => {
    // a → c, b → c  (c requires both a and b)
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    );

    // Only a merged — c still blocked
    expect(getDispatchableItems(doc, new Set(['a'])).map(i => i.id)).not.toContain('c');

    // Both a and b merged — c is now dispatchable
    expect(getDispatchableItems(doc, new Set(['a', 'b'])).map(i => i.id)).toContain('c');
  });

  it('treats completed items in plan as resolved blockers', () => {
    const doc = makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b' }],
      [{ from: 'a', to: 'b' }],
    );
    // 'a' is completed in plan, so 'b' is dispatchable even without mergedIds
    expect(getDispatchableItems(doc, new Set()).map(i => i.id)).toContain('b');
  });

  it('excludes items with status running', () => {
    const doc = makeDoc([{ id: 'a', status: 'running' }], []);
    expect(getDispatchableItems(doc, new Set())).toHaveLength(0);
  });

  it('excludes cancelled items', () => {
    const doc = makeDoc([{ id: 'a', status: 'cancelled' }], []);
    expect(getDispatchableItems(doc, new Set())).toHaveLength(0);
  });

  it('returns empty for fully merged plan', () => {
    const doc = makeDoc([{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }], []);
    expect(getDispatchableItems(doc, new Set(['a', 'b']))).toHaveLength(0);
  });

  it('ignores dangling blockers whose source item is missing', () => {
    const doc = makeDoc([{ id: 'a' }], [{ from: 'missing', to: 'a' }]);
    expect(getDispatchableItems(doc, new Set()).map(i => i.id)).toContain('a');
  });

});

// ─── blockingParentCount ──────────────────────────────────────────────────

describe('blockingParentCount', () => {
  it('returns 0 for item with no incoming block edges', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], []);
    expect(blockingParentCount(doc, 'a')).toBe(0);
  });

  it('returns 1 for single blocker', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    expect(blockingParentCount(doc, 'b')).toBe(1);
  });

  it('returns 2 for diamond convergence', () => {
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    );
    expect(blockingParentCount(doc, 'c')).toBe(2);
  });

  it('does not count completed parents', () => {
    const doc = makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    );
    // 'a' is completed so only 'b' counts as a blocking parent
    expect(blockingParentCount(doc, 'c')).toBe(1);
  });

  it('does not count non-blocks edge types', () => {
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }],
      [{ from: 'a', to: 'b', type: 'informs' }],
    );
    expect(blockingParentCount(doc, 'b')).toBe(0);
  });
});

// ─── hasFileOverlap ────────────────────────────────────────────────────────

describe('hasFileOverlap', () => {
  it('returns false when candidate has no files_scope', () => {
    const running = [item('a', ['src/foo.ts'])];
    const candidate = item('b'); // no files_scope
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns false when running item has no files_scope', () => {
    const running = [item('a')]; // no files_scope
    const candidate = item('b', ['src/foo.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns false when scopes are disjoint', () => {
    const running = [item('a', ['src/lib/agents.ts'])];
    const candidate = item('b', ['src/dashboard/server/routes/swarm.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns true for exact file match', () => {
    const running = [item('a', ['src/lib/agents.ts'])];
    const candidate = item('b', ['src/lib/agents.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns true when candidate glob matches running path', () => {
    const running = [item('a', ['src/lib/agents.ts'])];
    const candidate = item('b', ['src/lib/**']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns true when running glob matches candidate path', () => {
    const running = [item('a', ['src/lib/**'])];
    const candidate = item('b', ['src/lib/agents.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns true for overlapping ** globs', () => {
    const running = [item('a', ['src/**'])];
    const candidate = item('b', ['src/lib/**']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns false for non-overlapping directory globs', () => {
    const running = [item('a', ['src/lib/**'])];
    const candidate = item('b', ['src/dashboard/**']);
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns true when any running item overlaps (not all)', () => {
    const running = [
      item('a', ['src/lib/**']),
      item('b', ['tests/**']),
    ];
    const candidate = item('c', ['src/lib/agents.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });
});


// ─── Active slices and task operations ──────────────────────────────────────

describe('active slices and task operations', () => {
  it('builds a bounded active slice with dependencies and acceptance criteria', () => {
    const doc = makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b' }],
      [{ from: 'a', to: 'b' }],
    );
    doc.plan.sequence = 7;
    doc.plan.items[1]!.subItems = [{ id: 'ac-1', title: 'Works', status: 'pending' }];
    const slice = createActiveSlice(doc, {
      issueId: 'PAN-977',
      itemId: 'b',
      synthesisOutputs: { b: { contextUpdate: 'A changed API shape' } },
    });

    expect(slice.planSequence).toBe(7);
    expect(slice.dependencies.map(i => i.id)).toEqual(['a']);
    expect(slice.acceptanceCriteria.map(i => i.id)).toEqual(['ac-1']);
    expect(slice.prompt).toContain('A changed API shape');
    expect(activeSlicePromptSize(slice)).toBeLessThan(8 * 1024);
  });

  it('applies task operations with sequence CAS and writes plan status', () => {
    const doc = makeDoc([{ id: 'a' }], []);
    doc.plan.sequence = 3;
    doc.plan.items[0]!.subItems = [{ id: 'ac-1', title: 'AC', status: 'pending' }];

    const { doc: next } = applyTaskOperation(doc, {
      type: 'done',
      itemId: 'a',
      expectedSequence: 3,
      reason: 'implemented',
    });

    expect(next.plan.sequence).toBe(4);
    expect(next.plan.items[0]!.status).toBe('completed');
    expect(next.plan.items[0]!.subItems?.[0]?.status).toBe('completed');
    expect(() => applyTaskOperation(next, { type: 'claim', itemId: 'a', expectedSequence: 3 })).toThrow(/sequence conflict/);
  });

  it('stores and reads pipeline mirror state in plan metadata', () => {
    const doc = makeDoc([{ id: 'a' }], []);
    setPipelineMirror(doc, { issueId: 'PAN-977', reviewStatus: 'pending', updatedAt: '2026-01-01T00:00:00Z' });
    expect(getPipelineMirror(doc)?.reviewStatus).toBe('pending');
  });

  it('exposes a vBRIEF-first task graph view instead of consulting Beads', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const view = getTaskGraphView(doc);
    expect(view.source).toBe('vbrief');
    expect(view.next.map(i => i.id)).toEqual(['a']);
    expect(view.waves[0]?.items.map(i => i.id)).toEqual(['a']);
  });
});
