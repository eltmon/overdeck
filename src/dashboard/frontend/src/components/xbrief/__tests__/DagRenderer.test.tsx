import { describe, expect, it } from 'vitest';
import { layoutDag, type DagEdge, type DagNode } from '../DagRenderer';

const nodes: DagNode[] = [
  { id: 'a', title: 'design the storage', status: 'done' },
  { id: 'b', title: 'write the docs', status: 'done' },
  { id: 'c', title: 'wire the dispatch', status: 'done' },
  { id: 'd', title: 'read door', status: 'done' },
  { id: 'e', title: 'write door', status: 'in-progress' },
  { id: 'f', title: 'editable toggle', status: 'waiting' },
];
const edges: DagEdge[] = [
  { from: 'a', to: 'c' },
  { from: 'a', to: 'd' },
  { from: 'c', to: 'e' },
  { from: 'd', to: 'e' },
  { from: 'e', to: 'f' },
];

describe('layoutDag (PAN-2400)', () => {
  it('assigns strictly increasing ranks along every edge (arrows always point right)', () => {
    const { positioned } = layoutDag(nodes, edges);
    const byId = new Map(positioned.map((n) => [n.id, n]));
    for (const edge of edges) {
      expect(byId.get(edge.from)!.rank).toBeLessThan(byId.get(edge.to)!.rank);
      expect(byId.get(edge.from)!.x).toBeLessThan(byId.get(edge.to)!.x);
    }
  });

  it('never overlaps nodes and bounds fit every node (fit-to-container zoom)', () => {
    const { positioned, width, height } = layoutDag(nodes, edges);
    for (const node of positioned) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + 168).toBeLessThanOrEqual(width);
      expect(node.y + 46).toBeLessThanOrEqual(height);
    }
    for (const a of positioned) {
      for (const b of positioned) {
        if (a.id === b.id) continue;
        const overlap = Math.abs(a.x - b.x) < 168 && Math.abs(a.y - b.y) < 46;
        expect(overlap).toBe(false);
      }
    }
  });

  it('degrades gracefully on a cycle instead of hanging', () => {
    const cyclic: DagEdge[] = [...edges, { from: 'f', to: 'a' }];
    expect(() => layoutDag(nodes, cyclic)).not.toThrow();
  });
});
