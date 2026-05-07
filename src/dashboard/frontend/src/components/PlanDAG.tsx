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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashboardStore } from '../lib/store';
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
  trivial: 'trivial',
  simple:  'simple',
  medium:  'medium',
  complex: 'complex',
  expert:  'expert',
};

const STATUS_BADGE_LABELS: Record<VBriefItemStatus, string> = {
  pending:     'pending',
  in_progress: 'in progress',
  completed:   'completed',
  cancelled:   'cancelled',
  blocked:     'blocked',
};

// ── Layout ──

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const NODE_HEIGHT_COMPACT = 42;
const AC_ROW_HEIGHT = 16;

function nodeHeight(acCount: number, showAC: boolean, isCompact: boolean): number {
  if (isCompact) return NODE_HEIGHT_COMPACT;
  return showAC && acCount > 0 ? NODE_HEIGHT + acCount * AC_ROW_HEIGHT + 6 : NODE_HEIGHT;
}

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const h = (node.data as PlanItemNodeData).nodeHeight ?? NODE_HEIGHT;
    g.setNode(node.id, { width: NODE_WIDTH, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map(node => {
    const { x, y } = g.node(node.id);
    const h = (node.data as PlanItemNodeData).nodeHeight ?? NODE_HEIGHT;
    return { ...node, position: { x: x - NODE_WIDTH / 2, y: y - h / 2 } };
  });
}

// ── Custom node ──

// AC status rendering
const AC_STATUS_COLORS: Record<string, string> = {
  completed:   '#22c55e',
  in_progress: '#eab308',
  pending:     '#6b7280',
  blocked:     '#6b7280',
  cancelled:   '#6b7280',
};

const AC_STATUS_SYMBOL: Record<string, string> = {
  completed:   '✓',
  in_progress: '●',
  pending:     '○',
  blocked:     '○',
  cancelled:   '○',
};

interface PlanItemNodeData {
  item: VBriefItem;
  isCritical?: boolean;
  showAC?: boolean;
  nodeHeight?: number;
  /** True when status is pending but all blocking dependencies are completed */
  isUnblocked?: boolean;
  /** Titles of items that block this node (for blocked status display) */
  blockerTitles?: string[];
}

function PlanItemNode({ data }: { data: PlanItemNodeData }) {
  const { item, isCritical, showAC, isUnblocked, blockerTitles } = data;
  const colors = STATUS_COLORS[item.status] ?? STATUS_COLORS.pending;
  const difficulty = item.metadata?.difficulty;
  const priority = item.priority;
  const priorityColor = priority ? PRIORITY_DOT[priority] : undefined;
  const acs = (item.subItems ?? []).filter(s => s.metadata?.kind === 'acceptance_criterion');

  const isCompact = item.status === 'completed' || item.status === 'cancelled';
  const isRunning = item.status === 'in_progress';
  const isBlocked = item.status === 'blocked';

  // Animation classes for live status
  let animClass: string | undefined;
  if (isRunning) animClass = 'plan-glow';
  else if (isUnblocked) animClass = 'plan-pulse';
  else if (isBlocked) animClass = 'plan-blocked-pulse';

  // Dim pending nodes that are still blocked
  const dimmed = item.status === 'pending' && !isUnblocked;

  return (
    <div
      className={animClass}
      style={{
        width: NODE_WIDTH,
        minHeight: isCompact ? NODE_HEIGHT_COMPACT : NODE_HEIGHT,
        background: colors.bg,
        border: `2px solid ${isCritical ? '#f97316' : colors.border}`,
        borderRadius: 6,
        padding: isCompact ? '4px 8px' : '6px 8px',
        fontSize: 11,
        color: colors.text,
        boxShadow: isCritical ? `0 0 8px #f97316aa` : undefined,
        cursor: 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: isCompact ? 2 : 4,
        opacity: dimmed ? 0.6 : 1,
        textDecoration: item.status === 'cancelled' ? 'line-through' : undefined,
        transition: 'all 0.3s ease',
      }}
    >
      {/* Title row */}
      <span style={{ lineHeight: 1.3, wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: 4 }}>
        {item.status === 'completed' && (
          <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>✓</span>
        )}
        {item.title}
      </span>

      {/* Blocker info for blocked nodes */}
      {isBlocked && blockerTitles && blockerTitles.length > 0 && (
        <span style={{ fontSize: 9, color: '#fca5a5', lineHeight: 1.2 }}>
          Blocked by: {blockerTitles.join(', ')}
        </span>
      )}

      {/* Unblocked hint for ready pending nodes */}
      {isUnblocked && (
        <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 600, lineHeight: 1.2 }}>
          Ready to start
        </span>
      )}

      {/* Badge row — hidden in compact mode */}
      {!isCompact && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Status badge */}
          <span style={{
            fontSize: 9, background: colors.border, color: colors.bg,
            borderRadius: 3, padding: '1px 4px', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.02em',
          }}>
            {STATUS_BADGE_LABELS[item.status] ?? item.status}
          </span>
          {/* Priority badge */}
          {priorityColor && priority && (
            <span style={{
              fontSize: 9, background: priorityColor, color: '#111827',
              borderRadius: 3, padding: '1px 4px', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.02em',
            }}>
              {priority}
            </span>
          )}
          {/* Difficulty badge */}
          {difficulty && (
            <span style={{
              fontSize: 9, background: '#374151', color: '#9ca3af',
              borderRadius: 3, padding: '1px 4px',
            }}>
              {DIFFICULTY_LABELS[difficulty] ?? difficulty}
            </span>
          )}
          {/* AC progress badge — always visible when node has ACs */}
          {acs.length > 0 && (
            <span style={{
              fontSize: 9, background: '#1e3a5f', color: '#93c5fd',
              borderRadius: 3, padding: '1px 4px', fontWeight: 600,
              border: '1px solid #3b82f6',
            }}>
              {acs.filter(s => s.status === 'completed').length}/{acs.length} AC
            </span>
          )}
        </div>
      )}

      {/* Inline AC checklist (shown when showAC toggle is on) */}
      {showAC && acs.length > 0 && !isCompact && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.1)',
          paddingTop: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {acs.map(ac => {
            const color = AC_STATUS_COLORS[ac.status] ?? AC_STATUS_COLORS.pending;
            const symbol = AC_STATUS_SYMBOL[ac.status] ?? AC_STATUS_SYMBOL.pending;
            return (
              <div key={ac.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ color, fontSize: 8, flexShrink: 0, marginTop: 1, fontWeight: 700 }}>
                  {symbol}
                </span>
                <span style={{ fontSize: 9, color: '#d1d5db', lineHeight: 1.3, wordBreak: 'break-word' }}>
                  {ac.title}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES = { planItem: PlanItemNode };

// ── Conversion: VBriefDocument → ReactFlow nodes/edges ──

export function vbriefToFlow(doc: VBriefDocument, criticalPath: string[] = [], showAC = false): {
  nodes: Node[];
  edges: Edge[];
} {
  const criticalSet = new Set(criticalPath);
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));

  // Compute blocker relationships from edges
  const blockersOf = new Map<string, string[]>();
  for (const edge of doc.plan.edges ?? []) {
    if (edge.type === 'blocks') {
      const list = blockersOf.get(edge.to) ?? [];
      list.push(edge.from);
      blockersOf.set(edge.to, list);
    }
  }

  const rawNodes: Node[] = doc.plan.items.map(item => {
    const acCount = (item.subItems ?? []).filter(s => s.metadata?.kind === 'acceptance_criterion').length;
    const isCompact = item.status === 'completed' || item.status === 'cancelled';
    const h = nodeHeight(acCount, showAC, isCompact);

    const blockerIds = blockersOf.get(item.id) ?? [];
    const blockerTitles = blockerIds
      .map(id => itemById.get(id)?.title)
      .filter((t): t is string => !!t);

    // A pending item is "unblocked" (ready to start) when all blockers are completed
    const isUnblocked = item.status === 'pending'
      && blockerIds.length > 0
      && blockerIds.every(id => itemById.get(id)?.status === 'completed');

    return {
      id: item.id,
      type: 'planItem',
      position: { x: 0, y: 0 }, // overwritten by dagre
      data: {
        item,
        isCritical: criticalSet.has(item.id),
        showAC,
        nodeHeight: h,
        isUnblocked,
        blockerTitles: blockerTitles.length > 0 ? blockerTitles : undefined,
      } satisfies PlanItemNodeData,
    };
  });

  const EDGE_TYPE_COLORS: Record<string, string> = {
    blocks:      '#f87171',
    informs:     '#60a5fa',
    suggests:    '#a78bfa',
    invalidates: '#fbbf24',
  };

  const edgeList = doc.plan.edges ?? [];
  const rawEdges: Edge[] = edgeList.map((edge, i) => {
    const isDashed = edge.type === 'informs' || edge.type === 'suggests';
    const isDotted = edge.type === 'suggests';
    const isCritical = criticalSet.has(edge.from) && criticalSet.has(edge.to);
    const edgeColor = isCritical ? '#f97316' : (EDGE_TYPE_COLORS[edge.type] ?? '#6b7280');

    return {
      id: `e-${i}-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.type,
      labelStyle: { fontSize: 10, fill: '#d1d5db' },
      labelBgStyle: { fill: 'rgba(17, 24, 39, 0.8)' },
      labelBgPadding: [3, 4] as [number, number],
      labelBgBorderRadius: 3,
      markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: edgeColor },
      style: {
        stroke: edgeColor,
        strokeWidth: isCritical ? 3 : 2,
        strokeDasharray: isDotted ? '3 4' : isDashed ? '6 4' : undefined,
      },
      animated: edge.type === 'blocks' && isCritical,
    };
  });

  const laidOutNodes = applyDagreLayout(rawNodes, rawEdges);
  return { nodes: laidOutNodes, edges: rawEdges };
}

// ── Animation styles ──

function PlanDagStyles() {
  return (
    <style>{`
      @keyframes plan-glow {
        0%, 100% { box-shadow: 0 0 6px #3b82f666; }
        50% { box-shadow: 0 0 16px #3b82f6cc; }
      }
      @keyframes plan-pulse {
        0%, 100% { border-color: #6b7280; }
        50% { border-color: #60a5fa; }
      }
      @keyframes plan-blocked-pulse {
        0%, 100% { box-shadow: 0 0 4px #ef444444; }
        50% { box-shadow: 0 0 12px #ef444488; }
      }
      .plan-glow {
        animation: plan-glow 2s ease-in-out infinite;
      }
      .plan-pulse {
        animation: plan-pulse 2s ease-in-out infinite;
      }
      .plan-blocked-pulse {
        animation: plan-blocked-pulse 2s ease-in-out infinite;
      }
    `}</style>
  );
}

// ── Main component ──

interface PlanDAGProps {
  doc: VBriefDocument;
  criticalPath?: string[];
  onNodeClick?: (item: VBriefItem) => void;
  className?: string;
  showAC?: boolean;
}

export function PlanDAG({ doc, criticalPath = [], onNodeClick, className, showAC = false }: PlanDAGProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => vbriefToFlow(doc, criticalPath, showAC),
    [doc, criticalPath, showAC],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when doc or showAC changes (e.g., real-time status updates or toggle)
  useEffect(() => {
    const { nodes: updated, edges: updatedEdges } = vbriefToFlow(doc, criticalPath, showAC);
    setNodes(updated);
    setEdges(updatedEdges);
  }, [doc, criticalPath, showAC, setNodes, setEdges]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (onNodeClick) {
      onNodeClick((node.data as PlanItemNodeData).item);
    }
  }, [onNodeClick]);

  return (
    <div className={className} style={{ width: '100%', height: '100%', background: '#111827' }}>
      <PlanDagStyles />
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
        key={showAC ? 'ac-on' : 'ac-off'}
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
  const [showAC, setShowAC] = useState(false);

  const { data: doc, isLoading, isError } = useQuery<VBriefDocument>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      if (!res.ok) throw new Error('No plan available');
      return res.json();
    },
    staleTime: 30_000,
  });

  // Refetch plan data when domain events arrive (plan.item_status_changed, etc.)
  // EventRouter applies events to the store, advancing the sequence number.
  const storeSequence = useDashboardStore((s) => s.sequence);
  useEffect(() => {
    if (storeSequence > 0) {
      queryClient.invalidateQueries({ queryKey: ['plan', issueId] });
    }
  }, [storeSequence, issueId, queryClient]);

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

  // Show critical path length + edge count in header when available
  const cpLength = effectiveCriticalPath.length;
  const edgeCount = doc.plan.edges?.length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '4px 8px', fontSize: 10, background: '#1f2937', borderBottom: '1px solid #374151', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#f97316', fontWeight: 600 }}>
          {cpLength > 1 ? `Critical path: ${cpLength} steps` : ''}
          {cpLength > 1 && edgeCount > 0 ? ' · ' : ''}
          {edgeCount > 0 ? `${edgeCount} edge${edgeCount === 1 ? '' : 's'}` : ''}
        </span>
        <button
          onClick={() => setShowAC(prev => !prev)}
          style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
            background: showAC ? '#22c55e' : '#374151',
            color: showAC ? '#111827' : '#9ca3af',
            border: 'none', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}
          title="Toggle acceptance criteria on DAG nodes"
        >
          Show AC
        </button>
      </div>
      <div style={{ flex: 1 }}>
        <PlanDAG
          doc={doc}
          criticalPath={effectiveCriticalPath}
          onNodeClick={onNodeClick}
          className={className}
          showAC={showAC}
        />
      </div>
    </div>
  );
}
