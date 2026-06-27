import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { PickupGateControls } from './PickupGateControls';
import { useQuery } from '@tanstack/react-query';
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';

// ── Types ──

export interface PipelineState {
  ready: boolean;
  planned: boolean;
  parked: boolean;
  vetoed: boolean;
  blocksMain: boolean;
  inPipeline: boolean;
  /** PAN-2059: operator released the reviewed plan for pickup. */
  released: boolean;
  /** PAN-2059: AI raised a written objection in place of planning. */
  objection: boolean;
  gate: 'auto' | 'promote' | 'vetoed';
}

export interface SequenceNode {
  issueId: string;
  title?: string;
  isEpic?: boolean;
  /** PAN-2006 pipeline state from the shared classifier (editor controls). */
  state?: PipelineState;
  rank: number;
  size: string;
  importance: string;
  score: number;
  condition: string;
  dependsOn: string[];
  why: string;
  rationale?: string;
  gate: string;
  planning: string;
  inPipeline: boolean;
  hasPrd?: boolean;
  ready?: boolean;
}

interface SequenceEdge {
  from: string;
  to: string;
  type: string;
}

export interface SequenceResponse {
  nodes: SequenceNode[];
  edges: SequenceEdge[];
}

// ── Size → node dimensions ──

// Node widths mirror the mockup (.node.xs … .node.xl); height is a layout-spacing
// estimate only — ReactFlow measures the real rendered size.
const SIZE_DIMS: Record<string, { w: number; h: number }> = {
  XS: { w: 150, h: 90 },
  S:  { w: 168, h: 90 },
  M:  { w: 196, h: 94 },
  L:  { w: 216, h: 94 },
  XL: { w: 236, h: 98 },
};
function sizeDims(size: string) {
  return SIZE_DIMS[size] ?? SIZE_DIMS['M']!;
}

// Importance → node modifier class (drives the colored left border, mockup .node.crit etc.)
const IMPORTANCE_CLASS: Record<string, string> = {
  critical: 'crit',
  high: 'high',
  medium: 'med',
  low: 'low',
};
// size string (XS…XL) → lowercase modifier class
function sizeClass(size: string): string {
  return (size || 'M').toLowerCase();
}

// ── dagre layout ──

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length > 1 && edges.length < nodes.length * 0.75) {
    const cols = Math.min(5, Math.ceil(Math.sqrt(nodes.length * 1.4)));
    const xGap = 265;
    const yGap = 120;
    return nodes.map((n, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return { ...n, position: { x: col * xGap, y: row * yGap } };
    });
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const dims = sizeDims((n.data as IssueNodeData).node.size);
    g.setNode(n.id, { width: dims.w, height: dims.h });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    const dims = sizeDims((n.data as IssueNodeData).node.size);
    return { ...n, position: { x: x - dims.w / 2, y: y - dims.h / 2 } };
  });
}

// ── IssueNode ──

interface IssueNodeData {
  node: SequenceNode;
  onSelect: (n: SequenceNode) => void;
}

