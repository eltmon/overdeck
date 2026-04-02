/**
 * PlanDAG — ReactFlow-based DAG visualization for vBRIEF plans
 *
 * Renders a dependency graph from a VBriefDocument with:
 * - Status-colored node borders (gray=pending, blue=in_progress, green=completed, red=blocked, yellow=cancelled)
 * - Edge type styling (solid=blocks, dashed=informs, dotted=suggests)
 * - Automatic dagre top-to-bottom layout
 * - Zoom, pan, minimap support
 * - Critical path highlighting in orange
 *
 * PlanDAGViewer: data-fetching wrapper that loads from /api/workspaces/:issueId/plan
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
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
  /** Computed by server: ordered IDs of the longest dependency chain */
  criticalPath?: string[];
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

const STATUS_LABELS: Record<VBriefItemStatus, string> = {
  pending:     'pending',
  in_progress: 'in progress',
  completed:   'completed',
  cancelled:   'cancelled',
  blocked:     'blocked',
};

// ── Layout ──

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80, marginx: 20, marginy: 20 });
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
      <div style={{ lineHeight: 1.3, wordBreak: 'break-word' }}>
        {item.title}
      </div>
      {/* Badges row: status, priority, difficulty */}
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 9,
          fontWeight: 600,
          color: colors.text,
          background: `${colors.border}33`,
          border: `1px solid ${colors.border}66`,
          borderRadius: 3,
          padding: '1px 5px',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: colors.border,
          }} />
          {STATUS_LABELS[item.status]}
        </span>
        {priorityColor && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 9,
            fontWeight: 600,
            color: priorityColor,
            background: `${priorityColor}22`,
            border: `1px solid ${priorityColor}55`,
            borderRadius: 3,
            padding: '1px 5px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: priorityColor,
            }} />
            {item.priority}
          </span>
        )}
        {difficulty && (
          <span style={{
            fontSize: 9,
            fontWeight: 500,
            color: '#9ca3af',
            background: '#374151',
            borderRadius: 3,
            padding: '1px 5px',
            textTransform: 'capitalize',
          }}>
            {difficulty}
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

  // Edge type color palette — distinct colors per relationship type
  const EDGE_TYPE_COLORS: Record<string, string> = {
    blocks:      '#9ca3af',
    informs:     '#60a5fa',
    invalidates: '#f87171',
    suggests:    '#a78bfa',
  };

  const rawEdges: Edge[] = doc.plan.edges.map((edge, i) => {
    const isDashed = edge.type === 'informs' || edge.type === 'suggests';
    const isDotted = edge.type === 'suggests';
    const isCritical = criticalSet.has(edge.from) && criticalSet.has(edge.to);
    const typeColor = EDGE_TYPE_COLORS[edge.type] ?? '#6b7280';
    const edgeColor = isCritical ? '#f97316' : typeColor;

    return {
      id: `e-${i}-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      type: 'smoothstep',
      label: edge.type,
      labelStyle: {
        fontSize: 9,
        fontWeight: 500,
        fill: edgeColor,
        letterSpacing: '0.03em',
      },
      labelBgStyle: {
        fill: '#111827',
        fillOpacity: 0.9,
      },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: edgeColor },
      style: {
        stroke: edgeColor,
        strokeWidth: isCritical ? 2.5 : 1.5,
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

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when doc changes (e.g., real-time status updates via socket)
  useEffect(() => {
    const { nodes: updated, edges: updatedEdges } = vbriefToFlow(doc, criticalPath);
    setNodes(updated);
    setEdges(updatedEdges);
  }, [doc, criticalPath, setNodes, setEdges]);

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
      </ReactFlow>
    </div>
  );
}

// ── PlanDAGViewer — fetches plan from API and renders PlanDAG ──

interface PlanDAGViewerProps {
  issueId: string;
  criticalPath?: string[];
  onNodeClick?: (item: VBriefItem) => void;
  className?: string;
}

export function PlanDAGViewer({ issueId, criticalPath, onNodeClick, className }: PlanDAGViewerProps) {
  const queryClient = useQueryClient();

  const { data: doc, isLoading, isError } = useQuery<VBriefDocument>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      if (!res.ok) throw new Error('No plan available');
      return res.json();
    },
    staleTime: 30_000,
  });

  // Subscribe to live status updates via socket.io
  // Socket is created once on mount and kept stable — avoid recreating on every render.
  const issueIdRef = useRef(issueId);
  issueIdRef.current = issueId;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });

    socket.on('plan:item-status-changed', (event: { issueId: string; itemId: string; status: VBriefItemStatus }) => {
      if (event.issueId.toLowerCase() !== issueIdRef.current.toLowerCase()) return;

      queryClientRef.current.setQueryData<VBriefDocument>(['plan', issueIdRef.current], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          plan: {
            ...prev.plan,
            items: prev.plan.items.map(item =>
              item.id === event.itemId ? { ...item, status: event.status } : item
            ),
          },
        };
      });
    });

    return () => { socket.disconnect(); };
  }, []); // empty deps: socket created once, refs keep values current

  if (isLoading) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', fontSize: 12 }}>
        Loading plan…
      </div>
    );
  }

  if (isError || !doc) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', fontSize: 12 }}>
        No plan available for this workspace.
      </div>
    );
  }

  // Use server-computed critical path (from API response) or caller override
  const effectiveCriticalPath = criticalPath ?? doc.criticalPath ?? [];

  // Show critical path length in header when available
  const cpLength = effectiveCriticalPath.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {cpLength > 1 && (
        <div style={{ padding: '4px 8px', fontSize: 10, color: '#f97316', background: '#1f2937', borderBottom: '1px solid #374151', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 600 }}>Critical path:</span>
          {cpLength} steps
        </div>
      )}
      <div style={{ flex: 1 }}>
        <PlanDAG
          doc={doc}
          criticalPath={effectiveCriticalPath}
          onNodeClick={onNodeClick}
          className={className}
        />
      </div>
    </div>
  );
}
