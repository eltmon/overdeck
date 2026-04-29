/**
 * VBriefTab — embeds the existing VBriefViewer for the per-issue plan.
 *
 * The plan is fetched from `/api/workspaces/:issueId/plan` (404 when no plan
 * exists); we render an empty state in that case. VBriefViewer itself owns
 * the inner List/DAG/Raw tab strip.
 */

import { useQuery } from '@tanstack/react-query';
import { VBriefViewer } from '../../vbrief/VBriefViewer';
import type { VBriefDocument } from '../../vbrief/types';

interface VBriefTabProps {
  issueId: string;
}

async function fetchPlan(issueId: string): Promise<VBriefDocument | null> {
  const res = await fetch(`/api/workspaces/${issueId}/plan`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — /api/workspaces/${issueId}/plan`);
  }
  return res.json() as Promise<VBriefDocument>;
}

export function VBriefTab({ issueId }: VBriefTabProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['workspace-plan', issueId],
    queryFn: () => fetchPlan(issueId),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div
        data-testid="vbrief-tab-loading"
        style={{ padding: 16, fontSize: 12, color: 'var(--muted-foreground)' }}
      >
        Loading plan…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="vbrief-tab-error"
        style={{ padding: 16, fontSize: 12, color: 'var(--destructive)' }}
      >
        Failed to load plan.
      </div>
    );
  }

  return (
    <div data-testid="vbrief-tab" style={{ padding: 16 }}>
      <VBriefViewer doc={data ?? null} />
    </div>
  );
}