function IssueNode({ data }: { data: IssueNodeData }) {
  const { node, onSelect } = data;
  const cls = ['node', sizeClass(node.size), IMPORTANCE_CLASS[node.importance] ?? 'med'];
  if (node.inPipeline) cls.push('pipe');
  if (node.condition === 'needs-refinement') cls.push('cond-refine');
  if (node.condition === 'stale') cls.push('cond-stale');
  if (node.gate === 'blocked') cls.push('gate-blocked');
  if (node.isEpic) cls.push('epic');
  // gate=ready on an in-flight issue is the sequencer auto-PINNING active work, not an
  // operator promotion — only badge a real (idle) operator promote.
  const isPromoted = node.gate === 'ready' && !node.inPipeline;
  if (isPromoted) cls.push('gate-promoted');

  return (
    <div className={cls.join(' ')} onClick={() => onSelect(node)}>
      <Handle type="target" position={Position.Top} className="edge-handle" />
      <div className="row1">
        <span className="rank">#{node.rank}</span>
        <span className="iid">{node.issueId}</span>
        <span className="size-tag">{node.size}</span>
      </div>
      <div className="title">{node.title || node.why}</div>
      <div className="chips">
        {isPromoted && <span className="chip promoted">📌 PROMOTED</span>}
        {node.gate === 'blocked' && <span className="chip held">⛔ VETOED</span>}
        {node.inPipeline && <span className="chip verb work"><span className="pulsedot" />in pipeline</span>}
        {node.condition === 'needs-refinement' && <span className="chip refine">⚠ REFINE</span>}
        {node.condition === 'stale' && <span className="chip stale">⊘ STALE</span>}
        {node.isEpic && <span className="chip epic">EPIC</span>}
        {node.ready && <span className="chip ready">✓ READY</span>}
        {node.hasPrd && <span className="chip prd">PRD</span>}
        <span className="score">{node.score}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="edge-handle" />
    </div>
  );
}

const NODE_TYPES = { issueNode: IssueNode };

// ── Sequence → ReactFlow ──

