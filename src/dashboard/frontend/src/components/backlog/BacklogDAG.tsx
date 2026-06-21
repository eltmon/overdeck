import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';

// ── Types ──

export interface SequenceNode {
  issueId: string;
  title?: string;
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

const SIZE_DIMS: Record<string, { w: number; h: number }> = {
  XS: { w: 160, h: 56 },
  S:  { w: 190, h: 64 },
  M:  { w: 220, h: 72 },
  L:  { w: 250, h: 80 },
  XL: { w: 280, h: 88 },
};
function sizeDims(size: string) {
  return SIZE_DIMS[size] ?? SIZE_DIMS['M']!;
}

// ── Importance → left-border color ──

const IMPORTANCE_BORDER: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#6b7280',
  low:      '#374151',
};

// ── Condition styling ──

const CONDITION_STYLE: Record<string, { color: string; label: string }> = {
  'ok':                { color: '#22c55e', label: '' },
  'needs-refinement':  { color: '#f59e0b', label: '⚠ REFINE' },
  'stale':             { color: '#6b7280', label: '⊘ STALE' },
};

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
  const dims = sizeDims(node.size);
  const borderLeft = IMPORTANCE_BORDER[node.importance] ?? IMPORTANCE_BORDER['medium']!;
  const isInPipeline = node.inPipeline;
  const isStale = node.condition === 'stale';
  const cond = CONDITION_STYLE[node.condition];

  return (
    <div
      onClick={() => onSelect(node)}
      className={isInPipeline ? 'plan-glow' : undefined}
      style={{
        width: dims.w,
        height: dims.h,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderLeft: `4px solid ${borderLeft}`,
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 11,
        color: 'var(--color-fg)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        boxSizing: 'border-box',
        opacity: isStale ? 0.55 : 1,
        textDecoration: isStale ? 'line-through' : undefined,
        boxShadow: '0 1px 2px rgba(15,23,42,0.08)',
      }}
    >
      {/* Top row: rank badge + issueId + size */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          fontFamily: 'monospace',
          fontSize: 9,
          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
          color: 'var(--color-fg)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
          borderRadius: 3,
          padding: '1px 4px',
          flexShrink: 0,
        }}>
          #{node.rank}
        </span>
        <span style={{ fontWeight: 600, fontSize: 11, color: '#60a5fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.issueId}
        </span>
        <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>
          {node.size}
        </span>
        {isInPipeline && (
          <span style={{
            fontSize: 8, background: 'rgba(59,130,246,0.15)', color: '#93c5fd',
            borderRadius: 3, padding: '1px 4px', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
          }}>
            live
          </span>
        )}
      </div>

      {/* Why text */}
      <div style={{ fontSize: 9, color: 'var(--color-fg-muted)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {node.why}
      </div>

      {/* Bottom row: chips */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {node.gate === 'ready' && (
          <span style={{ fontSize: 8, background: 'rgba(21,128,61,0.2)', color: '#86efac', border: '1px solid rgba(134,239,172,0.2)', borderRadius: 3, padding: '1px 4px', fontWeight: 600 }}>
            📌 PROMOTED
          </span>
        )}
        {node.gate === 'blocked' && (
          <span style={{ fontSize: 8, background: 'rgba(153,27,27,0.2)', color: '#fca5a5', border: '1px solid rgba(252,165,165,0.2)', borderRadius: 3, padding: '1px 4px', fontWeight: 600 }}>
            ⛔ HELD
          </span>
        )}
        {cond?.label && (
          <span style={{ fontSize: 8, borderRadius: 3, padding: '1px 4px', fontWeight: 600, color: cond.color, background: 'var(--color-surface)', border: `1px solid ${cond.color}44` }}>
            {cond.label}
          </span>
        )}
      </div>
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
    const isDashed = e.type === 'informs';
    const color = isDashed ? '#60a5fa' : 'var(--color-fg-muted)';
    return {
      id: `e-${i}-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
      style: {
        stroke: color,
        strokeWidth: 1.5,
        strokeDasharray: isDashed ? '6 4' : undefined,
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

// Planning-policy hint shown under the segmented control (verbatim from the mockup).
const PLAN_HINT: Record<string, string> = {
  interactive: 'Interactive: a human drives planning — a HARD gate. The Flywheel surfaces it as needs-you and never auto-runs it.',
  skip: 'Skip: no planning — pan start --auto straight to work (trivial/tiny/urgent).',
  auto: 'Auto: the AI plans it end-to-end (pan plan --auto).',
};

// Pickup-gate hint shown under the segmented control (verbatim from the mockup).
const GATE_HINT: Record<string, string> = {
  ready: 'Promoted: eligible for auto-pickup now, even ahead of heuristics (operator or Flywheel emergency-promote).',
  blocked: 'Held: the Flywheel will not auto-pick this.',
  auto: 'Auto: normal eligibility (ready · not blocked · passes the security filter).',
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
    fontSize: 9, fontWeight: 500, letterSpacing: '0.04em', padding: '1px 6px',
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
const SECTION_LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-foreground)', marginBottom: 7 };
const SECTION_HINT: CSSProperties = { fontSize: 11, color: 'var(--muted-foreground)', marginTop: 7, lineHeight: 1.45 };

function SegControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; activeColor?: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: '3px 6px',
              fontSize: 9,
              fontWeight: isActive ? 700 : 400,
              border: 'none',
              cursor: 'pointer',
              background: isActive ? (opt.activeColor ?? '#3b82f6') : 'var(--color-surface)',
              color: isActive ? '#fff' : 'var(--color-fg-muted)',
              transition: 'all 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export interface RationaleSidePanelProps {
  node: SequenceNode;
  onClose: () => void;
  onGateChange: (issueId: string, gate: string) => Promise<void>;
  onPlanningChange: (issueId: string, planning: string) => Promise<void>;
}

export function RationaleSidePanel({
  node,
  onClose,
  onGateChange,
  onPlanningChange,
}: RationaleSidePanelProps) {
  const [gate, setGate] = useState(node.gate);
  const [planning, setPlanning] = useState(node.planning);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGate(node.gate);
    setPlanning(node.planning);
  }, [node.issueId, node.gate, node.planning]);

  async function handleGateChange(v: string) {
    setGate(v);
    setBusy(true);
    try { await onGateChange(node.issueId, v); } finally { setBusy(false); }
  }

  async function handlePlanningChange(v: string) {
    setPlanning(v);
    setBusy(true);
    try { await onPlanningChange(node.issueId, v); } finally { setBusy(false); }
  }

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
          style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
        >
          ×
        </button>
      </div>

      {/* Identity */}
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted-foreground)' }}>{node.issueId}</div>
      {node.title && (
        <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.35, margin: '2px 0 14px' }}>{node.title}</div>
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

      {/* Planning policy */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 13, marginBottom: 13 }}>
        <div style={SECTION_LABEL}>Planning · AI-suggested, operator-overridable</div>
        <SegControl
          value={planning}
          options={[
            { value: 'skip', label: 'Skip' },
            { value: 'auto', label: 'Auto' },
            { value: 'interactive', label: '⚑ Interactive', activeColor: '#b45309' },
          ]}
          onChange={handlePlanningChange}
        />
        <div style={SECTION_HINT}>{PLAN_HINT[planning] ?? ''}</div>
      </div>

      {/* Pickup gate */}
      <div style={{ marginBottom: 13 }}>
        <div style={SECTION_LABEL}>Pickup gate · operator {busy && '…'}</div>
        <SegControl
          value={gate}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'ready', label: '✓ Ready', activeColor: '#15803d' },
            { value: 'blocked', label: '⛔ Block', activeColor: '#b91c1c' },
          ]}
          onChange={handleGateChange}
        />
        <div style={SECTION_HINT}>{GATE_HINT[gate] ?? ''}</div>
      </div>

      {/* AI rationale */}
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'color-mix(in srgb, var(--foreground) 88%, transparent)', borderTop: '1px solid var(--border)', paddingTop: 13 }}>
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
  onGateChange?: (issueId: string, gate: string) => Promise<void>;
  onPlanningChange?: (issueId: string, planning: string) => Promise<void>;
}

export function BacklogDAG({
  data,
  className,
  selectedNodeId,
  onSelectNode,
  onGateChange,
  onPlanningChange,
}: BacklogDAGProps) {
  const queryClient = useQueryClient();
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

  const defaultGateChange = async (issueId: string, gate: string) => {
    await fetch('/api/backlog/sequence/gate', {
      method: 'POST',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ issueId, gate }),
    });
    queryClient.invalidateQueries({ queryKey: ['backlog-sequence'] });
  };

  const defaultPlanningChange = async (issueId: string, planning: string) => {
    await fetch('/api/backlog/sequence/planning', {
      method: 'POST',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ issueId, planning }),
    });
    queryClient.invalidateQueries({ queryKey: ['backlog-sequence'] });
  };

  const handleGateChange = onGateChange ?? defaultGateChange;
  const handlePlanningChange = onPlanningChange ?? defaultPlanningChange;

  return (
    <div
      className={className}
      style={{ width: '100%', height: '100%', display: 'flex', background: 'var(--color-bg)' }}
    >
      <style>{`
        @keyframes plan-glow {
          0%, 100% { box-shadow: 0 0 6px rgba(59,130,246,0.4); }
          50% { box-shadow: 0 0 16px rgba(59,130,246,0.8); }
        }
        .plan-glow { animation: plan-glow 2s ease-in-out infinite; }
        .react-flow { background: var(--color-bg); }
        .react-flow__controls-button { background: var(--color-surface) !important; border-color: var(--color-border) !important; color: var(--color-fg) !important; }
        .react-flow__controls-button svg { fill: var(--color-fg) !important; }
        .react-flow__controls-button:hover { background: var(--color-surface-hover) !important; }
      `}</style>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-border)" gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
      {selectedNode && !isControlled && (
        <RationaleSidePanel
          node={selectedNode}
          onClose={handleClose}
          onGateChange={handleGateChange}
          onPlanningChange={handlePlanningChange}
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
