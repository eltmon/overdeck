/**
 * PlanDAG — ReactFlow-based DAG visualization for vBRIEF plans
 *
 * Renders a dependency graph from a VBriefDocument with:
 * - Status-colored node borders
 * - Edge type styling (solid=blocks, dashed=informs)
 * - Automatic dagre layout (top-to-bottom)
 * - Zoom, pan, minimap support
 */

import { useCallback, useMemo } from 'react';
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';

// ── Types ──

export type VBriefItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';

export interface VBriefItem {
  id: string;
  title: string;
  status: VBriefItemStatus;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  metadata?: {
    difficulty?: 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';
    [key: string]: unknown;
  };
  narrative?: { Action?: string; [key: string]: string | undefined };
  subItems?: Array<{ id: string; title: string; status: string; metadata?: { kind?: string } }>;
}

export interface VBriefEdge {
  from: string;
  to: string;
  type: 'blocks' | 'informs' | 'invalidates' | 'suggests';
}

export interface VBriefDocument {
  vBRIEFInfo: { version: string; created: string };
  plan: {
    id: string;
    title: string;
    items: VBriefItem[];
    edges: VBriefEdge[];
  };
}

// ── Status styling ──

const STATUS_COLORS: Record<VBriefItemStatus, { border: string; bg: string; text: string }> = {
  pending:     { border: '#6b7280', bg: '#1f2937', text: '#d1d5db' },
  in_progress: { border: '#3b82f6', bg: '#1e3a5f', text: '#93c5fd' },
  completed:   { border: '#22c55e', bg: '#14532d', text: '#86efac' },
  cancelled:   { border: '#eab308', bg: '#422006', text: '#fde047' },
  blocked:     { border: '#ef4444', bg: '#450a0a', text: '#fca5a5' },
};

const PRIORITY_DOT: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#6b7280',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  trivial: 'T',
  simple:  'S',
  medium:  'M',
  complex: 'C',
  expert:  'E',
};

// ── Layout ──

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map(node => {
    const { x, y } = g.node(node.id);
    return { ...node, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } };
  });
}

// ── Custom node ──

interface PlanItemNodeData {
  item: VBriefItem;
  isCritical?: boolean;
}

function PlanItemNode({ data }: { data: PlanItemNodeData }) {
  const { item, isCritical } = data;
  const colors = STATUS_COLORS[item.status] ?? STATUS_COLORS.pending;
  const difficulty = item.metadata?.difficulty;
  const priorityColor = item.priority ? PRIORITY_DOT[item.priority] : undefined;

  return (
    <div
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        background: colors.bg,
        border: `2px solid ${isCritical ? '#f97316' : colors.border}`,
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 11,
        color: colors.text,
        boxShadow: isCritical ? `0 0 8px #f97316aa` : undefined,
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {priorityColor && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: priorityColor, flexShrink: 0, marginTop: 3,
          }} />
        )}
        <span style={{ flex: 1, lineHeight: 1.3, wordBreak: 'break-word' }}>
          {item.title}
        </span>
        {difficulty && (
          <span style={{
            fontSize: 9, background: '#374151', color: '#9ca3af',
            borderRadius: 3, padding: '1px 3px', flexShrink: 0,
          }}>
            {DIFFICULTY_LABELS[difficulty] ?? difficulty[0].toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

const NODE_TYPES = { planItem: PlanItemNode };

// ── Conversion: VBriefDocument → ReactFlow nodes/edges ──

export function vbriefToFlow(doc: VBriefDocument, criticalPath: string[] = []): {
  nodes: Node[];
  edges: Edge[];
} {
  const criticalSet = new Set(criticalPath);

  const rawNodes: Node[] = doc.plan.items.map(item => ({
    id: item.id,
    type: 'planItem',
    position: { x: 0, y: 0 }, // overwritten by dagre
    data: { item, isCritical: criticalSet.has(item.id) } satisfies PlanItemNodeData,
  }));

  const rawEdges: Edge[] = doc.plan.edges.map((edge, i) => {
    const isDashed = edge.type === 'informs' || edge.type === 'suggests';
    const isDotted = edge.type === 'suggests';
    const isCritical = criticalSet.has(edge.from) && criticalSet.has(edge.to);

    return {
      id: `e-${i}-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: isCritical ? '#f97316' : '#6b7280' },
      style: {
        stroke: isCritical ? '#f97316' : edge.type === 'blocks' ? '#9ca3af' : '#4b5563',
        strokeWidth: isCritical ? 2 : 1,
        strokeDasharray: isDotted ? '3 4' : isDashed ? '6 4' : undefined,
      },
      animated: edge.type === 'blocks' && isCritical,
    };
  });

  const laidOutNodes = applyDagreLayout(rawNodes, rawEdges);
  return { nodes: laidOutNodes, edges: rawEdges };
}

// ── Main component ──

interface PlanDAGProps {
  doc: VBriefDocument;
  criticalPath?: string[];
  onNodeClick?: (item: VBriefItem) => void;
  className?: string;
}

export function PlanDAG({ doc, criticalPath = [], onNodeClick, className }: PlanDAGProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => vbriefToFlow(doc, criticalPath),
    [doc, criticalPath],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (onNodeClick) {
      onNodeClick((node.data as PlanItemNodeData).item);
    }
  }, [onNodeClick]);

  return (
    <div className={className} style={{ width: '100%', height: '100%', background: '#111827' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={20} size={1} />
        <Controls style={{ background: '#1f2937', border: '1px solid #374151' }} />
        <MiniMap
          style={{ background: '#1f2937', border: '1px solid #374151' }}
          nodeColor={node => {
            const item = (node.data as PlanItemNodeData)?.item;
            return item ? STATUS_COLORS[item.status]?.border ?? '#6b7280' : '#6b7280';
          }}
        />
      </ReactFlow>
    </div>
  );
}
