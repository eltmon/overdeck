import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

interface SequenceNode {
  issueId: string;
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
}

interface SequenceEdge {
  from: string;
  to: string;
  type: string;
}

interface SequenceResponse {
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

// ── dagre layout ──

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
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
  const borderLeft = IMPORTANCE_BORDER[node.importance] ?? IMPORTANCE_BORDER['medium'];
  const isInPipeline = node.inPipeline;

  return (
    <div
      onClick={() => onSelect(node)}
      className={isInPipeline ? 'plan-glow' : undefined}
      style={{
        width: dims.w,
        height: dims.h,
        background: '#1f2937',
        border: '1px solid #374151',
        borderLeft: `4px solid ${borderLeft}`,
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 11,
        color: '#d1d5db',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Top row: rank badge + issueId */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          fontFamily: 'monospace',
          fontSize: 9,
          background: '#374151',
          color: '#9ca3af',
          borderRadius: 3,
          padding: '1px 4px',
          flexShrink: 0,
        }}>
          #{node.rank}
        </span>
        <span style={{ fontWeight: 600, fontSize: 11, color: '#60a5fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.issueId}
        </span>
        {isInPipeline && (
          <span style={{
            fontSize: 8, background: '#1e3a5f', color: '#93c5fd',
            borderRadius: 3, padding: '1px 4px', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
          }}>
            live
          </span>
        )}
      </div>

      {/* Why text */}
      <div style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {node.why}
      </div>

      {/* Bottom row: chips */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {node.gate === 'ready' && (
          <span style={{ fontSize: 8, background: '#14532d', color: '#86efac', borderRadius: 3, padding: '1px 4px', fontWeight: 600 }}>
            ✓ READY
          </span>
        )}
        {node.gate === 'blocked' && (
          <span style={{ fontSize: 8, background: '#450a0a', color: '#fca5a5', borderRadius: 3, padding: '1px 4px', fontWeight: 600 }}>
            BLOCKED
          </span>
        )}
        <span style={{ fontSize: 8, background: '#1f2937', color: '#6b7280', borderRadius: 3, padding: '1px 4px' }}>
          {node.size}
        </span>
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
    const color = isDashed ? '#60a5fa' : '#6b7280';
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

function RationaleSidePanel({ node, onClose }: { node: SequenceNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 300,
      background: '#111827', borderLeft: '1px solid #374151',
      padding: '14px', overflowY: 'auto', zIndex: 10,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#60a5fa', fontFamily: 'monospace' }}>
          {node.issueId}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
        >
          ×
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, color: '#d1d5db', marginBottom: 4 }}>Why ranked #{node.rank}</div>
        {node.why}
      </div>
      {node.rationale && (
        <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.5, borderTop: '1px solid #374151', paddingTop: 8 }}>
          <div style={{ fontWeight: 600, color: '#d1d5db', marginBottom: 4 }}>Rationale</div>
          {node.rationale}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid #374151', paddingTop: 8 }}>
        <span style={{ fontSize: 9, background: '#374151', color: '#9ca3af', borderRadius: 3, padding: '2px 5px' }}>
          size: {node.size}
        </span>
        <span style={{ fontSize: 9, background: '#374151', color: '#9ca3af', borderRadius: 3, padding: '2px 5px' }}>
          importance: {node.importance}
        </span>
        <span style={{ fontSize: 9, background: '#374151', color: '#9ca3af', borderRadius: 3, padding: '2px 5px' }}>
          score: {node.score}
        </span>
        <span style={{ fontSize: 9, background: '#374151', color: '#9ca3af', borderRadius: 3, padding: '2px 5px' }}>
          condition: {node.condition}
        </span>
        <span style={{ fontSize: 9, background: '#374151', color: '#9ca3af', borderRadius: 3, padding: '2px 5px' }}>
          gate: {node.gate}
        </span>
        <span style={{ fontSize: 9, background: '#374151', color: '#9ca3af', borderRadius: 3, padding: '2px 5px' }}>
          planning: {node.planning}
        </span>
      </div>
    </div>
  );
}

// ── BacklogDAG ──

interface BacklogDAGProps {
  data: SequenceResponse;
  className?: string;
}

export function BacklogDAG({ data, className }: BacklogDAGProps) {
  const [selectedNode, setSelectedNode] = useState<SequenceNode | null>(null);

  const handleSelect = useCallback((n: SequenceNode) => {
    setSelectedNode((prev) => (prev?.issueId === n.issueId ? null : n));
  }, []);

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
  }, [data.nodes, data.edges, handleSelect, setNodes, setEdges]);

  return (
    <div
      className={className}
      style={{ width: '100%', height: '100%', background: '#111827', position: 'relative' }}
    >
      <style>{`
        @keyframes plan-glow {
          0%, 100% { box-shadow: 0 0 6px #3b82f666; }
          50% { box-shadow: 0 0 16px #3b82f6cc; }
        }
        .plan-glow { animation: plan-glow 2s ease-in-out infinite; }
      `}</style>
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
        <Background color="#374151" gap={20} size={1} />
        <Controls style={{ background: '#1f2937', border: '1px solid #374151' }} />
      </ReactFlow>
      {selectedNode && (
        <RationaleSidePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
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
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', fontSize: 12 }}>
        Loading sequence…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', fontSize: 12 }}>
        {error ? String(error) : 'No sequence data'}
      </div>
    );
  }
  if (data.nodes.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', fontSize: 12 }}>
        No backlog sequence yet. Run a sequencer pass to rank the open backlog.
      </div>
    );
  }

  return <BacklogDAG data={data} className={className} />;
}
