/**
 * PAN-2400 — the shared vBRIEF DAG renderer ("The plan, as a map").
 *
 * One SVG component for every plan-graph surface. Replaces the broken
 * per-view DAG renderings (wrong zoom, missing arrows). Design contract:
 * docs/design/mockups/issue-cockpit-redesign.html §"The plan, as a map".
 *
 * - Layered left-to-right layout by topological rank; no overlapping nodes.
 * - Directed edges with arrowheads (SVG marker), curved bezier paths.
 * - Fit-to-container by default: viewBox derived from layout bounds, so the
 *   graph can never render clipped or mis-zoomed.
 * - Status language (non-technical): done = teal ✓ · in progress = blue,
 *   pulsing · waiting = dashed neutral. Colors come from the dashboard theme
 *   CSS variables so light/dark both work with no local palette.
 */

import { useMemo } from 'react';

export interface DagNode {
  id: string;
  /** Plain-language title (task title), NOT the task id. */
  title: string;
  /** Who is/was on it — model or tier name, shown small. */
  assignee?: string;
  status: 'done' | 'in-progress' | 'waiting' | 'blocked';
}

export interface DagEdge {
  /** Must finish first. */
  from: string;
  to: string;
}

export interface DagRendererProps {
  nodes: DagNode[];
  edges: DagEdge[];
  onNodeClick?: (id: string) => void;
  /** Compact mode shrinks nodes for sidebar embeds. */
  compact?: boolean;
  showLegend?: boolean;
}

const NODE_W = 176;
const NODE_H = 54;
const COL_GAP = 92;
const ROW_GAP = 26;
const PAD = 18;

interface Positioned extends DagNode {
  x: number;
  y: number;
  rank: number;
}

/** Layered layout: topological ranks left→right, rank members stacked with a
 * simple barycenter pass so edges stay short. Deterministic, no randomness. */
export function layoutDag(nodes: DagNode[], edges: DagEdge[]): { positioned: Positioned[]; width: number; height: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
  }

  // Longest-path rank (handles diamonds; cycles degrade to input order).
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard — malformed plan, degrade
    visiting.add(id);
    const parentRanks = (parents.get(id) ?? []).map(rankOf);
    const value = parentRanks.length === 0 ? 0 : Math.max(...parentRanks) + 1;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  nodes.forEach((node) => rankOf(node.id));

  const ranks = new Map<number, DagNode[]>();
  for (const node of nodes) {
    const r = rank.get(node.id) ?? 0;
    ranks.set(r, [...(ranks.get(r) ?? []), node]);
  }

  // Barycenter ordering within each rank (one pass, parents' mean row).
  const rowIndex = new Map<string, number>();
  const sortedRankKeys = [...ranks.keys()].sort((a, b) => a - b);
  for (const r of sortedRankKeys) {
    const members = ranks.get(r)!;
    const scored = members.map((node, index) => {
      const parentRows = (parents.get(node.id) ?? []).map((p) => rowIndex.get(p) ?? 0);
      const score = parentRows.length ? parentRows.reduce((a, b) => a + b, 0) / parentRows.length : index;
      return { node, score, index };
    });
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    scored.forEach((entry, row) => rowIndex.set(entry.node.id, row));
    ranks.set(r, scored.map((entry) => entry.node));
  }

  const maxRows = Math.max(1, ...[...ranks.values()].map((members) => members.length));
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  const width = PAD * 2 + sortedRankKeys.length * NODE_W + Math.max(0, sortedRankKeys.length - 1) * COL_GAP;

  const positioned: Positioned[] = [];
  for (const r of sortedRankKeys) {
    const members = ranks.get(r)!;
    const columnHeight = members.length * NODE_H + (members.length - 1) * ROW_GAP;
    const yStart = PAD + (height - PAD * 2 - columnHeight) / 2;
    members.forEach((node, row) => {
      positioned.push({
        ...node,
        rank: r,
        x: PAD + r * (NODE_W + COL_GAP),
        y: yStart + row * (NODE_H + ROW_GAP),
      });
    });
  }

  return { positioned, width, height };
}

