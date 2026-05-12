import { describe, it, expect } from 'vitest';
import { criticalPath } from '../dag.js';
import type { VBriefDocument } from '../types.js';

function makeDoc(items: Array<{ id: string }>, edges: Array<{ from: string; to: string; type?: string }>): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'active',
      items: items.map(i => ({ id: i.id, title: i.id, status: 'pending' })),
      edges: edges.map(e => ({ from: e.from, to: e.to, type: (e.type ?? 'blocks') as any })),
    },
  };
}

describe('criticalPath', () => {
  it('returns [] for empty plan', () => {
    const doc = makeDoc([], []);
    expect(criticalPath(doc)).toEqual([]);
  });

  it('returns [] for plan with no blocking edges', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b', type: 'informs' }]);
    expect(criticalPath(doc)).toEqual([]);
  });

  it('returns [] for single item with no edges', () => {
    const doc = makeDoc([{ id: 'a' }], []);
    expect(criticalPath(doc)).toEqual([]);
  });

  it('returns [] when legacy workspace plans omit edges', () => {
    const doc = makeDoc([{ id: 'a' }], []);
    delete (doc.plan as Partial<typeof doc.plan>).edges;
    expect(criticalPath(doc)).toEqual([]);
  });

  it('returns linear chain [a, b, c] for a→b→c', () => {
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    );
    expect(criticalPath(doc)).toEqual(['a', 'b', 'c']);
  });

  it('returns two-node path for single blocking edge', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    expect(criticalPath(doc)).toEqual(['a', 'b']);
  });

  it('picks the longer path in a diamond DAG', () => {
    // a → b → d (length 3)
    // a → c → d (length 3 — tie, both are critical)
    // Add extra node on one branch to make it clearly longer
    // a → b → c → e (length 4) vs a → d → e (length 3)
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'e' },
        { from: 'a', to: 'd' },
        { from: 'd', to: 'e' },
      ],
    );
    const path = criticalPath(doc);
    // The longest path is a → b → c → e (4 nodes)
    expect(path).toEqual(['a', 'b', 'c', 'e']);
  });

  it('handles non-blocking edges alongside blocking edges', () => {
    // a --blocks--> b --blocks--> c
    // x --informs--> b (should not extend critical path)
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'x' }],
      [
        { from: 'a', to: 'b', type: 'blocks' },
        { from: 'b', to: 'c', type: 'blocks' },
        { from: 'x', to: 'b', type: 'informs' },
      ],
    );
    const path = criticalPath(doc);
    expect(path).toEqual(['a', 'b', 'c']);
    expect(path).not.toContain('x');
  });

  it('ignores edges referencing nonexistent items', () => {
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }],
      [{ from: 'a', to: 'b' }, { from: 'ghost', to: 'b' }],
    );
    const path = criticalPath(doc);
    expect(path).toEqual(['a', 'b']);
  });

  it('returns longest path when multiple chains exist', () => {
    // Chain 1: p → q (length 2)
    // Chain 2: x → y → z (length 3) — should be chosen
    const doc = makeDoc(
      [{ id: 'p' }, { id: 'q' }, { id: 'x' }, { id: 'y' }, { id: 'z' }],
      [
        { from: 'p', to: 'q' },
        { from: 'x', to: 'y' },
        { from: 'y', to: 'z' },
      ],
    );
    expect(criticalPath(doc)).toEqual(['x', 'y', 'z']);
  });
});
