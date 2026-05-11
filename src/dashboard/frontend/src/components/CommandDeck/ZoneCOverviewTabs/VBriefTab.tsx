/**
 * VBriefTab — embeds the existing VBriefViewer for the per-issue plan.
 *
 * The plan is fetched from `/api/workspaces/:issueId/plan` (404 when no plan
 * exists); we render an empty state in that case. VBriefViewer itself owns
 * the inner List/DAG/Raw tab strip.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VBriefViewer } from '../../vbrief/VBriefViewer';
import type { VBriefDocument, VBriefInspectionPolicy } from '../../vbrief/types';

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
  const queryClient = useQueryClient();
  const queryKey = ['workspace-plan', issueId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => fetchPlan(issueId),
    refetchInterval: 30_000,
  });
  const updateInspectionPolicy = useMutation({
    mutationFn: async (inspectionPolicy: VBriefInspectionPolicy) => {
      const res = await fetch(`/api/workspaces/${issueId}/plan/inspection-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionPolicy }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json() as Promise<VBriefDocument>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
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
      <VBriefViewer
        doc={data ?? null}
        onInspectionPolicyChange={(policy) => updateInspectionPolicy.mutate(policy)}
        isUpdatingInspectionPolicy={updateInspectionPolicy.isPending}
      />
    </div>
  );
}
