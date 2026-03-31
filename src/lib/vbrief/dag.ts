/**
 * vBRIEF DAG utilities — critical path and graph analysis
 */

import type { VBriefDocument } from './types.js';

/**
 * Computes the critical path of a vBRIEF plan using the longest-path
 * algorithm on 'blocks' edges.
 *
 * All edges have weight 1 (one step). Returns an ordered list of item IDs
 * representing the longest dependency chain in the DAG.
 *
 * Returns [] for empty plans or plans with no blocking edges.
 */
export function criticalPath(doc: VBriefDocument): string[] {
  const items = doc.plan.items;
  const blockEdges = doc.plan.edges.filter(e => e.type === 'blocks');

  if (items.length === 0 || blockEdges.length === 0) return [];

  const itemIds = new Set(items.map(i => i.id));

  // Build adjacency: from → list of 'to' IDs
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of itemIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of blockEdges) {
    if (itemIds.has(edge.from) && itemIds.has(edge.to)) {
      outgoing.get(edge.from)!.push(edge.to);
      incoming.get(edge.to)!.push(edge.from);
    }
  }

  // Topological sort (Kahn's algorithm) for longest-path DP.
  // Assumption: the plan DAG is acyclic. Cycles are not detected; if present,
  // nodes in the cycle will retain non-zero in-degree and be excluded from
  // topoOrder, effectively treating the cycle as a disconnected subgraph
  // (the longest path through non-cyclic nodes is still returned correctly).
  const inDegree = new Map<string, number>();
  for (const id of itemIds) {
    inDegree.set(id, incoming.get(id)!.length);
  }

  const queue: string[] = [];
  for (const id of itemIds) {
    if (inDegree.get(id) === 0) queue.push(id);
  }

  // DP: dist[id] = longest path ending at id, prev[id] = predecessor on that path
  const dist = new Map<string, number>(Array.from(itemIds).map(id => [id, 0]));
  const prev = new Map<string, string | null>(Array.from(itemIds).map(id => [id, null]));

  const topoOrder: string[] = [];
  const q = [...queue];
  while (q.length > 0) {
    const u = q.shift()!;
    topoOrder.push(u);
    for (const v of outgoing.get(u) ?? []) {
      const newDist = dist.get(u)! + 1;
      if (newDist > dist.get(v)!) {
        dist.set(v, newDist);
        prev.set(v, u);
      }
      const newDeg = inDegree.get(v)! - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) q.push(v);
    }
  }

  // Find the node with the maximum distance (end of critical path)
  let maxDist = 0;
  let endNode: string | null = null;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  if (!endNode || maxDist === 0) return [];

  // Reconstruct path by following prev pointers
  const path: string[] = [];
  let current: string | null = endNode;
  while (current !== null) {
    path.unshift(current);
    current = prev.get(current) ?? null;
  }

  return path;
}
