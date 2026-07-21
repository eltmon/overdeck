/**
 * XBriefTab — embeds the existing XBriefViewer for the per-issue plan.
 *
 * The plan is fetched from `/api/workspaces/:issueId/plan` (404 when no plan
 * exists); we render an empty state in that case. XBriefViewer itself owns
 * the inner List/DAG/Raw tab strip.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { XBriefViewer } from '../../xbrief/XBriefViewer';
import type { XBriefDocument, XBriefInspectionPolicy } from '../../xbrief/types';
import { LoadingBoundary } from '../../primitives/LoadingBoundary';

interface XBriefTabProps {
  issueId: string;
}

async function fetchPlan(issueId: string): Promise<XBriefDocument | null> {
  const res = await fetch(`/api/workspaces/${issueId}/plan`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — /api/workspaces/${issueId}/plan`);
  }
  return res.json() as Promise<XBriefDocument>;
}

export function XBriefTab({ issueId }: XBriefTabProps) {
  const queryClient = useQueryClient();
  const queryKey = ['workspace-plan', issueId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => fetchPlan(issueId),
    refetchInterval: 30_000,
  });
  const updateInspectionPolicy = useMutation({
    mutationFn: async (inspectionPolicy: XBriefInspectionPolicy) => {
      const res = await fetch(`/api/workspaces/${issueId}/plan/inspection-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionPolicy }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json() as Promise<XBriefDocument>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
  });

  if (isLoading) {
    return (
      <div
        data-testid="xbrief-tab-loading"
        style={{ padding: 16, fontSize: 12, color: 'var(--muted-foreground)' }}
      >
        <LoadingBoundary label="The plan"><span>Loading plan…</span></LoadingBoundary>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="xbrief-tab-error"
        style={{ padding: 16, fontSize: 12, color: 'var(--destructive)' }}
      >
        Failed to load plan.
      </div>
    );
  }

  return (
    <div data-testid="xbrief-tab" style={{ padding: 16 }}>
      <XBriefViewer
        doc={data ?? null}
        onInspectionPolicyChange={(policy) => updateInspectionPolicy.mutate(policy)}
        isUpdatingInspectionPolicy={updateInspectionPolicy.isPending}
      />
    </div>
  );
}
