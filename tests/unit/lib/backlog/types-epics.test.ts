import { describe, it, expect } from 'vitest';
import { parseSequenceJson } from '../../../../src/lib/backlog/types.js';

/**
 * PAN-2081 Phase 1: the SequenceDoc schema gains an optional `isEpic` node flag
 * and a `contains` edge type (epic → child membership). Both must validate and
 * round-trip through parseSequenceJson; a non-boolean isEpic must be rejected.
 */
function baseNode(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issue: 'PAN-1',
    rank: 1,
    size: 'M',
    importance: 'high',
    score: 50,
    condition: 'ok',
    dependsOn: [],
    why: 'x',
    gate: 'auto',
    planning: 'auto',
    ...over,
  };
}

function baseDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    project: 'overdeck',
    generatedAt: '2026-06-26T00:00:00Z',
    model: 'm',
    pass: 'creation',
    openCount: 1,
    nodes: [baseNode()],
    edges: [],
    ...over,
  };
}

describe('SequenceDoc validation — epics (PAN-2081)', () => {
  it('accepts and round-trips a node with isEpic: true', () => {
    const r = parseSequenceJson(baseDoc({ nodes: [baseNode({ isEpic: true })] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.nodes[0]!.isEpic).toBe(true);
  });

  it('leaves isEpic undefined when absent', () => {
    const r = parseSequenceJson(baseDoc());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.nodes[0]!.isEpic).toBeUndefined();
  });

  it('rejects a non-boolean isEpic', () => {
    const r = parseSequenceJson(baseDoc({ nodes: [baseNode({ isEpic: 'yes' })] }));
    expect(r.ok).toBe(false);
  });

  it('accepts a contains edge (epic → child membership)', () => {
    const edges = [{ from: 'PAN-2075', to: 'PAN-2076', type: 'contains', source: 'github-ref', confidence: 1 }];
    const r = parseSequenceJson(baseDoc({ edges }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.edges[0]!.type).toBe('contains');
  });
});