/** Wrap a title onto at most two lines at word boundaries; ellipsize line 2. */
function wrapTitle(title: string, perLine = 24): string[] {
  if (title.length <= perLine) return [title];
  const words = title.split(' ');
  let line1 = '';
  let index = 0;
  while (index < words.length && (line1 + ' ' + words[index]).trim().length <= perLine) {
    line1 = (line1 + ' ' + words[index]).trim();
    index += 1;
  }
  if (!line1) { line1 = title.slice(0, perLine); return [line1, `${title.slice(perLine, perLine * 2 - 1)}…`]; }
  const rest = words.slice(index).join(' ');
  if (!rest) return [line1];
  return [line1, rest.length > perLine ? `${rest.slice(0, perLine - 1)}…` : rest];
}

const STATUS_LABEL: Record<DagNode['status'], string> = {
  done: 'done',
  'in-progress': 'happening now',
  waiting: 'waiting its turn',
  blocked: 'needs attention',
};

export function DagRenderer({ nodes, edges, onNodeClick, compact = false, showLegend = true }: DagRendererProps) {
  const { positioned, width, height } = useMemo(() => layoutDag(nodes, edges), [nodes, edges]);
  const byId = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  if (nodes.length === 0) {
    return <div className="text-xs text-muted-foreground px-2 py-4">No plan tasks to map yet.</div>;
  }

  return (
    <div className="w-full overflow-x-auto" data-component="dag-renderer">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ minWidth: width * (compact ? 0.7 : 0.9), maxHeight: 480 }}
        role="img"
        aria-label="Plan map: each box is one task; arrows mean the earlier task must finish first"
      >
        <defs>
          <marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        <g fill="none" strokeWidth={1.6} className="stroke-muted-foreground" opacity={0.75}>
          {edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x - 3;
            const y2 = to.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                markerEnd="url(#dag-arrow)"
              />
            );
          })}
        </g>
        {positioned.map((node) => {
          const isDone = node.status === 'done';
          const isNow = node.status === 'in-progress';
          const isBlocked = node.status === 'blocked';
          const fillClass = isDone ? 'fill-teal-500/15 stroke-teal-500'
            : isNow ? 'fill-blue-500/15 stroke-blue-500'
            : isBlocked ? 'fill-red-500/15 stroke-red-500'
            : 'fill-muted stroke-border';
          return (
            <g
              key={node.id}
              onClick={onNodeClick ? () => onNodeClick(node.id) : undefined}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
              data-node-id={node.id}
              data-status={node.status}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                strokeWidth={isNow ? 2 : 1.2}
                strokeDasharray={node.status === 'waiting' ? '4 3' : undefined}
                className={fillClass}
              >
                {isNow && <animate attributeName="opacity" values="1;0.55;1" dur="2s" repeatCount="indefinite" />}
              </rect>
              <title>{node.title} — {STATUS_LABEL[node.status]}</title>
              {(() => {
                const lines = wrapTitle(node.title);
                const mark = isDone ? ' ✓' : isNow ? ' ●' : '';
                if (lines.length === 1) {
                  return (
                    <text x={node.x + NODE_W / 2} y={node.y + 22} textAnchor="middle" className="fill-foreground" fontSize={12}>
                      {lines[0]}{mark}
                    </text>
                  );
                }
                return (
                  <>
                    <text x={node.x + NODE_W / 2} y={node.y + 17} textAnchor="middle" className="fill-foreground" fontSize={12}>{lines[0]}</text>
                    <text x={node.x + NODE_W / 2} y={node.y + 30} textAnchor="middle" className="fill-foreground" fontSize={12}>{lines[1]}{mark}</text>
                  </>
                );
              })()}
              <text x={node.x + NODE_W / 2} y={node.y + 45} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                {node.assignee ? `${node.assignee} · ` : ''}{STATUS_LABEL[node.status]}
              </text>
            </g>
          );
        })}
      </svg>
      {showLegend && (
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-500 mr-1.5 align-[-1px]" />done</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500 mr-1.5 align-[-1px]" />happening now</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-muted-foreground mr-1.5 align-[-1px]" />waiting its turn</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 mr-1.5 align-[-1px]" />needs attention</span>
          {width > 1200 && <span className="ml-auto text-muted-foreground/70">wide plan — scroll →</span>}
        </div>
      )}
    </div>
  );
}

export default DagRenderer;