function sequenceToFlow(
  nodes: SequenceNode[],
  edges: SequenceEdge[],
  onSelect: (n: SequenceNode) => void,
): { nodes: Node[]; edges: Edge[] } {
  const rawNodes: Node[] = nodes.map((n) => ({
    id: n.issueId,
    type: 'issueNode',
    position: { x: 0, y: 0 },
    data: { node: n, onSelect } satisfies IssueNodeData,
  }));

  const rawEdges: Edge[] = edges.map((e, i) => {
    // 'unblocks' = hard dependency (solid); 'informs' = advisory (dashed, tinted);
    // 'contains' = epic membership (separate presentation, not a blocking edge).
    const isInforms = e.type === 'informs';
    const isContains = e.type === 'contains';
    const color = isContains
      ? 'color-mix(in srgb, var(--primary) 58%, transparent)'
      : isInforms
      ? 'color-mix(in srgb, var(--info) 60%, transparent)'
      : 'color-mix(in srgb, var(--muted-foreground) 55%, transparent)';
    return {
      id: `e-${i}-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      type: 'default', // bezier curve, matches the mockup's curved edges
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
      style: {
        stroke: color,
        strokeWidth: isContains ? 1.2 : 1.5,
        strokeDasharray: isInforms ? '5 4' : isContains ? '2 5' : undefined,
      },
    };
  });

  const laidOut = applyDagreLayout(rawNodes, rawEdges);
  return { nodes: laidOut, edges: rawEdges };
}

// ── Side panel ──

// Importance → color swatch (mirrors the mockup's IMP_SW map, theme-token based).
const IMP_SWATCH: Record<string, string> = {
  critical: 'var(--destructive)',
  high: 'var(--warning)',
  medium: 'var(--color-neutral-400)',
  low: 'color-mix(in srgb, var(--muted-foreground) 55%, transparent)',
};

type FlagKind = 'pipeline' | 'refine' | 'stale' | 'ready' | 'prd' | 'none';

function buildPanelFlags(node: SequenceNode): Array<{ label: string; kind: FlagKind }> {
  const flags: Array<{ label: string; kind: FlagKind }> = [];
  if (node.inPipeline) flags.push({ label: 'in pipeline', kind: 'pipeline' });
  if (node.condition === 'needs-refinement') flags.push({ label: '⚠ needs refinement', kind: 'refine' });
  if (node.condition === 'stale') flags.push({ label: '⊘ likely stale · candidate to close', kind: 'stale' });
  if (node.ready) flags.push({ label: '✓ READY', kind: 'ready' });
  if (node.hasPrd) flags.push({ label: 'PRD', kind: 'prd' });
  if (flags.length === 0) flags.push({ label: 'not yet planned', kind: 'none' });
  return flags;
}

function panelChipStyle(kind: FlagKind): CSSProperties {
  const base: CSSProperties = {
    fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', padding: '1px 6px',
    borderRadius: 'var(--radius-sm, 4px)', border: '1px solid', lineHeight: '15px', whiteSpace: 'nowrap',
  };
  switch (kind) {
    case 'ready':
      return { ...base, color: 'var(--success-foreground)', borderColor: 'color-mix(in srgb, var(--success) 32%, transparent)', background: 'color-mix(in srgb, var(--success) 10%, transparent)' };
    case 'refine':
      return { ...base, color: 'var(--warning-foreground)', borderColor: 'color-mix(in srgb, var(--warning) 32%, transparent)', background: 'color-mix(in srgb, var(--warning) 10%, transparent)' };
    case 'pipeline':
      return { ...base, color: 'var(--info-foreground)', borderColor: 'color-mix(in srgb, var(--info) 32%, transparent)', background: 'color-mix(in srgb, var(--info) 10%, transparent)' };
    default:
      return { ...base, color: 'var(--muted-foreground)', borderColor: 'var(--border)', background: 'var(--accent)' };
  }
}

const META_GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 14px', fontSize: 12 };
const META_KEY: CSSProperties = { color: 'var(--muted-foreground)' };
const META_VAL: CSSProperties = { color: 'var(--foreground)', textAlign: 'right' };

export interface RationaleSidePanelProps {
  node: SequenceNode;
  onClose: () => void;
  /** PAN-2005: open the issue in the browser / overlay / cockpit panel. */
  onIssueAction?: (issueId: string, mode: 'browser' | 'modal' | 'panel') => void;
}

// Small nav-button style for the drawer's "open issue" row (style-guide: 10px
// uppercase action link, weight 500, themed border).
const NAV_BTN: CSSProperties = {
  flex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 500,
  padding: '5px 6px',
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'var(--accent)',
  color: 'var(--foreground)',
};

export function RationaleSidePanel({
  node,
  onClose,
  onIssueAction,
}: RationaleSidePanelProps) {
  const flags = buildPanelFlags(node);
  const clampedScore = Math.max(0, Math.min(100, node.score));

  return (
    <div style={{
      width: 320,
      flexShrink: 0,
      background: 'var(--card)',
      borderLeft: '1px solid var(--border)',
      padding: '16px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      color: 'var(--foreground)',
    }}>
      {/* Header: eyebrow + close */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-foreground)' }}>
          Why rank #{node.rank}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
        >
          ×
        </button>
      </div>

      {/* Identity */}
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted-foreground)' }}>{node.issueId}</div>
      {node.title && (
        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.35, margin: '2px 0 10px' }}>{node.title}</div>
      )}

      {/* PAN-2005: three ways to open the issue — cockpit panel, overlay, browser */}
      {onIssueAction && (
        <div style={{ display: 'flex', gap: 6, margin: `${node.title ? 0 : 10}px 0 14px` }}>
          <button style={NAV_BTN} onClick={() => onIssueAction(node.issueId, 'panel')} title="Open the full issue cockpit (deep-linked tab)">⛶ Panel</button>
          <button style={NAV_BTN} onClick={() => onIssueAction(node.issueId, 'modal')} title="Open the issue overlay (quick peek, stays on this page)">▢ Overlay</button>
          <button style={NAV_BTN} onClick={() => onIssueAction(node.issueId, 'browser')} title="Open the issue on GitHub in a new tab">↗ GitHub</button>
        </div>
      )}

      {/* Metrics — importance + impact score */}
      <div style={{ ...META_GRID, marginTop: node.title ? 0 : 12 }}>
        <span style={META_KEY}>Importance</span>
        <span style={META_VAL}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: IMP_SWATCH[node.importance] ?? 'var(--muted-foreground)' }} />
            {node.importance}
          </span>
        </span>
        <span style={META_KEY}>Impact score</span>
        <span style={{ ...META_VAL, fontFamily: 'monospace' }}>{node.score} / 100</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--accent)', overflow: 'hidden', marginTop: 3, marginBottom: 12 }}>
        <div style={{ height: '100%', width: `${clampedScore}%`, borderRadius: 3, background: 'linear-gradient(90deg, var(--warning), var(--destructive))' }} />
      </div>

      {/* Metrics — size + dependencies */}
      <div style={{ ...META_GRID, marginBottom: 14 }}>
        <span style={META_KEY}>Est. size</span>
        <span style={META_VAL}>{node.size} effort</span>
        <span style={META_KEY}>Depends on</span>
        <span style={{ ...META_VAL, fontFamily: 'monospace' }}>{node.dependsOn.length ? node.dependsOn.join(', ') : '— none'}</span>
      </div>

      {/* Status flags */}
      {flags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {flags.map((f, i) => <span key={i} style={panelChipStyle(f.kind)}>{f.label}</span>)}
        </div>
      )}

      {/* Backlog pickup controls — Plan → Release, AI objection, pipeline state,
          planning, pickup gate. Shared component (PAN-2059), identical to the one
          on the issue cockpit + overlay. */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 13, marginBottom: 13 }}>
        <PickupGateControls
          issueId={node.issueId}
          onOpenIssueBrowser={onIssueAction ? (id) => onIssueAction(id, 'browser') : undefined}
        />
      </div>

      {/* AI rationale */}
      <div style={{ fontSize: 12, lineHeight: 1.6, color: 'color-mix(in srgb, var(--foreground) 88%, transparent)', borderTop: '1px solid var(--border)', paddingTop: 13 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-foreground)', marginBottom: 6 }}>
          AI rationale · from sequence.md
        </div>
        {node.why}
        {node.rationale && <div style={{ marginTop: 8 }}>{node.rationale}</div>}
      </div>
    </div>
  );
}

// ── BacklogDAG ──

interface BacklogDAGProps {
  data: SequenceResponse;
  className?: string;
  selectedNodeId?: string | null;
  onSelectNode?: (n: SequenceNode | null) => void;
  /** PAN-2005: open the selected issue in the browser / overlay / cockpit panel. */
  onIssueAction?: (issueId: string, mode: 'browser' | 'modal' | 'panel') => void;
}

export function BacklogDAG({
  data,
  className,
  selectedNodeId,
  onSelectNode,
  onIssueAction,
}: BacklogDAGProps) {
  const [internalSelectedNode, setInternalSelectedNode] = useState<SequenceNode | null>(null);

  // If external control is provided, use it; otherwise use internal state
  const isControlled = onSelectNode !== undefined;
  const selectedNode = isControlled
    ? (data.nodes.find((n) => n.issueId === selectedNodeId) ?? null)
    : internalSelectedNode;

  const handleSelect = useCallback((n: SequenceNode) => {
    if (isControlled) {
      onSelectNode?.(selectedNodeId === n.issueId ? null : n);
    } else {
      setInternalSelectedNode((prev) => (prev?.issueId === n.issueId ? null : n));
    }
  }, [isControlled, onSelectNode, selectedNodeId]);

  const handleClose = useCallback(() => {
    if (isControlled) {
      onSelectNode?.(null);
    } else {
      setInternalSelectedNode(null);
    }
  }, [isControlled, onSelectNode]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => sequenceToFlow(data.nodes, data.edges, handleSelect),
    [data.nodes, data.edges, handleSelect],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const { nodes: updated, edges: updatedEdges } = sequenceToFlow(data.nodes, data.edges, handleSelect);
    setNodes(updated);
    setEdges(updatedEdges);
    // Keep internal selected node in sync with updated data
    if (!isControlled && internalSelectedNode) {
      const found = data.nodes.find((n) => n.issueId === internalSelectedNode.issueId);
      if (found) setInternalSelectedNode(found);
    }
  }, [data.nodes, data.edges, handleSelect, setNodes, setEdges, internalSelectedNode, isControlled]);

  return (
    <div
      className={`bk-dag-root${className ? ` ${className}` : ''}`}
      style={{ width: '100%', height: '100%', display: 'flex', background: 'var(--background)' }}
    >
      <style>{`
        /* ── Backlog DAG nodes — ported from docs/design/mockups/backlog-sequencer-scaled-opus.html, scoped to .bk-dag-root ── */
        .bk-dag-root .react-flow { background: transparent; }
        .bk-dag-root .react-flow__node { cursor: pointer; }
        .bk-dag-root .edge-handle { opacity: 0; pointer-events: none; }
        .bk-dag-root .node {
          background: var(--card); border: 1px solid var(--border);
          border-left: 4px solid var(--heat, var(--muted-foreground));
          border-radius: 8px; padding: 9px 11px 9px 12px; box-sizing: border-box;
          cursor: pointer; user-select: none; color: var(--foreground);
          transition: transform 160ms, box-shadow 160ms, border-color 160ms;
          box-shadow: 0 1px 2px rgba(0,0,0,.3);
          display: flex; flex-direction: column; gap: 5px;
        }
        .bk-dag-root .node:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.45); }
        .bk-dag-root .node.xs { width: 150px; } .bk-dag-root .node.s { width: 168px; }
        .bk-dag-root .node.m { width: 196px; } .bk-dag-root .node.l { width: 216px; }
        .bk-dag-root .node.xl { width: 236px; }
        .bk-dag-root .node.crit { --heat: var(--destructive); border-left-width: 5px; }
        .bk-dag-root .node.high { --heat: var(--warning); border-left-width: 5px; }
        .bk-dag-root .node.med  { --heat: color-mix(in srgb, var(--color-neutral-400) 80%, transparent); }
        .bk-dag-root .node.low  { --heat: color-mix(in srgb, var(--muted-foreground) 55%, transparent); }
        .bk-dag-root .node.pipe { --phase: var(--info);
          box-shadow: 0 0 0 1.5px var(--phase), 0 0 16px color-mix(in srgb, var(--phase) 45%, transparent), 0 2px 6px rgba(0,0,0,.35);
          animation: bk-ringpulse 2.6s ease-in-out infinite; }
        @keyframes bk-ringpulse {
          0%,100% { box-shadow: 0 0 0 1.5px var(--phase), 0 0 12px color-mix(in srgb, var(--phase) 35%, transparent), 0 2px 6px rgba(0,0,0,.35); }
          50%     { box-shadow: 0 0 0 1.5px var(--phase), 0 0 22px color-mix(in srgb, var(--phase) 60%, transparent), 0 2px 6px rgba(0,0,0,.35); }
        }
        .bk-dag-root .node.cond-refine { border-style: dashed; border-color: color-mix(in srgb, var(--warning) 55%, transparent); }
        .bk-dag-root .node.cond-stale { opacity: .5; filter: grayscale(.6); border-style: dashed; }
        .bk-dag-root .node.cond-stale .title { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted-foreground) 60%, transparent); }
        .bk-dag-root .node.cond-stale:hover { opacity: 1; filter: none; }
        .bk-dag-root .node.pipe.cond-stale { opacity: 1; filter: none; }
        .bk-dag-root .node.gate-blocked { opacity: .82; }
        .bk-dag-root .node.gate-promoted { border-top: 2px solid color-mix(in srgb, var(--primary) 60%, transparent); }
        .bk-dag-root .node.epic {
          border-style: dashed;
          border-width: 1.5px;
          border-left-width: 5px;
          border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
          border-left-color: color-mix(in srgb, var(--primary) 72%, var(--foreground));
          background: color-mix(in srgb, var(--primary) 6%, var(--card));
        }
        .bk-dag-root .node .row1 { display: flex; align-items: center; gap: 7px; }
        .bk-dag-root .node .rank { font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; font-weight: 500; color: var(--foreground); background: var(--accent); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; line-height: 17px; }
        .bk-dag-root .node .iid { font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; color: var(--muted-foreground); }
        .bk-dag-root .node .size-tag { margin-left: auto; font-size: 9px; font-weight: 500; letter-spacing: .06em; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; line-height: 15px; }
        .bk-dag-root .node .title { font-size: 12.5px; font-weight: 500; color: var(--foreground); line-height: 1.32; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .bk-dag-root .node .chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
        .bk-dag-root .chip { font-size: 9px; font-weight: 500; letter-spacing: .04em; padding: 1px 5px; border-radius: 4px; border: 1px solid; line-height: 14px; }
        .bk-dag-root .chip.prd { color: var(--muted-foreground); border-color: var(--border); background: var(--accent); }
        .bk-dag-root .chip.ready { color: var(--success-foreground); border-color: color-mix(in srgb, var(--success) 32%, transparent); background: color-mix(in srgb, var(--success) 8%, transparent); }
        .bk-dag-root .chip.refine { color: var(--warning-foreground); border-color: color-mix(in srgb, var(--warning) 32%, transparent); background: color-mix(in srgb, var(--warning) 8%, transparent); }
        .bk-dag-root .chip.stale { color: var(--muted-foreground); border-color: var(--border); background: var(--accent); }
        .bk-dag-root .chip.epic { color: var(--foreground); border-color: color-mix(in srgb, var(--primary) 44%, transparent); background: color-mix(in srgb, var(--primary) 12%, transparent); }
        .bk-dag-root .chip.promoted { color: var(--foreground); border-color: color-mix(in srgb, var(--primary) 50%, transparent); background: color-mix(in srgb, var(--primary) 14%, transparent); }
        .bk-dag-root .chip.held { color: var(--warning-foreground); border-color: color-mix(in srgb, var(--warning) 40%, transparent); background: color-mix(in srgb, var(--warning) 10%, transparent); }
        .bk-dag-root .chip.verb { display: inline-flex; align-items: center; gap: 3px; }
        .bk-dag-root .chip.verb.work { color: var(--info-foreground); border-color: color-mix(in srgb, var(--info) 32%, transparent); background: color-mix(in srgb, var(--info) 8%, transparent); }
        .bk-dag-root .chip.verb .pulsedot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: bk-blink 1.4s ease-in-out infinite; }
        @keyframes bk-blink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        .bk-dag-root .node .score { font-family: ui-monospace, "SF Mono", monospace; font-size: 9.5px; color: var(--muted-foreground); margin-left: auto; }
        .bk-dag-root .react-flow__controls-button { background: var(--card) !important; border-color: var(--border) !important; color: var(--foreground) !important; }
        .bk-dag-root .react-flow__controls-button svg { fill: var(--foreground) !important; }
      `}</style>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="color-mix(in srgb, var(--muted-foreground) 28%, transparent)" />
          <Controls />
        </ReactFlow>
      </div>
      {selectedNode && !isControlled && (
        <RationaleSidePanel
          node={selectedNode}
          onClose={handleClose}
          onIssueAction={onIssueAction}
        />
      )}
    </div>
  );
}

// ── BacklogDAGViewer — fetches from API + renders BacklogDAG ──

export function BacklogDAGViewer({ className }: { className?: string }) {
  const { data, isLoading, error } = useQuery<SequenceResponse>({
    queryKey: ['backlog-sequence'],
    queryFn: async () => {
      const res = await fetch('/api/backlog/sequence');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SequenceResponse>;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-fg-muted)', fontSize: 12 }}>
        Loading sequence…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-fg-muted)', fontSize: 12 }}>
        {error ? String(error) : 'No sequence data'}
      </div>
    );
  }
  if (data.nodes.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-fg-muted)', fontSize: 12 }}>
        No backlog sequence yet. Run a sequencer pass to rank the open backlog.
      </div>
    );
  }

  return <BacklogDAG data={data} className={className} />;
}
