/**
 * PAN-2400 — "The plan, as a map": data-fetching wrapper around the shared
 * DagRenderer. Replaces the ReactFlow-based PlanDAGViewer (broken zoom,
 * missing arrows) with the tested layered renderer.
 *
 * Same data contract as the component it replaces: react-query on
 * ['plan', issueId] against /api/workspaces/:issueId/plan, throttled
 * event-driven refetch, and onNodeClick returning the full xBRIEF ITEM so
 * existing detail panels keep working.
 */

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashboardStore } from '../../lib/store';
import DagRenderer, { type DagEdge, type DagNode } from './DagRenderer';
import type { XBriefDocument, XBriefItem } from './types';
import { LoadingBoundary } from '../primitives/LoadingBoundary';

export interface PlanMapViewerProps {
  issueId: string;
  onNodeClick?: (item: XBriefItem) => void;
  className?: string;
  compact?: boolean;
}

function statusOf(item: XBriefItem): DagNode['status'] {
  switch (item.status) {
    case 'completed':
      return 'done';
    case 'in_progress':
    case 'running':
      return 'in-progress';
    case 'blocked':
    case 'failed':
      return 'blocked';
    default:
      return 'waiting';
  }
}

function assigneeOf(item: XBriefItem): string | undefined {
  const metadata = (item.metadata ?? {}) as { model?: string; difficulty?: string; kind?: string };
  const who = metadata.model ?? metadata.difficulty ?? metadata.kind;
  const acCount = (item.items ?? []).filter(
    (sub) => (sub.metadata as { kind?: string } | undefined)?.kind === 'acceptance_criterion',
  ).length;
  const checks = acCount > 0 ? `${acCount} check${acCount === 1 ? '' : 's'}` : undefined;
  return [who, checks].filter(Boolean).join(' · ') || undefined;
}

export function docToDag(doc: XBriefDocument): { nodes: DagNode[]; edges: DagEdge[] } {
  const nodes: DagNode[] = (doc.plan.items ?? []).map((item) => ({
    id: item.id,
    title: item.status === 'cancelled' ? `${item.title} (cancelled)` : item.title,
    assignee: assigneeOf(item),
    status: statusOf(item),
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges: DagEdge[] = (doc.plan.edges ?? [])
    .filter((edge) => edge.type === 'blocks' && ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to }));
  return { nodes, edges };
}

export function PlanMapViewer({ issueId, onNodeClick, className, compact }: PlanMapViewerProps) {
  const queryClient = useQueryClient();
  const { data: doc, isLoading, isError } = useQuery<XBriefDocument>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      if (!res.ok) throw new Error(`plan fetch failed: ${res.status}`);
      return res.json();
    },
  });

  // Refetch when domain events land (plan.item_status_changed etc.),
  // throttled to once per 5s — same behavior the old viewer had.
  const storeSequence = useDashboardStore((s) => s.sequence);
  const lastInvalidationRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastInvalidationRef.current < 5_000) return;
    lastInvalidationRef.current = now;
    queryClient.invalidateQueries({ queryKey: ['plan', issueId] });
  }, [storeSequence, issueId, queryClient]);

  if (isLoading) {
    return (
      <div className={className}>
        <LoadingBoundary label="The plan map" timeoutMs={8000}>
          <div className="px-3 py-6 text-xs text-muted-foreground">Loading the plan map…</div>
        </LoadingBoundary>
      </div>
    );
  }
  if (isError || !doc?.plan) {
    return <div className={className}><div className="px-3 py-6 text-xs text-muted-foreground">No plan to map yet.</div></div>;
  }

  const { nodes, edges } = docToDag(doc);
  const itemById = new Map((doc.plan.items ?? []).map((item) => [item.id, item]));

  return (
    <div className={className} data-component="plan-map">
      <DagRenderer
        nodes={nodes}
        edges={edges}
        compact={compact}
        onNodeClick={onNodeClick ? (id) => {
          const item = itemById.get(id);
          if (item) onNodeClick(item);
        } : undefined}
      />
    </div>
  );
}

export default PlanMapViewer;
